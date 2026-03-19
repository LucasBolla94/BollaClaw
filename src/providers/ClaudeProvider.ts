import Anthropic from '@anthropic-ai/sdk';
import { ILlmProvider, Message, ToolDefinition, LlmResponse, ToolCall } from './ILlmProvider';
import { logger } from '../utils/logger';

export class ClaudeProvider implements ILlmProvider {
  public readonly name = 'claude';
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model = 'claude-sonnet-4-5') {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async complete(messages: Message[], tools?: ToolDefinition[]): Promise<LlmResponse> {
    const systemMessages = messages.filter((m) => m.role === 'system');
    const chatMessages = messages.filter((m) => m.role !== 'system');
    const systemPrompt = systemMessages.map((m) => m.content).join('\n\n');

    const anthropicMessages: Anthropic.MessageParam[] = chatMessages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));

    const anthropicTools: Anthropic.Tool[] | undefined = tools?.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool['input_schema'],
    }));

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 8192,
        system: systemPrompt || undefined,
        messages: anthropicMessages,
        tools: anthropicTools,
      });

      const toolCalls: ToolCall[] = [];
      let textContent = '';

      for (const block of response.content) {
        if (block.type === 'text') {
          textContent += block.text;
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            name: block.name,
            arguments: block.input as Record<string, unknown>,
          });
        }
      }

      return {
        content: textContent || null,
        toolCalls,
        isFinished: response.stop_reason === 'end_turn' || response.stop_reason === 'max_tokens',
      };
    } catch (error) {
      logger.error(`Claude API error: ${error}`);
      throw error;
    }
  }
}
