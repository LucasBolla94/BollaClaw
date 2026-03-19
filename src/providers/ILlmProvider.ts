export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  name?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LlmResponse {
  content: string | null;
  toolCalls: ToolCall[];
  isFinished: boolean;
}

export interface ILlmProvider {
  name: string;
  complete(messages: Message[], tools?: ToolDefinition[]): Promise<LlmResponse>;
}
