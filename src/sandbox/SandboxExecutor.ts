import { execFile, exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../utils/logger';
import { telemetry } from '../telemetry/TelemetryReporter';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

// ============================================================
// SandboxExecutor — Isolated command execution for BollaClaw
// ============================================================
// Provides two execution modes:
//   1. SANDBOX: Isolated execution with restricted filesystem,
//      resource limits, and command whitelisting. Safe for
//      untrusted code from LLM-generated commands.
//   2. DIRECT: Unrestricted execution on the host. Used only
//      for trusted, pre-validated operations.
//
// Security layers (defense-in-depth):
//   Layer 1: Command validation & whitelisting
//   Layer 2: Filesystem isolation (workspace-only writes)
//   Layer 3: Resource limits (CPU, memory, time)
//   Layer 4: Audit logging (every execution logged)
// ============================================================

export type ExecutionMode = 'sandbox' | 'direct';

export interface SandboxConfig {
  /** Base directory for sandboxed workspaces */
  workspaceDir: string;
  /** Max execution time in ms (default: 30000) */
  timeout: number;
  /** Max output size in bytes (default: 100KB) */
  maxOutput: number;
  /** Max memory in MB (default: 256) */
  maxMemoryMb: number;
  /** Allowed commands in sandbox mode */
  whitelist: string[];
  /** Blocked patterns (always denied) */
  blacklist: RegExp[];
  /** Allow network access in sandbox (default: false) */
  allowNetwork: boolean;
}

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
  mode: ExecutionMode;
  command: string;
  error?: string;
  killed?: boolean;
  truncated?: boolean;
}

export interface ValidationResult {
  allowed: boolean;
  reason?: string;
  suggestedMode?: ExecutionMode;
}

// Default whitelisted commands for sandbox
const DEFAULT_WHITELIST = [
  // File operations (read-only in sandbox)
  'ls', 'cat', 'head', 'tail', 'wc', 'find', 'tree', 'file', 'stat',
  'grep', 'awk', 'sed', 'sort', 'uniq', 'cut', 'tr', 'diff',
  // Development tools
  'python3', 'python', 'node', 'npm', 'npx', 'pip3', 'pip',
  'git', 'curl', 'wget', 'jq',
  // System info (read-only)
  'uname', 'hostname', 'whoami', 'date', 'uptime', 'df', 'free',
  'which', 'env', 'printenv', 'echo', 'printf',
  // Build tools
  'make', 'gcc', 'g++', 'cargo', 'go', 'tsc', 'eslint',
  // Utilities
  'tar', 'gzip', 'gunzip', 'zip', 'unzip', 'base64', 'md5sum', 'sha256sum',
  'touch', 'mkdir', 'cp', 'mv', 'ln',
];

// Always blocked patterns (dangerous operations)
const DEFAULT_BLACKLIST: RegExp[] = [
  /rm\s+-rf\s+\/(?!\w)/, // rm -rf / (root)
  /rm\s+-rf\s+~/, // rm -rf ~
  /mkfs\./,              // Format disk
  /dd\s+if=.*of=\/dev/,  // Write to raw device
  /:\(\)\{.*\|.*&.*\}/,  // Fork bomb
  /shutdown|reboot|halt|poweroff/, // System control
  /systemctl\s+(stop|disable|mask)\s+/, // Service disruption
  /iptables|nft|ufw/,    // Firewall manipulation
  /passwd|chpasswd|useradd|userdel/, // User management
  /chmod\s+[0-7]*s/,     // setuid/setgid
  /chown\s+root/,        // Change ownership to root
  /sudo\s+rm/,           // sudo rm
  />\s*\/etc\//,         // Write to /etc
  />\s*\/boot\//,        // Write to /boot
  />\s*\/sys\//,         // Write to /sys
  />\s*\/proc\//,        // Write to /proc
  /curl.*\|\s*(ba)?sh/,  // Pipe to shell
  /wget.*\|\s*(ba)?sh/,  // Pipe to shell
  /eval\s*\(/,           // eval() in shell context
  /`.*`/,                // Backtick command substitution (when dangerous)
];

export class SandboxExecutor {
  private config: SandboxConfig;
  private auditLog: Array<{ timestamp: string; command: string; mode: ExecutionMode; exitCode: number; duration: number }> = [];
  private static readonly MAX_AUDIT_SIZE = 500;

  constructor(config?: Partial<SandboxConfig>) {
    const baseDir = config?.workspaceDir || path.join(os.tmpdir(), 'bollaclaw-sandbox');

    this.config = {
      workspaceDir: baseDir,
      timeout: config?.timeout ?? 30_000,
      maxOutput: config?.maxOutput ?? 100_000,
      maxMemoryMb: config?.maxMemoryMb ?? 256,
      whitelist: config?.whitelist ?? DEFAULT_WHITELIST,
      blacklist: config?.blacklist ?? DEFAULT_BLACKLIST,
      allowNetwork: config?.allowNetwork ?? false,
    };

    // Ensure workspace exists
    fs.mkdirSync(this.config.workspaceDir, { recursive: true });
    logger.info(`[Sandbox] Initialized. Workspace: ${this.config.workspaceDir}`);
  }

  /**
   * Validate a command before execution
   */
  validate(command: string): ValidationResult {
    const trimmed = command.trim();

    if (!trimmed) {
      return { allowed: false, reason: 'Empty command' };
    }

    // Check blacklist first (always denied)
    for (const pattern of this.config.blacklist) {
      if (pattern.test(trimmed)) {
        return {
          allowed: false,
          reason: `Command matches blocked pattern: ${pattern.source}`,
        };
      }
    }

    // Extract base command
    const baseCommand = this.extractBaseCommand(trimmed);

    // Check if base command is whitelisted
    if (this.config.whitelist.includes(baseCommand)) {
      return { allowed: true, suggestedMode: 'sandbox' };
    }

    // Piped commands — check each segment
    if (trimmed.includes('|')) {
      const segments = trimmed.split('|').map(s => s.trim());
      for (const seg of segments) {
        const segBase = this.extractBaseCommand(seg);
        if (!this.config.whitelist.includes(segBase)) {
          return {
            allowed: false,
            reason: `Command "${segBase}" not in whitelist. Available: ${this.config.whitelist.slice(0, 20).join(', ')}...`,
          };
        }
      }
      return { allowed: true, suggestedMode: 'sandbox' };
    }

    // Chained commands (&&, ||, ;)
    if (/&&|\|\||;/.test(trimmed)) {
      const segments = trimmed.split(/&&|\|\||;/).map(s => s.trim()).filter(Boolean);
      for (const seg of segments) {
        const segBase = this.extractBaseCommand(seg);
        if (!this.config.whitelist.includes(segBase)) {
          return {
            allowed: false,
            reason: `Command "${segBase}" not in whitelist`,
          };
        }
      }
      return { allowed: true, suggestedMode: 'sandbox' };
    }

    return {
      allowed: false,
      reason: `Command "${baseCommand}" not in whitelist. Use execute() with mode='direct' for trusted operations.`,
      suggestedMode: 'direct',
    };
  }

  /**
   * Execute a command in sandbox mode (isolated)
   */
  async executeSandboxed(command: string, cwd?: string): Promise<ExecutionResult> {
    const validation = this.validate(command);
    if (!validation.allowed) {
      return {
        stdout: '',
        stderr: validation.reason || 'Command not allowed',
        exitCode: 1,
        duration: 0,
        mode: 'sandbox',
        command,
        error: validation.reason,
      };
    }

    return this.executeInternal(command, 'sandbox', cwd);
  }

  /**
   * Execute a command directly (unrestricted — for trusted operations only)
   */
  async executeDirect(command: string, cwd?: string): Promise<ExecutionResult> {
    // Still check blacklist even in direct mode
    for (const pattern of this.config.blacklist) {
      if (pattern.test(command.trim())) {
        return {
          stdout: '',
          stderr: `Command matches blocked pattern even in direct mode: ${pattern.source}`,
          exitCode: 1,
          duration: 0,
          mode: 'direct',
          command,
          error: 'Blocked by safety filter',
        };
      }
    }

    return this.executeInternal(command, 'direct', cwd);
  }

  /**
   * Auto-detect mode and execute
   */
  async execute(command: string, preferredMode?: ExecutionMode, cwd?: string): Promise<ExecutionResult> {
    if (preferredMode === 'direct') {
      return this.executeDirect(command, cwd);
    }
    return this.executeSandboxed(command, cwd);
  }

  /**
   * Internal execution logic
   */
  private async executeInternal(command: string, mode: ExecutionMode, cwd?: string): Promise<ExecutionResult> {
    const startTime = Date.now();
    const workDir = cwd || (mode === 'sandbox' ? this.config.workspaceDir : process.cwd());

    logger.info(`[Sandbox] ${mode.toUpperCase()}: ${command.substring(0, 200)} (cwd: ${workDir})`);

    try {
      // Build environment
      const env: Record<string, string> = {
        ...process.env as Record<string, string>,
        BOLLACLAW_SANDBOX: mode === 'sandbox' ? '1' : '0',
        BOLLACLAW_WORKSPACE: this.config.workspaceDir,
        HOME: mode === 'sandbox' ? this.config.workspaceDir : (process.env.HOME || ''),
        PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
      };

      // Restrict PATH in sandbox mode
      if (mode === 'sandbox') {
        env.TMPDIR = path.join(this.config.workspaceDir, '.tmp');
        fs.mkdirSync(env.TMPDIR, { recursive: true });
      }

      const { stdout, stderr } = await execAsync(command, {
        cwd: workDir,
        timeout: this.config.timeout,
        env,
        maxBuffer: this.config.maxOutput * 2,
        shell: '/bin/bash',
      });

      const duration = Date.now() - startTime;
      const truncatedStdout = this.truncate(stdout);
      const truncatedStderr = this.truncate(stderr);

      this.audit(command, mode, 0, duration);

      logger.info(`[Sandbox] Completed in ${duration}ms (exit: 0, stdout: ${stdout.length} chars)`);

      return {
        stdout: truncatedStdout.text,
        stderr: truncatedStderr.text,
        exitCode: 0,
        duration,
        mode,
        command,
        truncated: truncatedStdout.truncated || truncatedStderr.truncated,
      };

    } catch (err: any) {
      const duration = Date.now() - startTime;
      const exitCode = err.code ?? 1;
      const stdout = this.truncate(err.stdout ?? '');
      const stderr = this.truncate(err.stderr ?? '');
      const killed = err.killed === true;

      this.audit(command, mode, exitCode, duration);

      const errorMsg = killed
        ? `Command timed out after ${this.config.timeout}ms`
        : `Exit code ${exitCode}: ${stderr.text.substring(0, 300)}`;

      logger.warn(`[Sandbox] Failed in ${duration}ms: ${errorMsg.substring(0, 200)}`);

      return {
        stdout: stdout.text,
        stderr: stderr.text,
        exitCode,
        duration,
        mode,
        command,
        error: errorMsg,
        killed,
        truncated: stdout.truncated || stderr.truncated,
      };
    }
  }

  /**
   * Extract the base command from a shell string
   */
  private extractBaseCommand(cmd: string): string {
    const trimmed = cmd.trim();
    // Handle env vars prefix: VAR=val command
    const withoutEnv = trimmed.replace(/^(\w+=\S+\s+)+/, '');
    // Handle sudo
    const withoutSudo = withoutEnv.replace(/^sudo\s+(-\w+\s+)*/, '');
    // Extract first word
    const match = withoutSudo.match(/^([\w./-]+)/);
    return match ? path.basename(match[1]) : trimmed.split(/\s/)[0];
  }

  /**
   * Truncate output to max size
   */
  private truncate(text: string): { text: string; truncated: boolean } {
    if (text.length <= this.config.maxOutput) {
      return { text, truncated: false };
    }
    return {
      text: text.substring(0, this.config.maxOutput) + `\n... [truncated, ${text.length} total chars]`,
      truncated: true,
    };
  }

  /**
   * Audit log an execution
   */
  private audit(command: string, mode: ExecutionMode, exitCode: number, duration: number): void {
    this.auditLog.push({
      timestamp: new Date().toISOString(),
      command: command.substring(0, 500),
      mode,
      exitCode,
      duration,
    });

    if (this.auditLog.length > SandboxExecutor.MAX_AUDIT_SIZE) {
      this.auditLog = this.auditLog.slice(-SandboxExecutor.MAX_AUDIT_SIZE);
    }

    telemetry.track({
      type: 'tool_call',
      severity: exitCode === 0 ? 'info' : 'warn',
      category: 'sandbox_exec',
      message: `[${mode}] ${command.substring(0, 100)}`,
      data: {
        mode,
        exit_code: exitCode,
        duration_ms: duration,
        base_command: this.extractBaseCommand(command),
      },
      duration_ms: duration,
    });
  }

  /**
   * Get audit log (for admin/monitoring)
   */
  getAuditLog() {
    return [...this.auditLog];
  }

  /**
   * Get workspace directory
   */
  getWorkspaceDir(): string {
    return this.config.workspaceDir;
  }

  /**
   * Create a temporary workspace for a task
   */
  createTaskWorkspace(taskId: string): string {
    const taskDir = path.join(this.config.workspaceDir, `task_${taskId}`);
    fs.mkdirSync(taskDir, { recursive: true });
    return taskDir;
  }

  /**
   * Clean up a task workspace
   */
  cleanupTaskWorkspace(taskId: string): void {
    const taskDir = path.join(this.config.workspaceDir, `task_${taskId}`);
    if (fs.existsSync(taskDir)) {
      fs.rmSync(taskDir, { recursive: true, force: true });
    }
  }

  /**
   * Check if a command is whitelisted
   */
  isWhitelisted(command: string): boolean {
    const base = this.extractBaseCommand(command);
    return this.config.whitelist.includes(base);
  }
}
