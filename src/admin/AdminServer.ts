import express, { Request, Response, NextFunction } from 'express';
import * as path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as si from 'systeminformation';
import { execSync } from 'child_process';
import { config } from '../utils/config';
import { logger, logBuffer, captureLog } from '../utils/logger';
import { AgentController } from '../agent/AgentController';
import { telemetry } from '../telemetry/TelemetryReporter';

// ============================================================
// AdminServer — BollaClaw Web Panel
// ============================================================
// Inspired by OpenClaw's Control UI but tailored for BollaClaw.
// Single-page app served on the same Express instance.
// Features: auth, dashboard, logs, soul, memory, settings.
// ============================================================

const TOKENS = new Set<string>();
const SESSION_DATA = new Map<string, { createdAt: number; userId: string }>();

// ── Password hashing (PBKDF2) ───────────────────────────────

function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, s, 100000, 64, 'sha512').toString('hex');
  return { hash, salt: s };
}

function verifyPassword(password: string, storedHash: string, salt: string): boolean {
  const { hash } = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(storedHash));
}

// ── Credentials file ────────────────────────────────────────

interface StoredCredentials {
  hash: string;
  salt: string;
  mustChangePassword: boolean;
  createdAt: string;
  lastLogin: string;
  loginCount: number;
}

function getCredentialsPath(): string {
  return path.resolve(config.paths.data, 'web-credentials.json');
}

function loadCredentials(): StoredCredentials | null {
  const p = getCredentialsPath();
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

function saveCredentials(creds: StoredCredentials): void {
  const dir = path.dirname(getCredentialsPath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getCredentialsPath(), JSON.stringify(creds, null, 2), 'utf-8');
}

function ensureCredentials(): StoredCredentials {
  let creds = loadCredentials();
  if (!creds) {
    // Generate initial password from .env or default
    const initialPwd = config.admin.password || 'bollaclaw';
    const { hash, salt } = hashPassword(initialPwd);
    creds = {
      hash,
      salt,
      mustChangePassword: true,
      createdAt: new Date().toISOString(),
      lastLogin: '',
      loginCount: 0,
    };
    saveCredentials(creds);
  }
  return creds;
}

// ── Rate limiting ───────────────────────────────────────────

const loginAttempts = new Map<string, { count: number; lastAttempt: number }>();

function isRateLimited(ip: string): boolean {
  const record = loginAttempts.get(ip);
  if (!record) return false;
  const elapsed = Date.now() - record.lastAttempt;
  if (elapsed > 15 * 60 * 1000) { loginAttempts.delete(ip); return false; }
  return record.count >= 5;
}

function recordLoginAttempt(ip: string, success: boolean): void {
  if (success) { loginAttempts.delete(ip); return; }
  const record = loginAttempts.get(ip) || { count: 0, lastAttempt: 0 };
  record.count++;
  record.lastAttempt = Date.now();
  loginAttempts.set(ip, record);
}

// ── Helpers ─────────────────────────────────────────────────

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  return `${h}h ${m}m`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
}

function getGitInfo(): { commit: string; branch: string; lastCommitMsg: string; lastCommitDate: string } {
  try {
    const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf-8', cwd: process.cwd() }).trim();
    const branch = execSync('git branch --show-current', { encoding: 'utf-8', cwd: process.cwd() }).trim();
    const lastCommitMsg = execSync('git log -1 --pretty=%s', { encoding: 'utf-8', cwd: process.cwd() }).trim();
    const lastCommitDate = execSync('git log -1 --pretty=%ci', { encoding: 'utf-8', cwd: process.cwd() }).trim();
    return { commit, branch, lastCommitMsg, lastCommitDate };
  } catch {
    return { commit: 'unknown', branch: 'unknown', lastCommitMsg: '', lastCommitDate: '' };
  }
}

function getPm2Info(): { status: string; uptime: string; restarts: number; memory: string } | null {
  try {
    const raw = execSync('pm2 jlist', { encoding: 'utf-8', timeout: 5000 });
    const procs = JSON.parse(raw);
    const bc = procs.find((p: { name: string }) => p.name === 'bollaclaw');
    if (!bc) return null;
    return {
      status: bc.pm2_env?.status || 'unknown',
      uptime: formatUptime(Math.floor((Date.now() - (bc.pm2_env?.pm_uptime || Date.now())) / 1000)),
      restarts: bc.pm2_env?.restart_time || 0,
      memory: formatBytes(bc.monit?.memory || 0),
    };
  } catch {
    return null;
  }
}

// ══════════════════════════════════════════════════════════════
// Express App
// ══════════════════════════════════════════════════════════════

export function createAdminServer(controller: AgentController): express.Application {
  const app = express();

  // Security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(path.join(__dirname, 'public')));

  // Ensure credentials exist
  ensureCredentials();

  // ── Auth: Login ─────────────────────────────────────────

  app.post('/api/login', (req: Request, res: Response) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';

    if (isRateLimited(ip)) {
      res.status(429).json({ error: 'Too many attempts. Wait 15 minutes.' });
      return;
    }

    const { password } = req.body as { password: string };
    const creds = loadCredentials();

    if (!creds) {
      res.status(500).json({ error: 'Credentials not initialized' });
      return;
    }

    if (!verifyPassword(password, creds.hash, creds.salt)) {
      recordLoginAttempt(ip, false);
      res.status(401).json({ error: 'Invalid password' });
      return;
    }

    recordLoginAttempt(ip, true);

    const token = generateToken();
    TOKENS.add(token);
    SESSION_DATA.set(token, { createdAt: Date.now(), userId: 'admin' });
    setTimeout(() => { TOKENS.delete(token); SESSION_DATA.delete(token); }, 24 * 60 * 60 * 1000);

    // Update login stats
    creds.lastLogin = new Date().toISOString();
    creds.loginCount++;
    saveCredentials(creds);

    captureLog('info', `Web panel login from ${ip}`);

    res.json({
      token,
      mustChangePassword: creds.mustChangePassword,
    });
  });

  // ── Auth: Change password ───────────────────────────────

  app.post('/api/change-password', auth, (req: Request, res: Response) => {
    const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
    const creds = loadCredentials();
    if (!creds) { res.status(500).json({ error: 'No credentials' }); return; }

    if (!verifyPassword(currentPassword, creds.hash, creds.salt)) {
      res.status(401).json({ error: 'Current password is wrong' });
      return;
    }

    if (!newPassword || newPassword.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters' });
      return;
    }

    const { hash, salt } = hashPassword(newPassword);
    creds.hash = hash;
    creds.salt = salt;
    creds.mustChangePassword = false;
    saveCredentials(creds);

    captureLog('info', 'Web panel password changed');
    res.json({ ok: true });
  });

  // ── Auth middleware ──────────────────────────────────────

  function auth(req: Request, res: Response, next: NextFunction): void {
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace('Bearer ', '');
    if (!token || !TOKENS.has(token)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  }

  // ── Dashboard: Status ───────────────────────────────────

  app.get('/api/status', auth, async (_req: Request, res: Response) => {
    try {
      const [cpuLoad, mem, disk, networkStats] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.fsSize(),
        si.networkStats().catch(() => []),
      ]);

      const agentStatus = controller.getStatus();
      const gitInfo = getGitInfo();
      const pm2Info = getPm2Info();
      const mainDisk = disk.find(d => d.mount === '/') || disk[0];

      res.json({
        system: {
          hostname: os.hostname(),
          platform: `${os.type()} ${os.release()}`,
          arch: os.arch(),
          cpuModel: os.cpus()[0]?.model || 'unknown',
          cpuCores: os.cpus().length,
          cpuUsage: parseFloat(cpuLoad.currentLoad.toFixed(1)),
          ramUsed: mem.active,
          ramTotal: mem.total,
          ramPercent: parseFloat(((mem.active / mem.total) * 100).toFixed(1)),
          diskUsed: mainDisk?.used || 0,
          diskTotal: mainDisk?.size || 0,
          diskPercent: parseFloat((mainDisk?.use || 0).toFixed(1)),
          uptime: os.uptime(),
          uptimeFormatted: formatUptime(os.uptime()),
          nodeVersion: process.version,
          processUptime: formatUptime(Math.floor(process.uptime())),
          pid: process.pid,
          memoryUsage: process.memoryUsage(),
        },
        agent: agentStatus,
        git: gitInfo,
        pm2: pm2Info,
        config: {
          stt: config.audio.sttProvider,
          maxIter: config.agent.maxIterations,
          memWindow: config.agent.memoryWindowSize,
          adminPort: config.admin.port,
          telegramAllowed: config.telegram.allowedUserIds,
        },
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Dashboard: Logs ─────────────────────────────────────

  app.get('/api/logs', auth, (req: Request, res: Response) => {
    const limit = parseInt(req.query.limit as string) || 100;
    const level = req.query.level as string;
    let logs = [...logBuffer];
    if (level) logs = logs.filter(l => l.level === level);
    res.json({ logs: logs.slice(-limit) });
  });

  app.delete('/api/logs', auth, (_req: Request, res: Response) => {
    logBuffer.length = 0;
    res.json({ ok: true });
  });

  // ── Dashboard: Soul ─────────────────────────────────────

  app.get('/api/soul', auth, (_req: Request, res: Response) => {
    try {
      const soulPath = path.resolve(config.paths.data, 'soul.json');
      if (!fs.existsSync(soulPath)) {
        res.json({ configured: false, soul: null });
        return;
      }
      const soul = JSON.parse(fs.readFileSync(soulPath, 'utf-8'));
      res.json({ configured: true, soul });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Dashboard: Memory stats ─────────────────────────────

  app.get('/api/memory', auth, (_req: Request, res: Response) => {
    try {
      const dbPath = path.resolve(config.paths.data, 'memory-semantic.db');
      const mainDbPath = path.resolve(config.paths.data, 'bollaclaw.db');

      const stats: Record<string, unknown> = {
        semanticEnabled: fs.existsSync(dbPath),
        mainDbSize: fs.existsSync(mainDbPath) ? formatBytes(fs.statSync(mainDbPath).size) : '0',
        semanticDbSize: fs.existsSync(dbPath) ? formatBytes(fs.statSync(dbPath).size) : '0',
      };

      res.json(stats);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Dashboard: Conversations ────────────────────────────

  app.get('/api/conversations', auth, (_req: Request, res: Response) => {
    try {
      const Database = require('better-sqlite3');
      const dbPath = path.resolve(config.paths.data, 'bollaclaw.db');
      if (!fs.existsSync(dbPath)) { res.json({ conversations: [] }); return; }

      const db = new Database(dbPath, { readonly: true });
      const conversations = db.prepare(`
        SELECT c.id, c.user_id, c.provider, c.created_at, c.updated_at,
               (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count
        FROM conversations c
        ORDER BY c.updated_at DESC
        LIMIT 50
      `).all();
      db.close();

      res.json({ conversations });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Dashboard: Conversation messages ────────────────────

  app.get('/api/conversations/:id/messages', auth, (req: Request, res: Response) => {
    try {
      const Database = require('better-sqlite3');
      const dbPath = path.resolve(config.paths.data, 'bollaclaw.db');
      if (!fs.existsSync(dbPath)) { res.json({ messages: [] }); return; }

      const db = new Database(dbPath, { readonly: true });
      const messages = db.prepare(`
        SELECT id, role, content, created_at
        FROM messages
        WHERE conversation_id = ?
        ORDER BY created_at ASC
        LIMIT 200
      `).all(req.params.id);
      db.close();

      res.json({ messages });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Actions: Reload ─────────────────────────────────────

  app.post('/api/reload-skills', auth, (_req: Request, res: Response) => {
    controller.reloadSkills();
    captureLog('info', 'Skills reloaded via web panel');
    res.json({ ok: true });
  });

  app.post('/api/reload-providers', auth, (_req: Request, res: Response) => {
    controller.reloadProviders();
    captureLog('info', 'Providers reloaded via web panel');
    res.json({ ok: true });
  });

  app.post('/api/reload-identity', auth, (_req: Request, res: Response) => {
    controller.reloadIdentity();
    captureLog('info', 'Identity/Soul reloaded via web panel');
    res.json({ ok: true });
  });

  // ── Actions: PM2 restart ────────────────────────────────

  app.post('/api/restart', auth, (_req: Request, res: Response) => {
    captureLog('warn', 'Restart requested via web panel');
    res.json({ ok: true, message: 'Restarting in 2 seconds...' });
    setTimeout(() => {
      try {
        execSync('pm2 restart bollaclaw', { timeout: 10000 });
      } catch {
        process.exit(0);
      }
    }, 2000);
  });

  // ── Health (no auth) ────────────────────────────────────

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // ── SPA fallback ────────────────────────────────────────

  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  return app;
}

export function startAdminServer(controller: AgentController): void {
  if (!config.admin.enabled) {
    logger.info('Admin panel disabled');
    return;
  }

  const app = createAdminServer(controller);
  app.listen(config.admin.port, config.admin.host, () => {
    logger.info(`Web panel running at http://${config.admin.host}:${config.admin.port}`);
    captureLog('info', `Web panel started on port ${config.admin.port}`);
  });
}
