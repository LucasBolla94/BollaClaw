import Anthropic from '@anthropic-ai/sdk';
import { ILlmProvider, Message, ToolDefinition, LlmResponse, ToolCall, CompletionOptions } from './ILlmProvider';
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

  async complete(messages: Message[], tools?: ToolDefinition[], options?: CompletionOptions): Promise<LlmResponse> {
    const systemMessages = messages.filter((m) => m.role === 'system');
    const chatMessages = messages.filter((m) => m.role !== 'system');
    const systemPrompt = systemMessages.map((m) => m.content).join('\n\n');

    // Build Anthropic-native messages with proper tool_use / tool_result protocol
    const anthropicMessages = this.buildAnthropicMessages(chatMessages);

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

  /**
   * Build Anthropic-native message array from internal Message format.
   *
   * Anthropic requires:
   *   - Assistant messages with tool calls -> content = [{type:'text',...}, {type:'tool_use',...}]
   *   - Tool results -> user message with content = [{type:'tool_result', tool_use_id:...}]
   *   - Messages must alternate user/assistant (consecutive same-role get merged)
   */
  private buildAnthropicMessages(messages: Message[]): Anthropic.MessageParam[] {
    const result: Anthropic.MessageParam[] = [];

    let i = 0;
    while (i < messages.length) {
      const msg = messages[i];

      if (msg.role === 'assistant') {
        // Build assistant content blocks
        const contentBlocks: any[] = [];

        if (msg.content) {
          contentBlocks.push({ type: 'text', text: msg.content });
        }

        // If this assistant message had tool calls, add tool_use blocks
        if (msg._toolUseCalls && msg._toolUseCalls.length > 0) {
          for (const tc of msg._toolUseCalls) {
            contentBlocks.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            });
          }
        }

        result.push({
          role: 'assistant',
          content: contentBlocks.length > 0 ? contentBlocks : msg.content,
        });
        i++;

      } else if (msg.role === 'tool') {
        // Collect consecutive tool messages into a single user message with tool_result blocks
        const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];

        while (i < messages.length && messages[i].role === 'tool') {
          const toolMsg = messages[i];
          toolResultBlocks.push({
            type: 'tool_result',
            tool_use_id: toolMsg.tool_call_id ?? '',
            content: toolMsg.content,
          });
          i++;
        }

        result.push({
          role: 'user',
          content: toolResultBlocks,
        });

      } else {
        // Regular user message
        result.push({
          role: 'user',
          content: msg.content,
        });
        i++;
      }
    }

    // Anthropic requires alternating roles - merge consecutive same-role messages
    return this.mergeConsecutiveRoles(result);
  }

  /**
   * Merge consecutive messages with the same role (required by Anthropic API)
   */
  private mergeConsecutiveRoles(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
    if (messages.length === 0) return messages;

    const merged: Anthropic.MessageParam[] = [messages[0]];

    for (let i = 1; i < messages.length; i++) {
      const prev = merged[merged.length - 1];
      const curr = messages[i];

      if (prev.role === curr.role) {
        // Merge content into the previous message
        const prevContent = this.toContentArray(prev.content as any);
        const currContent = this.toContentArray(curr.content as any);
        (prev as any).content = [...prevContent, ...currContent];
      } else {
        merged.push(curr);
      }
    }

    return merged;
  }

  private toContentArray(content: any): any[] {
    if (typeof content === 'string') {
      return [{ type: 'text', text: content }];
    }
    if (Array.isArray(content)) {
      return content;
    }
    return [{ type: 'text', text: String(content) }];
  }
}
