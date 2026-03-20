import Groq from 'groq-sdk';
import { ILlmProvider, Message, ToolDefinition, LlmResponse, ToolCall, CompletionOptions } from './ILlmProvider';
import { logger } from '../utils/logger';

export class GroqProvider implements ILlmProvider {
  public readonly name = 'groq';
  private client: Groq;
  private model: string;

  constructor(apiKey: string, model = 'llama-3.3-70b-versatile') {
    this.client = new Groq({ apiKey });
    this.model = model;
  }

  async complete(messages: Message[], tools?: ToolDefinition[], _options?: CompletionOptions): Promise<LlmResponse> {
    const groqMessages = messages.map((m) => ({
      role: m.role as any,
      content: m.content,
    })) as Groq.Chat.ChatCompletionMessageParam[];

    const groqTools: Groq.Chat.ChatCompletionTool[] | undefined = tools?.map((t) => ({
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
        messages: groqMessages,
        tools: groqTools,
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
      logger.error(`Groq API error: ${error}`);
      throw error;
    }
  }
}
