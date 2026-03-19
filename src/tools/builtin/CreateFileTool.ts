import * as fs from 'fs';
import * as path from 'path';
import { BaseTool, ToolResult } from '../BaseTool';

export class CreateFileTool extends BaseTool {
  readonly name = 'create_file';
  readonly description = 'Creates or overwrites a file with the given content. Use for generating documents, scripts, configs, etc.';
  readonly parameters = {
    type: 'object',
    properties: {
      filename: { type: 'string', description: 'Filename with extension, e.g. "report.md" or "script.sh"' },
      content: { type: 'string', description: 'The full content to write to the file' },
      directory: { type: 'string', description: 'Optional subdirectory within ./output (default: "output")' },
    },
    required: ['filename', 'content'],
  };

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const filename = String(args.filename ?? '');
    const content = String(args.content ?? '');
    const directory = String(args.directory ?? 'output');

    if (!filename) return { output: '', error: 'filename is required' };

    const safeDir = path.resolve('./output', directory.replace(/\.\./g, ''));
    fs.mkdirSync(safeDir, { recursive: true });

    const filePath = path.join(safeDir, path.basename(filename));
    fs.writeFileSync(filePath, content, 'utf-8');

    return { output: `File created successfully: ${filePath}` };
  }
}
