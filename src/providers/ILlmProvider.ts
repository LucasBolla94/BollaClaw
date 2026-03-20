export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  name?: string;
  /** Carries tool call info on assistant messages so providers can reconstruct native format */
  _toolUseCalls?: ToolCall[];
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

export interface CompletionOptions {
  /** Force the model to use a tool. 'auto' = model decides, 'required' = must use a tool, 'none' = no tools */
  toolChoice?: 'auto' | 'required' | 'none';
}

export interface ILlmProvider {
  name: string;
  complete(messages: Message[], tools?: ToolDefinition[], options?: CompletionOptions): Promise<LlmResponse>;
}
