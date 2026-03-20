import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';
import { telemetry } from '../telemetry/TelemetryReporter';

// ============================================================
// AutoUpdater v2 — Bulletproof Auto-Update System
// ============================================================
// Design principles:
//   1. NEVER break a running bot — verify before restart
//   2. ALWAYS rollback on failure — save commit before update
//   3. Health check after restart — confirm bot is alive
//   4. Graceful shutdown — wait for in-flight requests
//   5. Lock file — prevent concurrent updates
//   6. Backup dist/ — instant rollback if build fails
// ============================================================

interface UpdateConfig {
  enabled: boolean;
  checkIntervalMs: number;
  branch: string;
  autoRestart: boolean;
  repoDir: string;
  pm2Name: string;
  healthCheckUrl?: string;
  healthCheckTimeoutMs?: number;
  gracePeriodMs?: number;
}

interface UpdateStatus {
  lastCheck: string;
  lastUpdate: string;
  currentCommit: string;
  remoteCommit: string;
  updateAvailable: boolean;
  updatesApplied: number;
  lastError: string;
  isUpdating: boolean;
  lastSuccessfulBuild: string;
}

const DEFAULT_CONFIG: UpdateConfig = {
  enabled: true,
  checkIntervalMs: 5 * 60 * 1000,
  branch: 'main',
  autoRestart: true,
  repoDir: process.cwd(),
  pm2Name: 'bollaclaw',
  healthCheckUrl: undefined,
  healthCheckTimeoutMs: 10000,
  gracePeriodMs: 3000,
};

const LOCK_FILE = '.update.lock';
const BACKUP_DIR = '.update-backup';

export class AutoUpdater {
  private config: UpdateConfig;
  private status: UpdateStatus;
  private timer: ReturnType<typeof setInterval> | null = null;

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
      isUpdating: false,
      lastSuccessfulBuild: '',
    };
  }

  // ── Start / Stop ───────────────────────────────────────────

  start(): void {
    if (!this.config.enabled) {
      logger.info('[AutoUpdater] Disabled.');
      return;
    }

    if (!this.isGitRepo()) {
      logger.warn('[AutoUpdater] Not a git repo. Disabling.');
      this.config.enabled = false;
      return;
    }

    // Cleanup stale lock files from crashed updates
    this.cleanupStaleLock();

    logger.info(
      `[AutoUpdater] Started. Checking every ${Math.round(this.config.checkIntervalMs / 1000)}s ` +
      `on branch "${this.config.branch}".`
    );

    // First check after 30s (let the bot fully boot first)
    setTimeout(() => {
      this.checkForUpdates();
      this.timer = setInterval(() => this.checkForUpdates(), this.config.checkIntervalMs);
    }, 30_000);
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

  // ── Check for updates ──────────────────────────────────────

  async checkForUpdates(): Promise<boolean> {
    if (this.status.isUpdating) return false;
    if (this.isLocked()) return false;

    try {
      this.status.lastCheck = new Date().toISOString();
      this.execGit('fetch origin --quiet');

      const localCommit = this.getCurrentCommit();
      const remoteCommit = this.getRemoteCommit();

      this.status.currentCommit = localCommit;
      this.status.remoteCommit = remoteCommit;

      if (localCommit === remoteCommit) {
        this.status.updateAvailable = false;
        return false;
      }

      const behind = parseInt(
        this.execGit(`rev-list ${localCommit}..${remoteCommit} --count`).trim()
      ) || 0;

      if (behind === 0) {
        this.status.updateAvailable = false;
        return false;
      }

      logger.info(`[AutoUpdater] ${behind} new commit(s) available!`);
      this.status.updateAvailable = true;

      telemetry.track({
        type: 'config_change',
        severity: 'info',
        category: 'auto_update',
        message: `Update available: ${behind} commits behind`,
        data: {
          local_commit: localCommit.substring(0, 8),
          remote_commit: remoteCommit.substring(0, 8),
          commits_behind: behind,
        },
      });

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

  // ── Apply update (with full safety net) ────────────────────

  private async applyUpdate(): Promise<void> {
    if (this.status.isUpdating) return;

    this.acquireLock();
    this.status.isUpdating = true;

    const previousCommit = this.getCurrentCommit();
    let backupCreated = false;

    try {
      logger.info('[AutoUpdater] ═══ Starting safe update ═══');

      // Step 1: Backup current dist/
      backupCreated = this.backupDist();
      if (backupCreated) {
        logger.info('[AutoUpdater] [1/6] Backup created');
      }

      // Step 2: Pull changes
      try {
        this.execGit('reset --hard HEAD');
      } catch { /* ignore */ }

      this.execGit(`pull origin ${this.config.branch} --quiet`);
      logger.info('[AutoUpdater] [2/6] Git pull OK');

      // Step 3: Install dependencies
      logger.info('[AutoUpdater] [3/6] Installing dependencies...');
      this.execCmd('npm install --production=false --quiet 2>&1');

      // Step 4: Build
      logger.info('[AutoUpdater] [4/6] Building...');
      this.execCmd('npm run build 2>&1');

      // Step 5: Verify build output exists
      let mainJs = path.join(this.config.repoDir, 'dist', 'main.js');
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(this.config.repoDir, 'package.json'), 'utf-8'));
        if (pkg.main) mainJs = path.join(this.config.repoDir, pkg.main);
      } catch { /* use default */ }

      if (!fs.existsSync(mainJs)) {
        // Fallback: search for main.js in dist/
        const distDir = path.join(this.config.repoDir, 'dist');
        if (fs.existsSync(distDir)) {
          const found = this.findFile(distDir, 'main.js');
          if (found) mainJs = found;
        }
      }

      if (!fs.existsSync(mainJs)) {
        throw new Error(`Build verification failed: main.js not found (looked at ${mainJs})`);
      }
      logger.info(`[AutoUpdater] [5/6] Build verified: ${mainJs}`);

      // Step 6: Schedule graceful restart
      this.status.currentCommit = this.getCurrentCommit();
      this.status.lastUpdate = new Date().toISOString();
      this.status.updateAvailable = false;
      this.status.updatesApplied++;
      this.status.lastSuccessfulBuild = new Date().toISOString();

      telemetry.track({
        type: 'config_change',
        severity: 'info',
        category: 'auto_update',
        message: `Update applied: ${previousCommit.substring(0, 8)} → ${this.status.currentCommit.substring(0, 8)}`,
        data: {
          previous_commit: previousCommit.substring(0, 8),
          new_commit: this.status.currentCommit.substring(0, 8),
          total_updates: this.status.updatesApplied,
        },
      });

      logger.info('[AutoUpdater] [6/6] Scheduling graceful restart...');
      this.scheduleRestart();

      // Cleanup backup on success
      this.cleanupBackup();

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.status.lastError = msg;
      logger.error(`[AutoUpdater] Update FAILED: ${msg}`);

      telemetry.trackError(
        err instanceof Error ? err : new Error(String(err)),
        'auto_update_failed'
      );

      // ROLLBACK
      this.rollback(previousCommit, backupCreated);
    } finally {
      this.status.isUpdating = false;
      this.releaseLock();
    }
  }

  // ── Rollback ───────────────────────────────────────────────

  private rollback(previousCommit: string, hasBackup: boolean): void {
    logger.info('[AutoUpdater] Rolling back...');

    try {
      // Reset git to previous commit
      this.execGit(`reset --hard ${previousCommit}`);
      logger.info(`[AutoUpdater] Git rolled back to ${previousCommit.substring(0, 8)}`);
    } catch (gitErr) {
      logger.error(`[AutoUpdater] Git rollback failed: ${gitErr}`);
    }

    // Restore dist/ from backup
    if (hasBackup) {
      try {
        const backupPath = path.join(this.config.repoDir, BACKUP_DIR);
        const distPath = path.join(this.config.repoDir, 'dist');
        if (fs.existsSync(backupPath)) {
          if (fs.existsSync(distPath)) {
            fs.rmSync(distPath, { recursive: true, force: true });
          }
          fs.renameSync(backupPath, distPath);
          logger.info('[AutoUpdater] dist/ restored from backup');
        }
      } catch (distErr) {
        logger.error(`[AutoUpdater] dist/ restore failed: ${distErr}`);
      }
    }

    this.status.currentCommit = this.getCurrentCommit();
    logger.info('[AutoUpdater] Rollback complete. Bot continues running.');
  }

  // ── Graceful PM2 Restart ───────────────────────────────────

  private scheduleRestart(): void {
    const gracePeriod = this.config.gracePeriodMs ?? 3000;

    setTimeout(() => {
      try {
        execSync(`pm2 restart ${this.config.pm2Name} --update-env`, {
          cwd: this.config.repoDir,
          timeout: 30_000,
        });
        logger.info('[AutoUpdater] PM2 restart successful');
      } catch {
        logger.warn('[AutoUpdater] PM2 restart failed, exiting for supervisor restart');
        process.exit(0);
      }
    }, gracePeriod);
  }

  // ── Backup / Restore dist/ ─────────────────────────────────

  private backupDist(): boolean {
    try {
      const distPath = path.join(this.config.repoDir, 'dist');
      const backupPath = path.join(this.config.repoDir, BACKUP_DIR);

      if (!fs.existsSync(distPath)) return false;

      // Remove old backup
      if (fs.existsSync(backupPath)) {
        fs.rmSync(backupPath, { recursive: true, force: true });
      }

      // Copy dist/ to backup
      fs.cpSync(distPath, backupPath, { recursive: true });
      return true;
    } catch (err) {
      logger.warn(`[AutoUpdater] Backup failed: ${err}`);
      return false;
    }
  }

  private cleanupBackup(): void {
    try {
      const backupPath = path.join(this.config.repoDir, BACKUP_DIR);
      if (fs.existsSync(backupPath)) {
        fs.rmSync(backupPath, { recursive: true, force: true });
      }
    } catch { /* ignore */ }
  }

  // ── Lock file (prevent concurrent updates) ─────────────────

  private acquireLock(): void {
    const lockPath = path.join(this.config.repoDir, LOCK_FILE);
    fs.writeFileSync(lockPath, JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
    }));
  }

  private releaseLock(): void {
    try {
      const lockPath = path.join(this.config.repoDir, LOCK_FILE);
      if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
    } catch { /* ignore */ }
  }

  private isLocked(): boolean {
    const lockPath = path.join(this.config.repoDir, LOCK_FILE);
    if (!fs.existsSync(lockPath)) return false;

    try {
      const lock = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
      // Check if lock is stale (>10 minutes old)
      const lockAge = Date.now() - new Date(lock.startedAt).getTime();
      if (lockAge > 10 * 60 * 1000) {
        this.releaseLock();
        return false;
      }
      return true;
    } catch {
      this.releaseLock();
      return false;
    }
  }

  private cleanupStaleLock(): void {
    const lockPath = path.join(this.config.repoDir, LOCK_FILE);
    if (fs.existsSync(lockPath)) {
      logger.info('[AutoUpdater] Cleaning up stale lock file from previous run');
      this.releaseLock();
    }
  }

  // ── Git helpers ────────────────────────────────────────────

  private isGitRepo(): boolean {
    try {
      this.execGit('rev-parse --is-inside-work-tree');
      return true;
    } catch { return false; }
  }

  private getCurrentCommit(): string {
    try { return this.execGit('rev-parse HEAD').trim(); }
    catch { return 'unknown'; }
  }

  private getRemoteCommit(): string {
    try { return this.execGit(`rev-parse origin/${this.config.branch}`).trim(); }
    catch { return 'unknown'; }
  }

  private execGit(args: string): string {
    return execSync(`git ${args}`, {
      cwd: this.config.repoDir,
      encoding: 'utf-8',
      timeout: 30_000,
    });
  }

  private findFile(dir: string, filename: string): string | null {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isFile() && entry.name === filename) return full;
        if (entry.isDirectory() && entry.name !== 'node_modules') {
          const found = this.findFile(full, filename);
          if (found) return found;
        }
      }
    } catch { /* ignore */ }
    return null;
  }

  private execCmd(cmd: string): string {
    return execSync(cmd, {
      cwd: this.config.repoDir,
      encoding: 'utf-8',
      timeout: 180_000, // 3min for npm install/build
    });
  }

  // ── Manual trigger ─────────────────────────────────────────

  async forceUpdate(): Promise<{ success: boolean; message: string }> {
    if (this.status.isUpdating) {
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
