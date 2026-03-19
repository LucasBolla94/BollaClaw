import * as fs from 'fs';
import * as path from 'path';
import { BaseTool, ToolResult } from '../BaseTool';

export class ReadFileTool extends BaseTool {
  readonly name = 'read_file';
  readonly description = 'Reads the content of a file from the output directory.';
  readonly parameters = {
    type: 'object',
    properties: {
      filepath: { type: 'string', description: 'Path to the file, relative to ./output' },
    },
    required: ['filepath'],
  };

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const filepath = String(args.filepath ?? '');
    const safePath = path.resolve('./output', filepath.replace(/\.\./g, ''));

    if (!fs.existsSync(safePath)) {
      return { output: '', error: `File not found: ${safePath}` };
    }

    const content = fs.readFileSync(safePath, 'utf-8');
    return { output: content };
  }
}
