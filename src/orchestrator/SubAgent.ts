import { ILlmProvider, Message, ToolDefinition, ToolCall } from '../providers/ILlmProvider';
import { ProviderFactory } from '../providers/ProviderFactory';
import { ToolRegistry } from '../tools/ToolRegistry';
import { BaseTool } from '../tools/BaseTool';
import { logger } from '../utils/logger';
import { telemetry } from '../telemetry/TelemetryReporter';

// ============================================================
// SubAgent — Specialist agent that executes a focused task
// ============================================================
// Each SubAgent has:
//   - A specific role and system prompt
//   - Access to a subset of tools (isolated)
//   - Its own LLM provider (can be different from orchestrator)
//   - An independent ReAct loop with configurable iterations
//   - Communication back to the orchestrator via results
// ============================================================

export type SubAgentType = 'fixed' | 'temporary';
export type SubAgentStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface SubAgentConfig {
  /** Unique identifier for the sub-agent */
  id: string;
  /** Human-readable name for logging/display */
  name: string;
  /** Specialist role description */
  role: string;
  /** Detailed system prompt for this agent's specialty */
  systemPrompt: string;
  /** Which LLM provider to use (name from providers.json). If omitted, uses default. */
  providerName?: string;
  /** Max ReAct loop iterations (default: 3) */
  maxIterations?: number;
  /** Timeout in ms (default: 60000 — 1 min) */
  timeout?: number;
  /** Tools this agent has access to (empty = no tools, just reasoning) */
  allowedTools?: string[];
  /** Whether this is a persistent or one-off agent */
  type: SubAgentType;
  /** Temperature override (0-1) for this agent */
  temperature?: number;
}

export interface SubAgentResult {
  /** Agent that produced this result */
  agentId: string;
  agentName: string;
  /** Final response text */
  output: string;
  /** Whether the task completed successfully */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Tool calls made during execution */
  toolCallsLog: Array<{ tool: string; args: Record<string, unknown>; result: string; duration: number }>;
  /** Execution metrics */
  metrics: {
    iterations: number;
    totalDurationMs: number;
    providerName: string;
    tokenEstimate: number;
  };
}

export class SubAgent {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly type: SubAgentType;

  private config: SubAgentConfig;
  private provider: ILlmProvider | null = null;
  private toolRegistry: ToolRegistry;
  private status: SubAgentStatus = 'idle';
  private createdAt = Date.now();

  constructor(config: SubAgentConfig, parentToolRegistry: ToolRegistry) {
    this.id = config.id;
    this.name = config.name;
    this.role = config.role;
    this.type = config.type;
    this.config = config;

    // Create isolated tool registry with only allowed tools
    this.toolRegistry = new ToolRegistry();
    // Remove default tools that were auto-registered
    for (const toolName of this.toolRegistry.listNames()) {
      this.toolRegistry.unregister(toolName);
    }

    // Copy only allowed tools from parent registry
    if (config.allowedTools && config.allowedTools.length > 0) {
      for (const toolName of config.allowedTools) {
        const tool = parentToolRegistry.get(toolName);
        if (tool) {
          this.toolRegistry.register(tool);
        } else {
          logger.warn(`[SubAgent:${this.name}] Tool "${toolName}" not found in parent registry`);
        }
      }
    }

    logger.info(`[SubAgent:${this.name}] Created (type: ${this.type}, tools: [${this.toolRegistry.listNames().join(', ')}], provider: ${config.providerName || 'default'})`);
  }

  /**
   * Get or create the LLM provider for this agent
   */
  private getProvider(): ILlmProvider {
    if (!this.provider) {
      this.provider = ProviderFactory.create(this.config.providerName);
    }
    return this.provider;
  }

  /**
   * Execute a task with this sub-agent
   */
  async execute(task: string, context?: string): Promise<SubAgentResult> {
    this.status = 'running';
    const startTime = Date.now();
    const toolCallsLog: SubAgentResult['toolCallsLog'] = [];
    const maxIterations = this.config.maxIterations ?? 3;
    const timeout = this.config.timeout ?? 60_000;

    logger.info(`[SubAgent:${this.name}] Executing task: "${task.substring(0, 100)}..."`);

    // Build messages
    const systemContent = this.buildSystemPrompt(context);
    const messages: Message[] = [
      { role: 'system', content: systemContent },
      { role: 'user', content: task },
    ];

    const tools = this.toolRegistry.getDefinitions();
    let iteration = 0;
    let lastContent = '';

    // Create timeout guard
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`SubAgent timeout after ${timeout}ms`)), timeout);
    });

    try {
      const provider = this.getProvider();

      while (iteration < maxIterations) {
        iteration++;
        logger.info(`[SubAgent:${this.name}] Iteration ${iteration}/${maxIterations}`);

        // Race between LLM call and timeout
        const response = await Promise.race([
          provider.complete(messages, tools.length > 0 ? tools : undefined),
          timeoutPromise,
        ]);

        // No tool calls → final answer
        if (response.toolCalls.length === 0) {
          lastContent = response.content ?? '';
          break;
        }

        // Add assistant message with tool calls
        messages.push({
          role: 'assistant',
          content: response.content ?? '',
          _toolUseCalls: response.toolCalls,
        });

        // Execute each tool call
        for (const toolCall of response.toolCalls) {
          const toolStart = Date.now();
          const tool = this.toolRegistry.get(toolCall.name);
          let observation: string;

          if (!tool) {
            observation = JSON.stringify({ error: `Tool "${toolCall.name}" not available for this agent` });
          } else {
            try {
              const result = await Promise.race([
                tool.execute(toolCall.arguments),
                timeoutPromise,
              ]);

              observation = result.error
                ? JSON.stringify({ error: result.error })
                : result.output;
            } catch (err) {
              observation = JSON.stringify({ error: String(err) });
            }
          }

          const toolDuration = Date.now() - toolStart;
          toolCallsLog.push({
            tool: toolCall.name,
            args: toolCall.arguments,
            result: observation.substring(0, 500),
            duration: toolDuration,
          });

          messages.push({
            role: 'tool',
            content: observation,
            tool_call_id: toolCall.id,
            name: toolCall.name,
          });
        }

        // Capture last content in case we exit the loop
        if (response.content) lastContent = response.content;
      }

      // Success
      const totalDuration = Date.now() - startTime;
      this.status = 'completed';

      logger.info(`[SubAgent:${this.name}] Completed in ${totalDuration}ms (${iteration} iterations, ${toolCallsLog.length} tool calls)`);

      telemetry.track({
        type: 'agent_event',
        severity: 'info',
        category: 'subagent_complete',
        message: `SubAgent ${this.name} completed`,
        data: {
          agent_id: this.id,
          iterations: iteration,
          tool_calls: toolCallsLog.length,
          duration_ms: totalDuration,
          provider: this.config.providerName || 'default',
        },
      });

      return {
        agentId: this.id,
        agentName: this.name,
        output: lastContent,
        success: true,
        toolCallsLog,
        metrics: {
          iterations: iteration,
          totalDurationMs: totalDuration,
          providerName: this.getProvider().name,
          tokenEstimate: this.estimateTokens(messages),
        },
      };

    } catch (err) {
      const totalDuration = Date.now() - startTime;
      this.status = 'failed';
      const errorMsg = err instanceof Error ? err.message : String(err);

      logger.error(`[SubAgent:${this.name}] Failed after ${totalDuration}ms: ${errorMsg}`);

      telemetry.track({
        type: 'error',
        severity: 'error',
        category: 'subagent_error',
        message: `SubAgent ${this.name} failed: ${errorMsg}`,
        data: {
          agent_id: this.id,
          iterations: iteration,
          duration_ms: totalDuration,
        },
      });

      return {
        agentId: this.id,
        agentName: this.name,
        output: lastContent || '',
        success: false,
        error: errorMsg,
        toolCallsLog,
        metrics: {
          iterations: iteration,
          totalDurationMs: totalDuration,
          providerName: this.config.providerName || 'default',
          tokenEstimate: 0,
        },
      };
    }
  }

  /**
   * Build system prompt with role, context, and tool awareness
   */
  private buildSystemPrompt(context?: string): string {
    const parts: string[] = [];

    // Role definition
    parts.push(`# Seu Papel: ${this.role}`);
    parts.push('');
    parts.push(this.config.systemPrompt);

    // Context from orchestrator or other agents
    if (context) {
      parts.push('');
      parts.push('## Contexto');
      parts.push(context);
    }

    // Tool awareness
    const toolNames = this.toolRegistry.listNames();
    if (toolNames.length > 0) {
      parts.push('');
      parts.push(`## Ferramentas Disponíveis: ${toolNames.join(', ')}`);
      parts.push('Use as ferramentas quando necessário para completar sua tarefa.');
    }

    // Output format instructions
    parts.push('');
    parts.push('## Regras de Output');
    parts.push('- Seja DIRETO e OBJETIVO na resposta.');
    parts.push('- Foque exclusivamente na tarefa atribuída.');
    parts.push('- Se precisar de informação que não tem, diga explicitamente.');
    parts.push('- Retorne o resultado em formato claro e estruturado.');

    return parts.join('\n');
  }

  /**
   * Rough token estimation
   */
  private estimateTokens(messages: Message[]): number {
    const totalChars = messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
    return Math.ceil(totalChars / 4);
  }

  /**
   * Get current status
   */
  getStatus(): SubAgentStatus {
    return this.status;
  }

  /**
   * Get agent info for logging/display
   */
  getInfo() {
    return {
      id: this.id,
      name: this.name,
      role: this.role,
      type: this.type,
      status: this.status,
      provider: this.config.providerName || 'default',
      tools: this.toolRegistry.listNames(),
      createdAt: this.createdAt,
      ageMs: Date.now() - this.createdAt,
    };
  }

  /**
   * Cancel a running agent
   */
  cancel(): void {
    if (this.status === 'running') {
      this.status = 'cancelled';
      logger.info(`[SubAgent:${this.name}] Cancelled`);
    }
  }
}
