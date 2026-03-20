import * as fs from 'fs';
import * as path from 'path';
import { BaseTool, ToolResult } from '../BaseTool';

// ============================================================
// CreateFileTool v2 — Creates files and signals for Telegram delivery
// ============================================================
// The output includes [FILE:path] so AgentLoop automatically
// detects it and TelegramOutputHandler sends as document.
// ============================================================

export class CreateFileTool extends BaseTool {
  readonly name = 'create_file';
  readonly description = `Creates a file and prepares it for delivery to the user via Telegram.

IMPORTANT RULES:
1. After calling this tool, you MUST include [FILE:<filepath>] in your answer so the file gets sent to the user
2. The tool returns the exact [FILE:...] tag you need to include
3. For binary documents (PDF, DOCX, XLSX), use the appropriate generation scripts via run_code or shell_exec first, then this tool's path
4. For text-based files (MD, TXT, HTML, CSV, JSON), this tool writes content directly

Example flow:
- User: "Crie um relatório"
- You call create_file(filename="relatorio.md", content="# Relatório\\n...")
- Tool returns: "File created: ./output/relatorio.md\\n[FILE:./output/relatorio.md]"
- You respond: "Aqui está seu relatório! [FILE:./output/relatorio.md]"

The [FILE:path] tag is REQUIRED in your final answer — otherwise the file won't be sent!`;

  readonly parameters = {
    type: 'object',
    properties: {
      filename: {
        type: 'string',
        description: 'Filename with extension, e.g. "report.md", "data.csv", "analysis.pdf"',
      },
      content: {
        type: 'string',
        description: 'The full content to write to the file (for text files). For binary files, pass empty string and generate separately.',
      },
      directory: {
        type: 'string',
        description: 'Optional subdirectory within ./output (default: root of output)',
      },
    },
    required: ['filename', 'content'],
  };

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const filename = String(args.filename ?? '');
    const content = String(args.content ?? '');
    const directory = String(args.directory ?? '');

    if (!filename) return { output: '', error: 'filename is required' };

    // Sanitize directory to prevent path traversal
    const safeSubdir = directory.replace(/\.\./g, '').replace(/^\//, '');
    const baseDir = path.resolve('./output');
    const targetDir = safeSubdir ? path.join(baseDir, safeSubdir) : baseDir;

    fs.mkdirSync(targetDir, { recursive: true });

    const safeName = path.basename(filename);
    const filePath = path.join(targetDir, safeName);

    fs.writeFileSync(filePath, content, 'utf-8');

    const fileSize = fs.statSync(filePath).size;
    const sizeStr = fileSize > 1024 ? `${(fileSize / 1024).toFixed(1)}KB` : `${fileSize}B`;

    // Return with [FILE:] tag so AgentLoop auto-detects it
    return {
      output: `File created successfully: ${filePath} (${sizeStr})\n\nIMPORTANT: Include this tag in your response to send the file to the user:\n[FILE:${filePath}]`,
    };
  }
}
