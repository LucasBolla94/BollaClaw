import { execSync, exec } from 'child_process';
import * as path from 'path';
import { logger } from '../utils/logger';
import { telemetry } from '../telemetry/TelemetryReporter';

// ============================================================
// AutoUpdater — Automatic Git Update System
// ============================================================
// Periodically checks the GitHub repo for new commits.
// If updates are found, pulls, rebuilds, and restarts via PM2.
// ============================================================

interface UpdateConfig {
  enabled: boolean;
  checkIntervalMs: number;    // How often to check (default: 5min)
  branch: string;             // Branch to track (default: main)
  autoRestart: boolean;       // Auto-restart via PM2 after update
  repoDir: string;            // Path to the git repo
  pm2Name: string;            // PM2 process name
}

interface UpdateStatus {
  lastCheck: string;
  lastUpdate: string;
  currentCommit: string;
  remoteCommit: string;
  updateAvailable: boolean;
  updatesApplied: number;
  lastError: string;
}

const DEFAULT_CONFIG: UpdateConfig = {
  enabled: true,
  checkIntervalMs: 5 * 60 * 1000,  // 5 minutes
  branch: 'main',
  autoRestart: true,
  repoDir: process.cwd(),
  pm2Name: 'bollaclaw',
};

export class AutoUpdater {
  private config: UpdateConfig;
  private status: UpdateStatus;
  private timer: ReturnType<typeof setInterval> | null = null;
  private isUpdating = false;

  constructor(overrides?: Partial<UpdateConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...overrides };
    this.status = {
      lastCheck: '',
      lastUpdate: '',
      currentCommit: this.getCurrentCommit(),
      remoteCommit: '',
      updateAvailable: false,
      updatesApplied: 0,
      lastError: '',
    };
  }

  // ── Start periodic checking ──────────────────────────────

  start(): void {
    if (!this.config.enabled) {
      logger.info('[AutoUpdater] Disabled.');
      return;
    }

    // Verify git repo exists
    if (!this.isGitRepo()) {
      logger.warn('[AutoUpdater] Not a git repo. Disabling.');
      this.config.enabled = false;
      return;
    }

    logger.info(`[AutoUpdater] Started. Checking every ${Math.round(this.config.checkIntervalMs / 1000)}s on branch "${this.config.branch}".`);

    // Check immediately, then periodically
    this.checkForUpdates();
    this.timer = setInterval(() => this.checkForUpdates(), this.config.checkIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info('[AutoUpdater] Stopped.');
  }

  getStatus(): UpdateStatus {
    return { ...this.status };
  }

  // ── Check for updates ────────────────────────────────────

  async checkForUpdates(): Promise<boolean> {
    if (this.isUpdating) return false;

    try {
      this.status.lastCheck = new Date().toISOString();

      // Fetch latest from remote
      this.execGit('fetch origin --quiet');

      // Compare local vs remote
      const localCommit = this.getCurrentCommit();
      const remoteCommit = this.getRemoteCommit();

      this.status.currentCommit = localCommit;
      this.status.remoteCommit = remoteCommit;

      if (localCommit === remoteCommit) {
        this.status.updateAvailable = false;
        return false;
      }

      // Count new commits
      const behind = this.execGit(`rev-list ${localCommit}..${remoteCommit} --count`).trim();
      const commitCount = parseInt(behind) || 0;

      if (commitCount === 0) {
        this.status.updateAvailable = false;
        return false;
      }

      logger.info(`[AutoUpdater] ${commitCount} new commit(s) available!`);
      this.status.updateAvailable = true;

      telemetry.track({
        type: 'config_change',
        severity: 'info',
        category: 'auto_update',
        message: `Update available: ${commitCount} commits behind`,
        data: {
          local_commit: localCommit.substring(0, 8),
          remote_commit: remoteCommit.substring(0, 8),
          commits_behind: commitCount,
        },
      });

      // Apply update
      if (this.config.autoRestart) {
        await this.applyUpdate();
      }

      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.status.lastError = msg;
      logger.warn(`[AutoUpdater] Check failed: ${msg}`);
      return false;
    }
  }

  // ── Apply update ─────────────────────────────────────────

  private async applyUpdate(): Promise<void> {
    if (this.isUpdating) return;
    this.isUpdating = true;

    try {
      logger.info('[AutoUpdater] Applying update...');

      // 1. Stash any local changes (shouldn't have any, but safety)
      try {
        this.execGit('stash --quiet');
      } catch {
        // No changes to stash, that's fine
      }

      // 2. Pull from remote
      const pullOutput = this.execGit(`pull origin ${this.config.branch} --quiet`);
      logger.info(`[AutoUpdater] Pull: ${pullOutput.trim() || 'done'}`);

      // 3. Install dependencies (if package.json changed)
      logger.info('[AutoUpdater] Installing dependencies...');
      this.execCmd('npm install --production=false --quiet 2>&1 || true');

      // 4. Build
      logger.info('[AutoUpdater] Building...');
      this.execCmd('npm run build 2>&1');

      // 5. Update status
      this.status.currentCommit = this.getCurrentCommit();
      this.status.lastUpdate = new Date().toISOString();
      this.status.updateAvailable = false;
      this.status.updatesApplied++;

      telemetry.track({
        type: 'config_change',
        severity: 'info',
        category: 'auto_update',
        message: `Update applied successfully. Now at ${this.status.currentCommit.substring(0, 8)}`,
        data: {
          new_commit: this.status.currentCommit.substring(0, 8),
          total_updates: this.status.updatesApplied,
        },
      });

      // 6. Restart via PM2
      if (this.config.autoRestart) {
        logger.info('[AutoUpdater] Restarting via PM2...');
        this.scheduleRestart();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.status.lastError = msg;
      logger.error(`[AutoUpdater] Update failed: ${msg}`);

      telemetry.trackError(
        err instanceof Error ? err : new Error(String(err)),
        'auto_update_failed'
      );

      // Try to recover
      try {
        this.execGit('reset --hard HEAD');
        logger.info('[AutoUpdater] Rolled back to previous state.');
      } catch {
        logger.error('[AutoUpdater] Rollback also failed!');
      }
    } finally {
      this.isUpdating = false;
    }
  }

  // ── PM2 Restart ──────────────────────────────────────────

  private scheduleRestart(): void {
    // Give a 2-second grace period to finish any in-flight requests
    setTimeout(() => {
      try {
        execSync(`pm2 restart ${this.config.pm2Name} --update-env`, {
          cwd: this.config.repoDir,
          timeout: 30_000,
        });
      } catch (err) {
        // PM2 might not be available in dev, try node restart
        logger.warn('[AutoUpdater] PM2 restart failed, process will exit for manual restart.');
        process.exit(0); // Exit cleanly — supervisor (PM2/systemd) will restart
      }
    }, 2000);
  }

  // ── Git helpers ──────────────────────────────────────────

  private isGitRepo(): boolean {
    try {
      this.execGit('rev-parse --is-inside-work-tree');
      return true;
    } catch {
      return false;
    }
  }

  private getCurrentCommit(): string {
    try {
      return this.execGit('rev-parse HEAD').trim();
    } catch {
      return 'unknown';
    }
  }

  private getRemoteCommit(): string {
    try {
      return this.execGit(`rev-parse origin/${this.config.branch}`).trim();
    } catch {
      return 'unknown';
    }
  }

  private execGit(args: string): string {
    return execSync(`git ${args}`, {
      cwd: this.config.repoDir,
      encoding: 'utf-8',
      timeout: 30_000,
    });
  }

  private execCmd(cmd: string): string {
    return execSync(cmd, {
      cwd: this.config.repoDir,
      encoding: 'utf-8',
      timeout: 120_000, // 2min for npm install/build
    });
  }

  // ── Manual trigger ───────────────────────────────────────

  async forceUpdate(): Promise<{ success: boolean; message: string }> {
    if (this.isUpdating) {
      return { success: false, message: 'Update already in progress.' };
    }

    try {
      this.execGit('fetch origin --quiet');
      const localCommit = this.getCurrentCommit();
      const remoteCommit = this.getRemoteCommit();

      if (localCommit === remoteCommit) {
        return { success: true, message: 'Already up to date.' };
      }

      await this.applyUpdate();
      return { success: true, message: `Updated to ${this.status.currentCommit.substring(0, 8)}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: msg };
    }
  }
}
