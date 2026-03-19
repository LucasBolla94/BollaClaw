import OpenAI from 'openai';
import { ILlmProvider, Message, ToolDefinition, LlmResponse, ToolCall } from './ILlmProvider';
import { logger } from '../utils/logger';

export class DeepSeekProvider implements ILlmProvider {
  public readonly name = 'deepseek';
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model = 'deepseek-chat') {
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://api.deepseek.com/v1',
    });
    this.model = model;
  }

  async complete(messages: Message[], tools?: ToolDefinition[]): Promise<LlmResponse> {
    const openaiMessages = messages.map((m) => ({
      role: m.role as any,
      content: m.content,
    })) as OpenAI.Chat.ChatCompletionMessageParam[];

    const openaiTools: OpenAI.Chat.ChatCompletionTool[] | undefined = tools?.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: openaiMessages,
        tools: openaiTools,
        tool_choice: tools?.length ? 'auto' : undefined,
      });

      const choice = response.choices[0];
      const toolCalls: ToolCall[] = (choice?.message.tool_calls ?? []).map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments || '{}'),
      }));

      return {
        content: choice?.message.content ?? null,
        toolCalls,
        isFinished: choice?.finish_reason === 'stop',
      };
    } catch (error) {
      logger.error(`DeepSeek API error: ${error}`);
      throw error;
    }
  }
}
