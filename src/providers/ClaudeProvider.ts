import Anthropic from '@anthropic-ai/sdk';
import { ILlmProvider, Message, ToolDefinition, LlmResponse, ToolCall } from './ILlmProvider';
import { ProviderEntry } from './ProviderConfig';
import { logger } from '../utils/logger';

export class ClaudeProvider implements ILlmProvider {
  public readonly name: string;
  private client: Anthropic;
  private model: string;
  private maxTokens: number;

  constructor(providerName: string, entry: ProviderEntry) {
    this.name = providerName;
    this.model = entry.model || 'claude-sonnet-4-5';
    this.maxTokens = entry.maxTokens ?? 8192;
    this.client = new Anthropic({ apiKey: entry.apiKey });
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
        max_tokens: this.maxTokens,
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
      logger.error(`[${this.name}] Claude API error: ${error}`);
      throw error;
    }
  }
}
