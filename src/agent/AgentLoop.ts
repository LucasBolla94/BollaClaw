import { ILlmProvider, Message } from '../providers/ILlmProvider';
import { ToolRegistry } from '../tools/ToolRegistry';
import { config } from '../utils/config';
import { logger, captureLog } from '../utils/logger';
import { telemetry } from '../telemetry/TelemetryReporter';

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

  constructor(provider: ILlmProvider, toolRegistry: ToolRegistry) {
    this.provider = provider;
    this.toolRegistry = toolRegistry;
    this.maxIterations = config.agent.maxIterations;
  }

  async run(
    messages: Message[],
    systemPrompt: string,
    requiresAudioReply: boolean = false
  ): Promise<AgentResult> {
    const tools = this.toolRegistry.getDefinitions();
    const workingMessages: Message[] = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];

    let iteration = 0;
    let totalToolCalls = 0;
    const loopStart = Date.now();

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

      // No tool calls -> final answer
      if (response.toolCalls.length === 0) {
        const answer = response.content ?? 'I could not generate a response.';
        logger.info(`[AgentLoop] Final answer reached at iteration ${iteration}`);

        // Track loop completion
        telemetry.trackAgentLoop(
          iteration, this.maxIterations, Date.now() - loopStart, totalToolCalls, true
        );

        return this.parseResult(answer, requiresAudioReply);
      }

      // Add assistant message WITH tool call metadata
      workingMessages.push({
        role: 'assistant',
        content: response.content ?? '',
        _toolUseCalls: response.toolCalls,
      });

      // Execute each tool call
      for (const toolCall of response.toolCalls) {
        logger.info(`[AgentLoop] Executing tool: ${toolCall.name} with args: ${JSON.stringify(toolCall.arguments)}`);
        captureLog('info', `Tool call: ${toolCall.name}`);
        totalToolCalls++;

        const tool = this.toolRegistry.get(toolCall.name);
        let observation: string;
        const toolStart = Date.now();

        if (!tool) {
          observation = JSON.stringify({ error: `Tool "${toolCall.name}" not found` });
          telemetry.trackToolCall(toolCall.name, 0, false, { error: 'not_found' });
        } else {
          try {
            const result = await tool.execute(toolCall.arguments);
            const toolDuration = Date.now() - toolStart;

            if (result.error) {
              observation = JSON.stringify({ error: result.error });
              telemetry.trackToolCall(toolCall.name, toolDuration, false, { error: result.error });
            } else {
              observation = result.output;
              telemetry.trackToolCall(toolCall.name, toolDuration, true, {
                output_length: result.output.length,
              });
            }
          } catch (err) {
            observation = JSON.stringify({ error: String(err) });
            telemetry.trackToolCall(toolCall.name, Date.now() - toolStart, false, {
              error: String(err),
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
      }
    }

    // Max iterations reached
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
