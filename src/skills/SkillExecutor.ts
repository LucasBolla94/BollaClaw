import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { Skill } from './SkillLoader';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
  error?: string;
}

export interface ExecutionOptions {
  args?: Record<string, unknown>;   // Arguments passed as JSON to stdin or CLI args
  env?: Record<string, string>;     // Extra env vars
  timeout?: number;                 // Timeout in ms (default: 30000)
  cwd?: string;                     // Working directory (default: skill dir)
}

export class SkillExecutor {
  private static readonly DEFAULT_TIMEOUT = 30_000;    // 30s
  private static readonly MAX_TIMEOUT = 300_000;       // 5min
  private static readonly MAX_OUTPUT = 50_000;         // 50KB max output

  /**
   * Execute the skill's main entrypoint script
   */
  async executeSkill(skill: Skill, options: ExecutionOptions = {}): Promise<ExecutionResult> {
    const entrypoint = this.resolveEntrypoint(skill);
    if (!entrypoint) {
      return {
        stdout: '',
        stderr: '',
        exitCode: 1,
        duration: 0,
        error: `Skill "${skill.name}" has no executable entrypoint. Add scripts/main.py, scripts/main.ts, or scripts/main.sh`,
      };
    }

    const runtime = skill.runtime ?? this.detectRuntime(entrypoint);
    return this.executeScript(entrypoint, runtime, skill.dirPath, options);
  }

  /**
   * Execute a specific script file from a skill
   */
  async executeScript(
    scriptPath: string,
    runtime: 'python' | 'node' | 'bash',
    cwd: string,
    options: ExecutionOptions = {}
  ): Promise<ExecutionResult> {
    if (!fs.existsSync(scriptPath)) {
      return {
        stdout: '',
        stderr: '',
        exitCode: 1,
        duration: 0,
        error: `Script not found: ${scriptPath}`,
      };
    }

    const command = this.buildCommand(scriptPath, runtime, options);
    const timeout = Math.min(options.timeout ?? SkillExecutor.DEFAULT_TIMEOUT, SkillExecutor.MAX_TIMEOUT);
    const env = this.buildEnv(options.env);

    logger.info(`[SkillExecutor] Running: ${command} (timeout: ${timeout}ms, cwd: ${options.cwd ?? cwd})`);

    const startTime = Date.now();

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: options.cwd ?? cwd,
        timeout,
        env,
        maxBuffer: 1024 * 1024, // 1MB buffer
      });

      const duration = Date.now() - startTime;
      const trimmedStdout = this.truncateOutput(stdout);
      const trimmedStderr = this.truncateOutput(stderr);

      logger.info(`[SkillExecutor] Completed in ${duration}ms (exit: 0, stdout: ${stdout.length} chars)`);

      return {
        stdout: trimmedStdout,
        stderr: trimmedStderr,
        exitCode: 0,
        duration,
      };
    } catch (err: any) {
      const duration = Date.now() - startTime;
      const exitCode = err.code ?? 1;
      const stdout = this.truncateOutput(err.stdout ?? '');
      const stderr = this.truncateOutput(err.stderr ?? '');

      logger.warn(`[SkillExecutor] Failed in ${duration}ms (exit: ${exitCode}): ${stderr.substring(0, 200)}`);

      return {
        stdout,
        stderr,
        exitCode,
        duration,
        error: err.killed
          ? `Script timed out after ${timeout}ms`
          : `Script exited with code ${exitCode}: ${stderr.substring(0, 500)}`,
      };
    }
  }

  /**
   * Resolve the entrypoint script for a skill
   */
  private resolveEntrypoint(skill: Skill): string | null {
    // Explicit entrypoint in frontmatter
    if (skill.entrypoint) {
      const explicit = path.resolve(skill.dirPath, skill.entrypoint);
      if (fs.existsSync(explicit)) return explicit;
    }

    // Convention-based: scripts/main.{py,ts,js,sh}
    const candidates = [
      'scripts/main.py',
      'scripts/main.ts',
      'scripts/main.js',
      'scripts/main.sh',
      'scripts/index.py',
      'scripts/index.ts',
      'scripts/index.js',
    ];

    for (const candidate of candidates) {
      const full = path.join(skill.dirPath, candidate);
      if (fs.existsSync(full)) return full;
    }

    // Fallback: first script file found
    if (skill.scripts.length > 0) return skill.scripts[0];

    return null;
  }

  /**
   * Build the shell command to execute a script
   */
  private buildCommand(
    scriptPath: string,
    runtime: 'python' | 'node' | 'bash',
    options: ExecutionOptions
  ): string {
    const argsJson = options.args ? JSON.stringify(options.args) : '';

    // Sanitize the args for shell
    const escapedArgs = argsJson.replace(/'/g, "'\\''");

    switch (runtime) {
      case 'python':
        if (argsJson) {
          return `echo '${escapedArgs}' | python3 "${scriptPath}"`;
        }
        return `python3 "${scriptPath}"`;

      case 'node': {
        // For .ts files, use ts-node if available, else node for .js
        const ext = path.extname(scriptPath);
        const runner = ext === '.ts' ? 'npx ts-node' : 'node';
        if (argsJson) {
          return `echo '${escapedArgs}' | ${runner} "${scriptPath}"`;
        }
        return `${runner} "${scriptPath}"`;
      }

      case 'bash':
        if (argsJson) {
          return `echo '${escapedArgs}' | bash "${scriptPath}"`;
        }
        return `bash "${scriptPath}"`;

      default:
        return `python3 "${scriptPath}"`;
    }
  }

  /**
   * Build the environment variables for script execution
   */
  private buildEnv(extra?: Record<string, string>): Record<string, string> {
    return {
      ...process.env as Record<string, string>,
      BOLLACLAW_SKILL: 'true',
      BOLLACLAW_VERSION: '0.1.0',
      ...extra,
    };
  }

  /**
   * Detect runtime from file extension
   */
  private detectRuntime(scriptPath: string): 'python' | 'node' | 'bash' {
    const ext = path.extname(scriptPath).toLowerCase();
    switch (ext) {
      case '.py': return 'python';
      case '.ts':
      case '.js': return 'node';
      case '.sh': return 'bash';
      default: return 'python';
    }
  }

  /**
   * Truncate output to prevent memory issues
   */
  private truncateOutput(output: string): string {
    if (output.length <= SkillExecutor.MAX_OUTPUT) return output;
    return output.substring(0, SkillExecutor.MAX_OUTPUT) + `\n... [truncated, ${output.length} total chars]`;
  }

  /**
   * Validate that a skill's dependencies are available
   */
  async checkDependencies(skill: Skill): Promise<{ ok: boolean; missing: string[] }> {
    const missing: string[] = [];

    // Check runtime
    if (skill.runtime === 'python') {
      try { await execAsync('python3 --version'); } catch { missing.push('python3'); }
    }

    // Check API env vars
    if (skill.api?.envVars) {
      for (const envVar of skill.api.envVars) {
        if (!process.env[envVar]) {
          missing.push(`env:${envVar}`);
        }
      }
    }

    return { ok: missing.length === 0, missing };
  }
}
