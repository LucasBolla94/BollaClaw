import { GoogleGenerativeAI, FunctionDeclaration, Tool, Part } from '@google/generative-ai';
import { ILlmProvider, Message, ToolDefinition, LlmResponse, ToolCall, CompletionOptions } from './ILlmProvider';
import { ProviderEntry } from './ProviderConfig';
import { logger } from '../utils/logger';

export class GeminiProvider implements ILlmProvider {
  public readonly name: string;
  private client: GoogleGenerativeAI;
  private model: string;

  constructor(providerName: string, entry: ProviderEntry) {
    this.name = providerName;
    this.model = entry.model || 'gemini-2.0-flash';
    this.client = new GoogleGenerativeAI(entry.apiKey);
  }

  async complete(messages: Message[], tools?: ToolDefinition[], _options?: CompletionOptions): Promise<LlmResponse> {
    const systemMessages = messages.filter((m) => m.role === 'system');
    const chatMessages = messages.filter((m) => m.role !== 'system');
    const systemInstruction = systemMessages.map((m) => m.content).join('\n\n');

    const geminiTools: Tool[] | undefined = tools?.length
      ? [
          {
            functionDeclarations: tools.map((t) => ({
              name: t.name,
              description: t.description,
              parameters: t.parameters as unknown as FunctionDeclaration['parameters'],
            })),
          },
        ]
      : undefined;

    const genModel = this.client.getGenerativeModel({
      model: this.model,
      systemInstruction: systemInstruction || undefined,
      tools: geminiTools,
    });

    // Build history with proper function call/response handling
    const history = this.buildGeminiHistory(chatMessages.slice(0, -1));

    const lastMessage = chatMessages[chatMessages.length - 1];
    const chat = genModel.startChat({ history });

    // Build the last message parts
    const lastParts = this.buildMessageParts(lastMessage);

    try {
      const result = await chat.sendMessage(lastParts);
      const response = result.response;

      const toolCalls: ToolCall[] = [];
      let textContent = '';

      for (const candidate of response.candidates ?? []) {
        for (const part of candidate.content.parts) {
          if (part.text) {
            textContent += part.text;
          } else if (part.functionCall) {
            toolCalls.push({
              id: `gemini-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
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
      logger.error(`[${this.name}] Gemini API error: ${error}`);
      throw error;
    }
  }

  /**
   * Build Gemini history with proper function call/response parts
   */
  private buildGeminiHistory(messages: Message[]): Array<{ role: string; parts: Part[] }> {
    const history: Array<{ role: string; parts: Part[] }> = [];

    for (const msg of messages) {
      if (msg.role === 'assistant') {
        const parts: Part[] = [];

        if (msg.content) {
          parts.push({ text: msg.content });
        }

        // If assistant had tool calls, add functionCall parts
        if (msg._toolUseCalls && msg._toolUseCalls.length > 0) {
          for (const tc of msg._toolUseCalls) {
            parts.push({
              functionCall: {
                name: tc.name,
                args: tc.arguments,
              },
            } as Part);
          }
        }

        if (parts.length > 0) {
          history.push({ role: 'model', parts });
        }

      } else if (msg.role === 'tool') {
        // Tool results -> functionResponse part in a 'function' role message
        // Gemini expects function responses grouped together
        const lastEntry = history[history.length - 1];
        const responsePart: Part = {
          functionResponse: {
            name: msg.name ?? 'unknown',
            response: { result: msg.content },
          },
        } as Part;

        // If last history entry is already a function role, append to it
        if (lastEntry && lastEntry.role === 'function') {
          lastEntry.parts.push(responsePart);
        } else {
          history.push({ role: 'function', parts: [responsePart] });
        }

      } else {
        // User message
        history.push({
          role: 'user',
          parts: [{ text: msg.content }],
        });
      }
    }

    return history;
  }

  /**
   * Build parts for a single message (used for the last message sent to chat)
   */
  private buildMessageParts(msg: Message): Part[] | string {
    if (msg.role === 'tool') {
      return [{
        functionResponse: {
          name: msg.name ?? 'unknown',
          response: { result: msg.content },
        },
      } as Part];
    }

    return msg.content ?? '';
  }
}
