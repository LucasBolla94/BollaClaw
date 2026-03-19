import { ILlmProvider, Message } from '../providers/ILlmProvider';
import { ToolRegistry } from '../tools/ToolRegistry';
import { config } from '../utils/config';
import { logger, captureLog } from '../utils/logger';

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

    while (iteration < this.maxIterations) {
      iteration++;
      logger.info(`[AgentLoop] Iteration ${iteration}/${this.maxIterations}`);
      captureLog('info', `AgentLoop iteration ${iteration}`);

      const response = await this.provider.complete(workingMessages, tools);

      logger.debug(`[AgentLoop] Response - content: ${response.content?.substring(0, 100)}..., toolCalls: ${response.toolCalls.length}`);

      // No tool calls -> final answer
      if (response.toolCalls.length === 0) {
        const answer = response.content ?? 'I could not generate a response.';
        logger.info(`[AgentLoop] Final answer reached at iteration ${iteration}`);

        return this.parseResult(answer, requiresAudioReply);
      }

      // Add assistant message WITH tool call metadata
      // This is critical for Anthropic's tool_use protocol: the assistant message
      // must carry the tool_use blocks so ClaudeProvider can reconstruct them.
      workingMessages.push({
        role: 'assistant',
        content: response.content ?? '',
        _toolUseCalls: response.toolCalls,
      });

      // Execute each tool call
      for (const toolCall of response.toolCalls) {
        logger.info(`[AgentLoop] Executing tool: ${toolCall.name} with args: ${JSON.stringify(toolCall.arguments)}`);
        captureLog('info', `Tool call: ${toolCall.name}`);

        const tool = this.toolRegistry.get(toolCall.name);
        let observation: string;

        if (!tool) {
          observation = JSON.stringify({ error: `Tool "${toolCall.name}" not found` });
        } else {
          try {
            const result = await tool.execute(toolCall.arguments);
            observation = result.error
              ? JSON.stringify({ error: result.error })
              : result.output;
          } catch (err) {
            observation = JSON.stringify({ error: String(err) });
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
    return {
      answer: `⚠️ Não consegui completar a tarefa dentro do limite de ${this.maxIterations} iterações. Por favor, tente reformular seu pedido.`,
      isFileOutput: false,
      isAudioOutput: requiresAudioReply,
    };
  }

  private parseResult(answer: string, requiresAudioReply: boolean): AgentResult {
    // Check if the answer contains a file path marker
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
