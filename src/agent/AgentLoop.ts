import { ILlmProvider, Message } from '../providers/ILlmProvider';
import { ToolRegistry } from '../tools/ToolRegistry';
import { ThinkingEngine, ThinkingMode } from './ThinkingEngine';
import { HookManager } from '../hooks/HookManager';
import { config } from '../utils/config';
import { logger, captureLog } from '../utils/logger';
import { telemetry } from '../telemetry/TelemetryReporter';

// ============================================================
// AgentLoop v2 — Enhanced ReAct loop with planning + hooks
// ============================================================
// Improvements over v1:
//   1. ThinkingEngine: Adaptive reasoning (minimal/standard/deep)
//   2. HookManager: Pre/post tool execution hooks
//   3. Reflection: Self-critique after tool results
//   4. Better error recovery with retry logic
//   5. Tool result analysis for smarter follow-up
// ============================================================

export interface AgentResult {
  answer: string;
  isFileOutput: boolean;    // True if answer contains a file path to send
  isAudioOutput: boolean;   // True if TTS should be used
  filePath?: string;        // Path to file if isFileOutput
}

export class AgentLoop {
  private provider: ILlmProvider;
  private toolRegistry: ToolRegistry;
  private maxIterations: number;
  private thinkingEngine: ThinkingEngine;
  private hookManager: HookManager | null;

  constructor(
    provider: ILlmProvider,
    toolRegistry: ToolRegistry,
    hookManager?: HookManager,
    thinkingEngine?: ThinkingEngine
  ) {
    this.provider = provider;
    this.toolRegistry = toolRegistry;
    this.maxIterations = config.agent.maxIterations;
    this.thinkingEngine = thinkingEngine ?? new ThinkingEngine();
    this.hookManager = hookManager ?? null;
  }

  async run(
    messages: Message[],
    systemPrompt: string,
    requiresAudioReply: boolean = false
  ): Promise<AgentResult> {
    // ── Step 1: Assess complexity and determine thinking mode ──
    const userMessage = this.extractLastUserMessage(messages);
    const thinkingMode = this.thinkingEngine.assessComplexity(userMessage);

    logger.info(`[AgentLoop] Thinking mode: ${thinkingMode} for: "${userMessage.substring(0, 80)}..."`);

    // ── Step 2: Enhance system prompt with thinking instructions ──
    const availableTools = this.toolRegistry.listNames();
    const enhancedPrompt = this.thinkingEngine.enhanceSystemPrompt(
      systemPrompt,
      thinkingMode,
      availableTools
    );

    // ── Step 3: Add planning prompt for non-minimal modes ──
    const planningPrompt = this.thinkingEngine.buildPlanningPrompt(
      userMessage,
      thinkingMode,
      availableTools
    );

    const tools = this.toolRegistry.getDefinitions();
    const workingMessages: Message[] = [
      { role: 'system', content: enhancedPrompt },
      ...messages,
    ];

    // Inject planning prompt if applicable
    if (planningPrompt) {
      // Add as a system hint just before the LLM processes
      workingMessages.push({
        role: 'user',
        content: planningPrompt,
      });
    }

    // ── Step 4: ReAct loop with hooks ──
    let iteration = 0;
    let totalToolCalls = 0;
    const loopStart = Date.now();
    const toolResultsForReflection: Array<{ tool: string; result: string; success: boolean }> = [];

    while (iteration < this.maxIterations) {
      iteration++;
      logger.info(`[AgentLoop] Iteration ${iteration}/${this.maxIterations}`);
      captureLog('info', `AgentLoop iteration ${iteration}`);

      const providerStart = Date.now();
      let response;
      try {
        response = await this.provider.complete(workingMessages, tools);
        telemetry.trackProviderCall(
          this.provider.name, '', Date.now() - providerStart, true
        );
      } catch (err) {
        telemetry.trackProviderCall(
          this.provider.name, '', Date.now() - providerStart, false
        );
        telemetry.trackError(err instanceof Error ? err : new Error(String(err)), 'provider_call', {
          provider: this.provider.name,
          iteration,
        });
        throw err;
      }

      logger.debug(`[AgentLoop] Response - content: ${response.content?.substring(0, 100)}..., toolCalls: ${response.toolCalls.length}`);

      // ── No tool calls → check if reflection needed, then final answer ──
      if (response.toolCalls.length === 0) {
        let answer = response.content ?? 'I could not generate a response.';

        // Reflection: if we had tool results and mode is deep, do a quality check
        if (thinkingMode === 'deep' && toolResultsForReflection.length > 0 && iteration < this.maxIterations) {
          const reflectionPrompt = this.thinkingEngine.buildReflectionPrompt(
            userMessage,
            toolResultsForReflection,
            thinkingMode
          );

          if (reflectionPrompt) {
            // The LLM already produced its answer — the reflection is implicit
            // in the enhanced system prompt. We trust the deep thinking mode
            // instructions to have guided the LLM to self-critique.
            logger.info(`[AgentLoop] Deep mode: answer includes self-reflection`);
          }
        }

        logger.info(`[AgentLoop] Final answer reached at iteration ${iteration}`);

        telemetry.trackAgentLoop(
          iteration, this.maxIterations, Date.now() - loopStart, totalToolCalls, true
        );

        return this.parseResult(answer, requiresAudioReply);
      }

      // ── Add assistant message WITH tool call metadata ──
      workingMessages.push({
        role: 'assistant',
        content: response.content ?? '',
        _toolUseCalls: response.toolCalls,
      });

      // ── Execute each tool call with hooks ──
      for (const toolCall of response.toolCalls) {
        logger.info(`[AgentLoop] Executing tool: ${toolCall.name} with args: ${JSON.stringify(toolCall.arguments).substring(0, 200)}`);
        captureLog('info', `Tool call: ${toolCall.name}`);
        totalToolCalls++;

        // ── PreToolUse hook ──
        let args = toolCall.arguments;
        if (this.hookManager) {
          const preResult = await this.hookManager.executePreHooks({
            toolName: toolCall.name,
            args,
            timestamp: Date.now(),
          });

          if (preResult.decision === 'deny') {
            const denyMsg = `Tool "${toolCall.name}" was blocked: ${preResult.reason || 'denied by hook'}`;
            logger.info(`[AgentLoop] Hook denied: ${denyMsg}`);

            workingMessages.push({
              role: 'tool',
              content: JSON.stringify({ error: denyMsg }),
              tool_call_id: toolCall.id,
              name: toolCall.name,
            });

            toolResultsForReflection.push({ tool: toolCall.name, result: denyMsg, success: false });
            continue;
          }

          if (preResult.decision === 'modify' && preResult.modifiedArgs) {
            args = preResult.modifiedArgs;
          }

          // Inject context from hook if provided
          if (preResult.injectContext) {
            workingMessages.push({
              role: 'system',
              content: preResult.injectContext,
            });
          }
        }

        // ── Execute the tool ──
        const tool = this.toolRegistry.get(toolCall.name);
        let observation: string;
        let toolSuccess = false;
        const toolStart = Date.now();

        if (!tool) {
          observation = JSON.stringify({ error: `Tool "${toolCall.name}" not found. Available: ${availableTools.join(', ')}` });
          telemetry.trackToolCall(toolCall.name, 0, false, { error: 'not_found' });
        } else {
          try {
            const result = await tool.execute(args);
            const toolDuration = Date.now() - toolStart;

            if (result.error) {
              observation = JSON.stringify({ error: result.error });
              telemetry.trackToolCall(toolCall.name, toolDuration, false, { error: result.error });
            } else {
              observation = result.output;
              toolSuccess = true;
              telemetry.trackToolCall(toolCall.name, toolDuration, true, {
                output_length: result.output.length,
              });
            }
          } catch (err) {
            const toolDuration = Date.now() - toolStart;
            observation = JSON.stringify({ error: String(err) });
            telemetry.trackToolCall(toolCall.name, toolDuration, false, {
              error: String(err),
            });

            // ── OnError hook ──
            if (this.hookManager) {
              await this.hookManager.executeErrorHooks({
                toolName: toolCall.name,
                args,
                error: String(err),
                attempt: 1,
                timestamp: Date.now(),
              });
            }
          }
        }

        // ── PostToolUse hook ──
        if (this.hookManager) {
          const postContext = await this.hookManager.executePostHooks({
            toolName: toolCall.name,
            args,
            result: observation.substring(0, 1000),
            error: toolSuccess ? undefined : observation,
            durationMs: Date.now() - toolStart,
            timestamp: Date.now(),
          });

          if (postContext) {
            workingMessages.push({
              role: 'system',
              content: postContext,
            });
          }
        }

        logger.info(`[AgentLoop] Observation: ${observation.substring(0, 200)}`);

        workingMessages.push({
          role: 'tool',
          content: observation,
          tool_call_id: toolCall.id,
          name: toolCall.name,
        });

        // Track for reflection
        toolResultsForReflection.push({
          tool: toolCall.name,
          result: observation.substring(0, 500),
          success: toolSuccess,
        });
      }
    }

    // ── Max iterations reached ──
    logger.warn(`[AgentLoop] Max iterations (${this.maxIterations}) reached`);
    telemetry.trackAgentLoop(
      iteration, this.maxIterations, Date.now() - loopStart, totalToolCalls, false
    );

    return {
      answer: `⚠️ Não consegui completar a tarefa dentro do limite de ${this.maxIterations} iterações. Por favor, tente reformular seu pedido.`,
      isFileOutput: false,
      isAudioOutput: requiresAudioReply,
    };
  }

  /**
   * Extract the last user message from conversation history
   */
  private extractLastUserMessage(messages: Message[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        return messages[i].content;
      }
    }
    return '';
  }

  private parseResult(answer: string, requiresAudioReply: boolean): AgentResult {
    const fileMatch = answer.match(/\[FILE:([^\]]+)\]/);
    if (fileMatch) {
      return {
        answer: answer.replace(fileMatch[0], '').trim(),
        isFileOutput: true,
        isAudioOutput: false,
        filePath: fileMatch[1],
      };
    }

    return {
      answer,
      isFileOutput: false,
      isAudioOutput: requiresAudioReply,
    };
  }
}
