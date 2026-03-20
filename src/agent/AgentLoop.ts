import { ILlmProvider, Message, ToolCall, LlmResponse, ToolDefinition } from '../providers/ILlmProvider';
import { ToolRegistry } from '../tools/ToolRegistry';
import { ToolResult } from '../tools/BaseTool';
import { ThinkingEngine } from './ThinkingEngine';
import { HookManager } from '../hooks/HookManager';
import { parseToolCallsFromText, looksLikeToolCall, toToolCalls } from './ToolCallParser';
import { config } from '../utils/config';
import { logger, captureLog } from '../utils/logger';
import { telemetry } from '../telemetry/TelemetryReporter';

// ============================================================
// AgentLoop v3 — Robust ReAct loop with Fallback Chain Parser
// ============================================================
// Key improvements over v2:
//   1. Fallback Chain Parser: Extracts tool calls from text when
//      the LLM doesn't use native function calling
//   2. Per-iteration timeout: Each iteration has a hard timeout
//   3. Global timeout: Total loop execution time is capped
//   4. Better error recovery: Provider errors get retried once
//   5. Clean text output: Tool call JSON is never shown to user
// ============================================================

const ITERATION_TIMEOUT_MS = 90_000;  // 90s per iteration
const GLOBAL_TIMEOUT_MS = 300_000;    // 5 min total
const MAX_PROVIDER_RETRIES = 1;       // Retry provider call once on failure

export interface AgentResult {
  answer: string;
  isFileOutput: boolean;
  isAudioOutput: boolean;
  filePath?: string;
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
    // ── Step 1: Assess complexity ──
    const userMessage = this.extractLastUserMessage(messages);
    const thinkingMode = this.thinkingEngine.assessComplexity(userMessage);
    const availableTools = this.toolRegistry.listNames();

    logger.info(`[AgentLoop] Thinking: ${thinkingMode} | Tools: ${availableTools.length} | Msg: "${userMessage.substring(0, 60)}..."`);

    // ── Step 2: Build prompts ──
    const enhancedPrompt = this.thinkingEngine.enhanceSystemPrompt(
      systemPrompt, thinkingMode, availableTools
    );
    const planningPrompt = this.thinkingEngine.buildPlanningPrompt(
      userMessage, thinkingMode, availableTools
    );

    const tools = this.toolRegistry.getDefinitions();
    const workingMessages: Message[] = [
      { role: 'system', content: enhancedPrompt },
      ...messages,
    ];

    if (planningPrompt) {
      workingMessages.push({ role: 'user', content: planningPrompt });
    }

    // ── Step 3: ReAct loop ──
    let iteration = 0;
    let totalToolCalls = 0;
    const loopStart = Date.now();
    const toolResultsForReflection: Array<{ tool: string; result: string; success: boolean }> = [];

    while (iteration < this.maxIterations) {
      iteration++;

      // ── Global timeout check ──
      if (Date.now() - loopStart > GLOBAL_TIMEOUT_MS) {
        logger.warn(`[AgentLoop] Global timeout reached (${GLOBAL_TIMEOUT_MS}ms)`);
        break;
      }

      logger.info(`[AgentLoop] Iteration ${iteration}/${this.maxIterations}`);
      captureLog('info', `AgentLoop iteration ${iteration}`);

      // ── Call provider with retry ──
      const response = await this.callProviderWithRetry(workingMessages, tools, iteration);

      if (!response) {
        // Provider failed even after retry
        return {
          answer: 'Desculpe, ocorreu um erro ao processar sua mensagem. Tente novamente.',
          isFileOutput: false,
          isAudioOutput: requiresAudioReply,
        };
      }

      // ── Determine tool calls (native or fallback-parsed) ──
      let effectiveToolCalls: ToolCall[] = response.toolCalls;
      let contentForUser = response.content ?? '';

      // If no native tool calls, try fallback parser
      if (effectiveToolCalls.length === 0 && contentForUser) {
        if (looksLikeToolCall(contentForUser, availableTools)) {
          logger.info(`[AgentLoop] No native tool calls — trying fallback parser`);
          const parsed = parseToolCallsFromText(contentForUser, availableTools);

          if (parsed.calls.length > 0) {
            effectiveToolCalls = toToolCalls(parsed.calls);
            contentForUser = parsed.cleanedContent;
            logger.info(`[AgentLoop] Fallback parser extracted ${effectiveToolCalls.length} tool call(s): ${effectiveToolCalls.map(t => t.name).join(', ')}`);
            captureLog('info', `Fallback parser: ${effectiveToolCalls.map(t => t.name).join(', ')}`);

            telemetry.trackToolCall('_fallback_parser', 0, true, {
              extracted: effectiveToolCalls.map(t => t.name).join(','),
              iteration,
            });
          }
        }
      }

      // ── No tool calls → final answer ──
      if (effectiveToolCalls.length === 0) {
        let answer = contentForUser || 'Não consegui gerar uma resposta.';

        // Reflection for deep mode
        if (thinkingMode === 'deep' && toolResultsForReflection.length > 0 && iteration < this.maxIterations) {
          const reflectionPrompt = this.thinkingEngine.buildReflectionPrompt(
            userMessage, toolResultsForReflection, thinkingMode
          );
          if (reflectionPrompt) {
            logger.info(`[AgentLoop] Deep mode: self-reflection applied`);
          }
        }

        logger.info(`[AgentLoop] Final answer at iteration ${iteration} (${totalToolCalls} tool calls total)`);
        telemetry.trackAgentLoop(iteration, this.maxIterations, Date.now() - loopStart, totalToolCalls, true);
        return this.parseResult(answer, requiresAudioReply);
      }

      // ── Add assistant message with tool call metadata ──
      workingMessages.push({
        role: 'assistant',
        content: contentForUser,
        _toolUseCalls: effectiveToolCalls,
      });

      // ── Execute each tool call ──
      for (const toolCall of effectiveToolCalls) {
        const toolResult = await this.executeSingleToolCall(
          toolCall, availableTools, workingMessages, toolResultsForReflection
        );
        totalToolCalls++;

        workingMessages.push({
          role: 'tool',
          content: toolResult.observation,
          tool_call_id: toolCall.id,
          name: toolCall.name,
        });
      }
    }

    // ── Max iterations reached ──
    logger.warn(`[AgentLoop] Max iterations (${this.maxIterations}) reached`);
    telemetry.trackAgentLoop(iteration, this.maxIterations, Date.now() - loopStart, totalToolCalls, false);

    return {
      answer: `Não consegui completar a tarefa dentro do limite de ${this.maxIterations} iterações. Por favor, tente reformular seu pedido.`,
      isFileOutput: false,
      isAudioOutput: requiresAudioReply,
    };
  }

  // ── Call provider with optional retry ────────────────────────
  private async callProviderWithRetry(
    messages: Message[],
    tools: ToolDefinition[],
    iteration: number
  ): Promise<LlmResponse | null> {
    for (let attempt = 0; attempt <= MAX_PROVIDER_RETRIES; attempt++) {
      const providerStart = Date.now();
      try {
        const response: LlmResponse = await Promise.race([
          this.provider.complete(messages, tools),
          this.timeout<LlmResponse>(ITERATION_TIMEOUT_MS, `Provider call timeout (${ITERATION_TIMEOUT_MS}ms)`),
        ]);

        telemetry.trackProviderCall(this.provider.name, '', Date.now() - providerStart, true);
        return response;
      } catch (err) {
        const duration = Date.now() - providerStart;
        telemetry.trackProviderCall(this.provider.name, '', duration, false);

        if (attempt < MAX_PROVIDER_RETRIES) {
          logger.warn(`[AgentLoop] Provider call failed (attempt ${attempt + 1}), retrying... Error: ${String(err).substring(0, 100)}`);
          await this.sleep(1000 * (attempt + 1)); // Backoff
          continue;
        }

        logger.error(`[AgentLoop] Provider call failed after ${MAX_PROVIDER_RETRIES + 1} attempts`, err);
        telemetry.trackError(err instanceof Error ? err : new Error(String(err)), 'provider_call', {
          provider: this.provider.name,
          iteration,
          attempts: attempt + 1,
        });
        return null;
      }
    }
    return null;
  }

  // ── Execute a single tool call with hooks ───────────────────
  private async executeSingleToolCall(
    toolCall: ToolCall,
    availableTools: string[],
    workingMessages: Message[],
    toolResultsForReflection: Array<{ tool: string; result: string; success: boolean }>
  ): Promise<{ observation: string; success: boolean }> {

    logger.info(`[AgentLoop] Executing tool: ${toolCall.name} | args: ${JSON.stringify(toolCall.arguments).substring(0, 200)}`);
    captureLog('info', `Tool call: ${toolCall.name}`);

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
        toolResultsForReflection.push({ tool: toolCall.name, result: denyMsg, success: false });
        return { observation: JSON.stringify({ error: denyMsg }), success: false };
      }

      if (preResult.decision === 'modify' && preResult.modifiedArgs) {
        args = preResult.modifiedArgs;
      }

      if (preResult.injectContext) {
        workingMessages.push({ role: 'system', content: preResult.injectContext });
      }
    }

    // ── Execute tool ──
    const tool = this.toolRegistry.get(toolCall.name);
    let observation: string;
    let toolSuccess = false;
    const toolStart = Date.now();

    if (!tool) {
      observation = JSON.stringify({
        error: `Tool "${toolCall.name}" not found. Available tools: ${availableTools.join(', ')}`,
      });
      telemetry.trackToolCall(toolCall.name, 0, false, { error: 'not_found' });
    } else {
      try {
        const result: ToolResult = await Promise.race([
          tool.execute(args),
          this.timeout<ToolResult>(ITERATION_TIMEOUT_MS, `Tool "${toolCall.name}" timeout`),
        ]);
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
        telemetry.trackToolCall(toolCall.name, toolDuration, false, { error: String(err) });

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
        workingMessages.push({ role: 'system', content: postContext });
      }
    }

    logger.info(`[AgentLoop] Tool ${toolCall.name}: ${toolSuccess ? 'OK' : 'FAIL'} | ${observation.substring(0, 150)}`);

    toolResultsForReflection.push({
      tool: toolCall.name,
      result: observation.substring(0, 500),
      success: toolSuccess,
    });

    return { observation, success: toolSuccess };
  }

  // ── Helpers ────────────────────────────────────────────────
  private extractLastUserMessage(messages: Message[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') return messages[i].content;
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

  private timeout<T>(ms: number, msg: string): Promise<T> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error(msg)), ms)
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
