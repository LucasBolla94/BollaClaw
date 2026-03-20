import { BaseTool, ToolResult } from '../BaseTool';
import { SandboxExecutor, ExecutionMode } from '../../sandbox/SandboxExecutor';
import { logger } from '../../utils/logger';

// ============================================================
// ShellTool — Execute shell commands (sandbox or direct)
// ============================================================
// The agent can run commands on the server. By default, commands
// run in sandbox mode (whitelisted commands only). The agent can
// request direct mode for trusted operations.
// ============================================================

// Singleton sandbox instance
let sandboxInstance: SandboxExecutor | null = null;

function getSandbox(): SandboxExecutor {
  if (!sandboxInstance) {
    sandboxInstance = new SandboxExecutor();
  }
  return sandboxInstance;
}

export class ShellTool extends BaseTool {
  readonly name = 'shell_exec';
  readonly description = `Execute a shell command on the server. Commands run in SANDBOX mode by default (safe, whitelisted commands like python3, node, git, curl, ls, grep, etc). Set mode to "direct" only for trusted system operations that need full access. Returns stdout, stderr, and exit code.`;

  readonly parameters = {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute. Examples: "python3 script.py", "ls -la", "git status", "curl https://api.example.com"',
      },
      mode: {
        type: 'string',
        description: 'Execution mode: "sandbox" (default, safe) or "direct" (unrestricted, for trusted operations only)',
      },
      cwd: {
        type: 'string',
        description: 'Working directory (optional). Defaults to sandbox workspace or project root.',
      },
    },
    required: ['command'],
  };

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const command = String(args.command || '').trim();
    const mode = (String(args.mode || 'sandbox') as ExecutionMode);
    const cwd = args.cwd ? String(args.cwd) : undefined;

    if (!command) {
      return { output: '', error: 'Command is required' };
    }

    const sandbox = getSandbox();

    // Validate first (for better error messages)
    if (mode === 'sandbox') {
      const validation = sandbox.validate(command);
      if (!validation.allowed) {
        return {
          output: '',
          error: `Command not allowed in sandbox mode: ${validation.reason}\n\nTip: Use mode="direct" for trusted operations, or use a whitelisted command.`,
        };
      }
    }

    const result = await sandbox.execute(command, mode, cwd);

    if (result.error) {
      // Return both output and error for the agent to analyze
      const output = result.stdout ? `stdout:\n${result.stdout}\n\n` : '';
      return {
        output: output + (result.stderr ? `stderr:\n${result.stderr}` : ''),
        error: result.error,
      };
    }

    // Format output for the agent
    let output = result.stdout;
    if (result.stderr) {
      output += output ? '\n' : '';
      output += `[stderr]: ${result.stderr}`;
    }
    if (result.truncated) {
      output += '\n[output was truncated]';
    }

    return { output: output || '(no output)' };
  }
}

export class CodeRunnerTool extends BaseTool {
  readonly name = 'run_code';
  readonly description = `Execute a code snippet in a sandboxed environment. Supports Python, Node.js, and Bash. The code is written to a temporary file and executed. Returns the output. Use this for testing code, running calculations, data processing, etc.`;

  readonly parameters = {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'The code to execute',
      },
      language: {
        type: 'string',
        description: 'Programming language: "python" (default), "javascript", or "bash"',
      },
      timeout: {
        type: 'number',
        description: 'Max execution time in seconds (default: 30, max: 120)',
      },
    },
    required: ['code'],
  };

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const code = String(args.code || '');
    const language = String(args.language || 'python').toLowerCase();
    const timeout = Math.min(Number(args.timeout) || 30, 120) * 1000;

    if (!code.trim()) {
      return { output: '', error: 'Code is required' };
    }

    const sandbox = getSandbox();
    const taskId = `code_${Date.now()}`;
    const taskDir = sandbox.createTaskWorkspace(taskId);

    try {
      // Determine file extension and runner
      let filename: string;
      let runner: string;

      switch (language) {
        case 'python':
        case 'py':
          filename = 'script.py';
          runner = 'python3';
          break;
        case 'javascript':
        case 'js':
        case 'node':
          filename = 'script.js';
          runner = 'node';
          break;
        case 'bash':
        case 'sh':
          filename = 'script.sh';
          runner = 'bash';
          break;
        default:
          return { output: '', error: `Unsupported language: ${language}. Use python, javascript, or bash.` };
      }

      // Write code to temp file
      const filePath = require('path').join(taskDir, filename);
      require('fs').writeFileSync(filePath, code, 'utf-8');

      // Execute
      const result = await sandbox.executeSandboxed(`${runner} "${filePath}"`, taskDir);

      if (result.error && !result.stdout) {
        return { output: '', error: result.error };
      }

      let output = result.stdout;
      if (result.stderr) {
        output += output ? '\n' : '';
        output += `[stderr]: ${result.stderr}`;
      }

      return { output: output || '(no output)' };

    } finally {
      // Cleanup
      try {
        sandbox.cleanupTaskWorkspace(taskId);
      } catch {
        logger.warn(`[CodeRunner] Failed to cleanup workspace for ${taskId}`);
      }
    }
  }
}
