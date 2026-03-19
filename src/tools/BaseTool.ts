export interface ToolResult {
  output: string;
  error?: string;
}

export abstract class BaseTool {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly parameters: Record<string, unknown>;

  abstract execute(args: Record<string, unknown>): Promise<ToolResult>;

  toDefinition() {
    return {
      name: this.name,
      description: this.description,
      parameters: this.parameters,
    };
  }
}
