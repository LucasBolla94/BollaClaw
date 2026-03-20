import { logger } from '../utils/logger';

// ============================================================
// HookManager — Execution control hooks for BollaClaw
// ============================================================
// Hooks intercept tool execution at key points:
//   - PreToolUse: Before a tool runs (can block, modify, log)
//   - PostToolUse: After a tool runs (can audit, analyze)
//   - OnError: When a tool fails (can retry, recover)
//
// Inspired by Claude Agent SDK hook architecture.
// Hooks run OUTSIDE the agent context (no token cost).
// ============================================================

export type HookEvent = 'PreToolUse' | 'PostToolUse' | 'OnError';
export type HookDecision = 'allow' | 'deny' | 'modify';

export interface PreToolHookInput {
  toolName: string;
  args: Record<string, unknown>;
  timestamp: number;
}

export interface PostToolHookInput {
  toolName: string;
  args: Record<string, unknown>;
  result: string;
  error?: string;
  durationMs: number;
  timestamp: number;
}

export interface ErrorHookInput {
  toolName: string;
  args: Record<string, unknown>;
  error: string;
  attempt: number;
  timestamp: number;
}

export interface HookResult {
  decision: HookDecision;
  reason?: string;
  /** Modified args (only if decision is 'modify') */
  modifiedArgs?: Record<string, unknown>;
  /** Context to inject into the agent (appears as system message) */
  injectContext?: string;
}

export type HookCallback<T = unknown> = (input: T) => Promise<HookResult | void>;

interface HookRegistration<T = unknown> {
  /** Regex pattern to match tool names */
  matcher: RegExp;
  /** The callback function */
  callback: HookCallback<T>;
  /** Priority (higher = runs first) */
  priority: number;
  /** Hook name for logging */
  name: string;
}

export class HookManager {
  private preToolHooks: HookRegistration<PreToolHookInput>[] = [];
  private postToolHooks: HookRegistration<PostToolHookInput>[] = [];
  private errorHooks: HookRegistration<ErrorHookInput>[] = [];

  /**
   * Register a PreToolUse hook
   */
  onPreToolUse(
    name: string,
    matcher: string | RegExp,
    callback: HookCallback<PreToolHookInput>,
    priority = 0
  ): void {
    const re = typeof matcher === 'string' ? new RegExp(matcher) : matcher;
    this.preToolHooks.push({ matcher: re, callback, priority, name });
    this.preToolHooks.sort((a, b) => b.priority - a.priority);
    logger.info(`[HookManager] Registered PreToolUse hook: ${name} (pattern: ${re.source})`);
  }

  /**
   * Register a PostToolUse hook
   */
  onPostToolUse(
    name: string,
    matcher: string | RegExp,
    callback: HookCallback<PostToolHookInput>,
    priority = 0
  ): void {
    const re = typeof matcher === 'string' ? new RegExp(matcher) : matcher;
    this.postToolHooks.push({ matcher: re, callback, priority, name });
    this.postToolHooks.sort((a, b) => b.priority - a.priority);
    logger.info(`[HookManager] Registered PostToolUse hook: ${name} (pattern: ${re.source})`);
  }

  /**
   * Register an OnError hook
   */
  onError(
    name: string,
    matcher: string | RegExp,
    callback: HookCallback<ErrorHookInput>,
    priority = 0
  ): void {
    const re = typeof matcher === 'string' ? new RegExp(matcher) : matcher;
    this.errorHooks.push({ matcher: re, callback, priority, name });
    this.errorHooks.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Execute PreToolUse hooks. Returns final decision.
   * Priority: deny > modify > allow
   */
  async executePreHooks(input: PreToolHookInput): Promise<HookResult> {
    const matching = this.preToolHooks.filter(h => h.matcher.test(input.toolName));

    if (matching.length === 0) {
      return { decision: 'allow' };
    }

    let finalResult: HookResult = { decision: 'allow' };
    const contexts: string[] = [];

    for (const hook of matching) {
      try {
        const result = await hook.callback(input);
        if (!result) continue;

        if (result.injectContext) {
          contexts.push(result.injectContext);
        }

        // Deny takes highest priority
        if (result.decision === 'deny') {
          logger.info(`[HookManager] PreToolUse DENIED by "${hook.name}" for ${input.toolName}: ${result.reason || ''}`);
          return {
            ...result,
            injectContext: contexts.length > 0 ? contexts.join('\n') : undefined,
          };
        }

        // Modify takes second priority
        if (result.decision === 'modify') {
          finalResult = result;
          // Update input args for subsequent hooks
          if (result.modifiedArgs) {
            input.args = result.modifiedArgs;
          }
        }
      } catch (err) {
        logger.warn(`[HookManager] PreToolUse hook "${hook.name}" failed: ${err}`);
      }
    }

    if (contexts.length > 0) {
      finalResult.injectContext = contexts.join('\n');
    }

    return finalResult;
  }

  /**
   * Execute PostToolUse hooks (informational, cannot block)
   */
  async executePostHooks(input: PostToolHookInput): Promise<string | undefined> {
    const matching = this.postToolHooks.filter(h => h.matcher.test(input.toolName));
    const contexts: string[] = [];

    for (const hook of matching) {
      try {
        const result = await hook.callback(input);
        if (result?.injectContext) {
          contexts.push(result.injectContext);
        }
      } catch (err) {
        logger.warn(`[HookManager] PostToolUse hook "${hook.name}" failed: ${err}`);
      }
    }

    return contexts.length > 0 ? contexts.join('\n') : undefined;
  }

  /**
   * Execute OnError hooks
   */
  async executeErrorHooks(input: ErrorHookInput): Promise<HookResult> {
    const matching = this.errorHooks.filter(h => h.matcher.test(input.toolName));

    for (const hook of matching) {
      try {
        const result = await hook.callback(input);
        if (result) return result;
      } catch (err) {
        logger.warn(`[HookManager] OnError hook "${hook.name}" failed: ${err}`);
      }
    }

    return { decision: 'allow' }; // Default: let error propagate normally
  }

  /**
   * Get registered hooks summary
   */
  getHooksSummary() {
    return {
      preToolUse: this.preToolHooks.map(h => ({ name: h.name, pattern: h.matcher.source })),
      postToolUse: this.postToolHooks.map(h => ({ name: h.name, pattern: h.matcher.source })),
      onError: this.errorHooks.map(h => ({ name: h.name, pattern: h.matcher.source })),
    };
  }

  /**
   * Remove all hooks (useful for testing/reset)
   */
  clear(): void {
    this.preToolHooks = [];
    this.postToolHooks = [];
    this.errorHooks = [];
  }
}

// ============================================================
// Default hooks — safety and audit
// ============================================================

/**
 * Create a HookManager with sensible default hooks
 */
export function createDefaultHookManager(): HookManager {
  const manager = new HookManager();

  // Audit: log all shell executions
  manager.onPostToolUse('audit-shell', /shell_exec|run_code/, async (input) => {
    logger.info(`[Audit] Tool: ${input.toolName}, Duration: ${input.durationMs}ms, Error: ${input.error || 'none'}`);
  });

  // Safety: warn on file system modifications
  manager.onPreToolUse('safety-write-check', /create_file/, async (input) => {
    const filename = String(input.args.filename || '');
    // Block writes to sensitive paths
    if (filename.includes('..') || filename.startsWith('/')) {
      return {
        decision: 'deny',
        reason: 'Path traversal or absolute path not allowed',
      };
    }
    return { decision: 'allow' };
  }, 10);

  // Safety: block dangerous shell commands
  manager.onPreToolUse('safety-shell-block', /shell_exec/, async (input) => {
    const cmd = String(input.args.command || '');
    const dangerousPatterns = [
      /rm\s+-rf\s+\//,
      />\s*\/etc\//,
      /chmod\s+777/,
      /curl.*\|\s*sh/,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(cmd)) {
        return {
          decision: 'deny',
          reason: `Dangerous command pattern detected: ${pattern.source}`,
        };
      }
    }
    return { decision: 'allow' };
  }, 20);

  return manager;
}
