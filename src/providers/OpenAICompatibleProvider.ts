import OpenAI from 'openai';
import { ILlmProvider, Message, ToolDefinition, LlmResponse, ToolCall } from './ILlmProvider';
import { ProviderEntry } from './ProviderConfig';
import { logger } from '../utils/logger';

/**
 * Universal provider for ALL OpenAI-compatible APIs:
 * OpenAI, DeepSeek, Groq, OpenRouter, Together, Fireworks, xAI/Grok,
 * Mistral, Cerebras, Ollama, LM Studio, and any other OpenAI-compatible endpoint.
 *
 * This single class replaces the old DeepSeekProvider and GroqProvider.
 */
export class OpenAICompatibleProvider implements ILlmProvider {
  public readonly name: string;
  private client: OpenAI;
  private model: string;
  private maxTokens: number;
  private temperature?: number;

  constructor(providerName: string, entry: ProviderEntry) {
    this.name = providerName;
    this.model = entry.model;
    this.maxTokens = entry.maxTokens ?? 8192;
    this.temperature = entry.temperature;

    if (!entry.baseUrl) {
      throw new Error(`OpenAI-compatible provider "${providerName}" requires a baseUrl`);
    }

    const clientOptions: OpenAI.ClientOptions = {
      apiKey: entry.apiKey,
      baseURL: entry.baseUrl,
    };

    // Inject custom headers if configured (e.g., OpenRouter needs HTTP-Referer)
    if (entry.headers) {
      clientOptions.defaultHeaders = entry.headers;
    }

    this.client = new OpenAI(clientOptions);
  }

  async complete(messages: Message[], tools?: ToolDefinition[]): Promise<LlmResponse> {
    // Map messages to OpenAI format
    const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = messages.map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'tool' as const,
          content: m.content,
          tool_call_id: m.tool_call_id ?? '',
        };
      }
      return {
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
      };
    });

    // Map tools
    const openaiTools: OpenAI.Chat.ChatCompletionTool[] | undefined = tools?.length
      ? tools.map((t) => ({
          type: 'function' as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        }))
      : undefined;

    try {
      const requestParams: OpenAI.Chat.ChatCompletionCreateParams = {
        model: this.model,
        messages: openaiMessages,
        max_tokens: this.maxTokens,
      };

      if (openaiTools && openaiTools.length > 0) {
        requestParams.tools = openaiTools;
        requestParams.tool_choice = 'auto';
      }

      if (this.temperature !== undefined) {
        requestParams.temperature = this.temperature;
      }

      const response = await this.client.chat.completions.create(requestParams);

      const choice = response.choices[0];
      const toolCalls: ToolCall[] = (choice?.message?.tool_calls ?? []).map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: this.safeParseArgs(tc.function.arguments),
      }));

      return {
        content: choice?.message?.content ?? null,
        toolCalls,
        isFinished: choice?.finish_reason === 'stop',
      };
    } catch (error: any) {
      logger.error(`[${this.name}] API error: ${error.message ?? error}`);
      throw error;
    }
  }

  private safeParseArgs(args: string): Record<string, unknown> {
    try {
      return JSON.parse(args || '{}');
    } catch {
      return {};
    }
  }
}
