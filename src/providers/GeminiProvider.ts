import { GoogleGenerativeAI, FunctionDeclaration, Tool } from '@google/generative-ai';
import { ILlmProvider, Message, ToolDefinition, LlmResponse, ToolCall } from './ILlmProvider';
import { logger } from '../utils/logger';

export class GeminiProvider implements ILlmProvider {
  public readonly name = 'gemini';
  private client: GoogleGenerativeAI;
  private model: string;

  constructor(apiKey: string, model = 'gemini-1.5-flash') {
    this.client = new GoogleGenerativeAI(apiKey);
    this.model = model;
  }

  async complete(messages: Message[], tools?: ToolDefinition[]): Promise<LlmResponse> {
    const systemMessages = messages.filter((m) => m.role === 'system');
    const chatMessages = messages.filter((m) => m.role !== 'system');
    const systemInstruction = systemMessages.map((m) => m.content).join('\n\n');

    const geminiTools: Tool[] | undefined = tools?.length
      ? [
          {
            functionDeclarations: tools.map((t) => ({
              name: t.name,
              description: t.description,
              parameters: t.parameters as FunctionDeclaration['parameters'],
            })),
          },
        ]
      : undefined;

    const genModel = this.client.getGenerativeModel({
      model: this.model,
      systemInstruction: systemInstruction || undefined,
      tools: geminiTools,
    });

    const history = chatMessages.slice(0, -1).map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const lastMessage = chatMessages[chatMessages.length - 1];
    const chat = genModel.startChat({ history });

    try {
      const result = await chat.sendMessage(lastMessage?.content ?? '');
      const response = result.response;

      const toolCalls: ToolCall[] = [];
      let textContent = '';

      for (const candidate of response.candidates ?? []) {
        for (const part of candidate.content.parts) {
          if (part.text) {
            textContent += part.text;
          } else if (part.functionCall) {
            toolCalls.push({
              id: `gemini-${Date.now()}`,
              name: part.functionCall.name,
              arguments: part.functionCall.args as Record<string, unknown>,
            });
          }
        }
      }

      return {
        content: textContent || null,
        toolCalls,
        isFinished: true,
      };
    } catch (error) {
      logger.error(`Gemini API error: ${error}`);
      throw error;
    }
  }
}
