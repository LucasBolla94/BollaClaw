import { BaseTool, ToolResult } from '../BaseTool';

export class GetDateTimeTool extends BaseTool {
  readonly name = 'get_datetime';
  readonly description = 'Returns the current date and time on the server.';
  readonly parameters = {
    type: 'object',
    properties: {},
    required: [],
  };

  async execute(_args: Record<string, unknown>): Promise<ToolResult> {
    const now = new Date();
    return {
      output: JSON.stringify({
        iso: now.toISOString(),
        local: now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
        timestamp: now.getTime(),
      }),
    };
  }
}
