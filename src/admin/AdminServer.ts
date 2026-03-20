import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import * as path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as si from 'systeminformation';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { config } from '../utils/config';
import { logger, logBuffer, captureLog } from '../utils/logger';
import { AgentController } from '../agent/AgentController';
import { telemetry } from '../telemetry/TelemetryReporter';
import { logForwarder } from '../telemetry/LogForwarder';

// ============================================================
// AdminServer — BollaClaw Web Panel (Security Hardened)
// ============================================================
// - Helmet.js for security headers + CSP
// - httpOnly cookies for session (no localStorage)
// - CSRF protection via double-submit cookie
// - PBKDF2 (100K SHA-512) + timing-safe compare
// - Rate limiting with exponential backoff
// - spawn/execFile instead of execSync (no shell injection)
// - Input validation on all endpoints
// - Audit logging for all sensitive actions
// ============================================================

const execFileAsync = promisify(execFile);

// ── Session store (in-memory, single-instance is fine) ──────

interface Session {
  userId: string;
  createdAt: number;
  lastActivity: number;
  ip: string;
  userAgent: string;
}

const sessions = new Map<string, Session>();
const SESSION_TTL = 8 * 60 * 60 * 1000; // 8 hours
const SESSION_CLEANUP_INTERVAL = 30 * 60 * 1000; // 30 min

// Auto-cleanup expired sessions
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (now - session.lastActivity > SESSION_TTL) {
      sessions.delete(token);
    }
  }
}, SESSION_CLEANUP_INTERVAL);

// ── CSRF token generation ───────────────────────────────────

function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function verifyCsrf(req: Request): boolean {
  const cookieToken = req.cookies?.['csrf-token'];
  const headerToken = req.headers['x-csrf-token'] as string;
  if (!cookieToken || !headerToken) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(cookieToken, 'utf-8'),
      Buffer.from(headerToken, 'utf-8'),
    );
  } catch {
    return false;
  }
}

// ── Password hashing (PBKDF2) ───────────────────────────────

function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const s = salt || crypto.randomBytes(32).toString('hex');
  const hash = crypto.pbkdf2Sync(password, s, 100000, 64, 'sha512').toString('hex');
  return { hash, salt: s };
}

function verifyPassword(password: string, storedHash: string, salt: string): boolean {
  const { hash } = hashPassword(password, salt);
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(storedHash, 'hex'));
  } catch {
    return false;
  }
}

// ── Credentials file ────────────────────────────────────────

interface StoredCredentials {
  hash: string;
  salt: string;
  mustChangePassword: boolean;
  createdAt: string;
  lastLogin: string;
  loginCount: number;
  passwordHistory: string[]; // last 3 hashes to prevent reuse
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
  const credPath = getCredentialsPath();
  fs.writeFileSync(credPath, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

function ensureCredentials(): StoredCredentials {
  let creds = loadCredentials();
  if (!creds) {
    const initialPwd = config.admin.password || 'bollaclaw';
    const { hash, salt } = hashPassword(initialPwd);
    creds = {
      hash,
      salt,
      mustChangePassword: true,
      createdAt: new Date().toISOString(),
      lastLogin: '',
      loginCount: 0,
      passwordHistory: [],
    };
    saveCredentials(creds);
  }
  // Migrate old credentials without passwordHistory
  if (!creds.passwordHistory) {
    creds.passwordHistory = [];
    saveCredentials(creds);
  }
  return creds;
}

// ── Rate limiting with exponential backoff ──────────────────

interface RateLimitRecord {
  count: number;
  lastAttempt: number;
  lockUntil: number;
}

const loginAttempts = new Map<string, RateLimitRecord>();

function isRateLimited(ip: string): { limited: boolean; retryAfter?: number } {
  const record = loginAttempts.get(ip);
  if (!record) return { limited: false };
  const now = Date.now();

  // Clear old records (30 min)
  if (now - record.lastAttempt > 30 * 60 * 1000) {
    loginAttempts.delete(ip);
    return { limited: false };
  }

  if (record.lockUntil > now) {
    return { limited: true, retryAfter: Math.ceil((record.lockUntil - now) / 1000) };
  }

  // Exponential: 3→30s, 5→60s, 8→300s, 10→900s
  if (record.count >= 10) {
    record.lockUntil = now + 15 * 60 * 1000;
    return { limited: true, retryAfter: 900 };
  }
  if (record.count >= 8) {
    record.lockUntil = now + 5 * 60 * 1000;
    return { limited: true, retryAfter: 300 };
  }
  if (record.count >= 5) {
    record.lockUntil = now + 60 * 1000;
    return { limited: true, retryAfter: 60 };
  }
  if (record.count >= 3) {
    record.lockUntil = now + 30 * 1000;
    return { limited: true, retryAfter: 30 };
  }

  return { limited: false };
}

function recordLoginAttempt(ip: string, success: boolean): void {
  if (success) {
    loginAttempts.delete(ip);
    return;
  }
  const record = loginAttempts.get(ip) || { count: 0, lastAttempt: 0, lockUntil: 0 };
  record.count++;
  record.lastAttempt = Date.now();
  loginAttempts.set(ip, record);
}

// ── Audit log ───────────────────────────────────────────────

function audit(action: string, ip: string, details?: string): void {
  const entry = `[AUDIT] ${new Date().toISOString()} | ${action} | IP: ${ip}${details ? ` | ${details}` : ''}`;
  captureLog('info', entry);
  logger.info(entry);
}

// ── Input validation ────────────────────────────────────────

function sanitizeString(input: unknown, maxLen = 500): string {
  if (typeof input !== 'string') return '';
  return input.slice(0, maxLen).replace(/[<>"'&]/g, '');
}

function isValidConversationId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{1,128}$/.test(id);
}

// ── Helpers (async, no shell injection) ─────────────────────

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

async function getGitInfo(): Promise<{ commit: string; branch: string; lastCommitMsg: string; lastCommitDate: string }> {
  try {
    const cwd = process.cwd();
    const opts = { cwd, timeout: 5000 };
    const [commitResult, branchResult, msgResult, dateResult] = await Promise.all([
      execFileAsync('git', ['rev-parse', '--short', 'HEAD'], opts),
      execFileAsync('git', ['branch', '--show-current'], opts),
      execFileAsync('git', ['log', '-1', '--pretty=%s'], opts),
      execFileAsync('git', ['log', '-1', '--pretty=%ci'], opts),
    ]);
    return {
      commit: commitResult.stdout.trim(),
      branch: branchResult.stdout.trim(),
      lastCommitMsg: msgResult.stdout.trim(),
      lastCommitDate: dateResult.stdout.trim(),
    };
  } catch {
    return { commit: 'unknown', branch: 'unknown', lastCommitMsg: '', lastCommitDate: '' };
  }
}

async function getPm2Info(): Promise<{ status: string; uptime: string; restarts: number; memory: string } | null> {
  try {
    const { stdout } = await execFileAsync('pm2', ['jlist'], { timeout: 5000 });
    const procs = JSON.parse(stdout);
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

  // ── Trust proxy for correct IP behind nginx ────────────────
  app.set('trust proxy', 'loopback');

  // ── Helmet.js — full security headers ──────────────────────
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    dnsPrefetchControl: { allow: false },
    frameguard: { action: 'deny' },
    hsts: { maxAge: 31536000, includeSubDomains: true },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xContentTypeOptions: true,
    xXssProtection: true,
  }));

  // ── Remove X-Powered-By ────────────────────────────────────
  app.disable('x-powered-by');

  // ── Cookie parser + JSON body ──────────────────────────────
  app.use(cookieParser());
  app.use(express.json({ limit: '512kb' }));

  // ── Request ID for tracing ─────────────────────────────────
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).requestId = crypto.randomBytes(8).toString('hex');
    next();
  });

  // ── Static assets with cache control ───────────────────────
  // Prefer Next.js export build (webpanel/out), fallback to legacy public/
  const nextExportDir = path.resolve(__dirname, '../../webpanel/out');
  const legacyPublicDir = path.join(__dirname, 'public');
  const staticDir = fs.existsSync(nextExportDir) ? nextExportDir : legacyPublicDir;

  app.use(express.static(staticDir, {
    maxAge: '1h',
    etag: true,
    lastModified: true,
    dotfiles: 'deny',
    index: 'index.html',
  }));

  // Ensure credentials exist
  ensureCredentials();

  // ── CSRF middleware for state-changing requests ─────────────
  function csrfProtection(req: Request, res: Response, next: NextFunction): void {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return next();
    }
    // Login endpoint is exempt (no session yet)
    if (req.path === '/api/login') {
      return next();
    }
    if (!verifyCsrf(req)) {
      res.status(403).json({ error: 'CSRF token mismatch' });
      return;
    }
    next();
  }

  // ── Auth middleware (reads httpOnly cookie) ─────────────────
  function auth(req: Request, res: Response, next: NextFunction): void {
    const token = req.cookies?.['session-token'];
    if (!token || !sessions.has(token)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const session = sessions.get(token)!;

    // Check expiry
    if (Date.now() - session.lastActivity > SESSION_TTL) {
      sessions.delete(token);
      res.clearCookie('session-token');
      res.status(401).json({ error: 'Session expired' });
      return;
    }

    // Refresh activity timestamp
    session.lastActivity = Date.now();
    next();
  }

  // Apply CSRF to all POST/PUT/DELETE after auth
  app.use(csrfProtection);

  // ══════════════════════════════════════════════════════════
  // API Routes
  // ══════════════════════════════════════════════════════════

  // ── Health (no auth) ──────────────────────────────────────
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // ── CSRF token endpoint (after login, to get token) ────────
  app.get('/api/csrf-token', auth, (_req: Request, res: Response) => {
    const token = generateCsrfToken();
    res.cookie('csrf-token', token, {
      httpOnly: false, // Must be readable by JS to send in header
      sameSite: 'strict',
      secure: false, // Tunnel is HTTP
      maxAge: SESSION_TTL,
      path: '/',
    });
    res.json({ ok: true });
  });

  // ── Auth: Login ───────────────────────────────────────────
  app.post('/api/login', (req: Request, res: Response) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const ua = sanitizeString(req.headers['user-agent'], 200);

    const rateCheck = isRateLimited(ip);
    if (rateCheck.limited) {
      audit('LOGIN_BLOCKED', ip, `Rate limited, retry after ${rateCheck.retryAfter}s`);
      res.status(429).json({
        error: `Too many attempts. Try again in ${rateCheck.retryAfter}s.`,
        retryAfter: rateCheck.retryAfter,
      });
      return;
    }

    const password = sanitizeString(req.body?.password, 128);
    if (!password) {
      res.status(400).json({ error: 'Password required' });
      return;
    }

    const creds = loadCredentials();
    if (!creds) {
      res.status(500).json({ error: 'Credentials not initialized' });
      return;
    }

    if (!verifyPassword(password, creds.hash, creds.salt)) {
      recordLoginAttempt(ip, false);
      audit('LOGIN_FAILED', ip);
      res.status(401).json({ error: 'Invalid password' });
      return;
    }

    recordLoginAttempt(ip, true);

    // Create session
    const token = generateToken();
    sessions.set(token, {
      userId: 'admin',
      createdAt: Date.now(),
      lastActivity: Date.now(),
      ip,
      userAgent: ua,
    });

    // Set httpOnly cookie
    res.cookie('session-token', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: false, // SSH tunnel is HTTP, not HTTPS
      maxAge: SESSION_TTL,
      path: '/',
    });

    // Set CSRF cookie
    const csrf = generateCsrfToken();
    res.cookie('csrf-token', csrf, {
      httpOnly: false,
      sameSite: 'strict',
      secure: false,
      maxAge: SESSION_TTL,
      path: '/',
    });

    // Update login stats
    creds.lastLogin = new Date().toISOString();
    creds.loginCount++;
    saveCredentials(creds);

    audit('LOGIN_SUCCESS', ip);

    res.json({
      ok: true,
      mustChangePassword: creds.mustChangePassword,
    });
  });

  // ── Auth: Logout ──────────────────────────────────────────
  app.post('/api/logout', (req: Request, res: Response) => {
    const token = req.cookies?.['session-token'];
    if (token) sessions.delete(token);
    res.clearCookie('session-token');
    res.clearCookie('csrf-token');
    audit('LOGOUT', req.ip || 'unknown');
    res.json({ ok: true });
  });

  // ── Auth: Change password ─────────────────────────────────
  app.post('/api/change-password', auth, (req: Request, res: Response) => {
    const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
    const creds = loadCredentials();
    if (!creds) { res.status(500).json({ error: 'No credentials' }); return; }

    if (!verifyPassword(currentPassword, creds.hash, creds.salt)) {
      audit('PASSWORD_CHANGE_FAILED', req.ip || 'unknown', 'Wrong current password');
      res.status(401).json({ error: 'Current password is wrong' });
      return;
    }

    // Validate new password strength
    if (!newPassword || newPassword.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }

    // Check password not in history
    const { hash: newHash } = hashPassword(newPassword, creds.salt);
    if (creds.passwordHistory?.some(h => h === newHash)) {
      res.status(400).json({ error: 'Cannot reuse a recent password' });
      return;
    }

    const { hash, salt } = hashPassword(newPassword);
    // Update history (keep last 3)
    creds.passwordHistory = [creds.hash, ...(creds.passwordHistory || [])].slice(0, 3);
    creds.hash = hash;
    creds.salt = salt;
    creds.mustChangePassword = false;
    saveCredentials(creds);

    // Invalidate all sessions except current
    const currentToken = req.cookies?.['session-token'];
    for (const [token] of sessions) {
      if (token !== currentToken) sessions.delete(token);
    }

    audit('PASSWORD_CHANGED', req.ip || 'unknown');
    res.json({ ok: true });
  });

  // ── Auth: Session info ────────────────────────────────────
  app.get('/api/session', auth, (req: Request, res: Response) => {
    const token = req.cookies?.['session-token'];
    const session = token ? sessions.get(token) : null;
    res.json({
      authenticated: true,
      activeSessions: sessions.size,
      currentSession: session ? {
        createdAt: session.createdAt,
        lastActivity: session.lastActivity,
      } : null,
    });
  });

  // ── Dashboard: Status ─────────────────────────────────────
  app.get('/api/status', auth, async (_req: Request, res: Response) => {
    try {
      const [cpuLoad, mem, disk] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.fsSize(),
      ]);

      const agentStatus = controller.getStatus();
      const gitInfo = await getGitInfo();
      const pm2Info = await getPm2Info();
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
      logger.error('Status endpoint error', err);
      res.status(500).json({ error: 'Failed to retrieve status' });
    }
  });

  // ── Dashboard: Logs ───────────────────────────────────────
  app.get('/api/logs', auth, (req: Request, res: Response) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 100, 1), 500);
    const level = sanitizeString(req.query.level, 20);
    let logs = [...logBuffer];
    if (level && ['info', 'warn', 'error', 'debug'].includes(level)) {
      logs = logs.filter(l => l.level === level);
    }
    res.json({ logs: logs.slice(-limit) });
  });

  app.delete('/api/logs', auth, (req: Request, res: Response) => {
    logBuffer.length = 0;
    audit('LOGS_CLEARED', req.ip || 'unknown');
    res.json({ ok: true });
  });

  // ── Dashboard: Soul ───────────────────────────────────────
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
      logger.error('Soul endpoint error', err);
      res.status(500).json({ error: 'Failed to load soul config' });
    }
  });

  // ── Dashboard: Memory stats ───────────────────────────────
  app.get('/api/memory', auth, (_req: Request, res: Response) => {
    try {
      const dbPath = path.resolve(config.paths.data, 'memory-semantic.db');
      const mainDbPath = path.resolve(config.paths.data, 'bollaclaw.db');

      res.json({
        semanticEnabled: fs.existsSync(dbPath),
        mainDbSize: fs.existsSync(mainDbPath) ? formatBytes(fs.statSync(mainDbPath).size) : '0',
        semanticDbSize: fs.existsSync(dbPath) ? formatBytes(fs.statSync(dbPath).size) : '0',
      });
    } catch (err) {
      logger.error('Memory endpoint error', err);
      res.status(500).json({ error: 'Failed to load memory stats' });
    }
  });

  // ── Dashboard: Conversations ──────────────────────────────
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
      logger.error('Conversations endpoint error', err);
      res.status(500).json({ error: 'Failed to load conversations' });
    }
  });

  // ── Dashboard: Conversation messages ──────────────────────
  app.get('/api/conversations/:id/messages', auth, (req: Request, res: Response) => {
    if (!isValidConversationId(req.params.id)) {
      res.status(400).json({ error: 'Invalid conversation ID' });
      return;
    }
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
      logger.error('Messages endpoint error', err);
      res.status(500).json({ error: 'Failed to load messages' });
    }
  });

  // ── Actions: Reload ───────────────────────────────────────
  app.post('/api/reload-skills', auth, (req: Request, res: Response) => {
    controller.reloadSkills();
    audit('RELOAD_SKILLS', req.ip || 'unknown');
    res.json({ ok: true });
  });

  app.post('/api/reload-providers', auth, (req: Request, res: Response) => {
    controller.reloadProviders();
    audit('RELOAD_PROVIDERS', req.ip || 'unknown');
    res.json({ ok: true });
  });

  app.post('/api/reload-identity', auth, (req: Request, res: Response) => {
    controller.reloadIdentity();
    audit('RELOAD_IDENTITY', req.ip || 'unknown');
    res.json({ ok: true });
  });

  // ── BollaWatch telemetry status ──────────────────────────
  app.get('/api/telemetry-status', auth, (_req: Request, res: Response) => {
    const logStats = logForwarder.getStats();
    res.json({
      enabled: telemetry.isEnabled(),
      connected: telemetry.isConnected(),
      instanceId: telemetry.getInstanceId(),
      logForwarder: {
        connected: logStats.connected,
        queueSize: logStats.queueSize,
        totalSent: logStats.totalSent,
        totalDropped: logStats.totalDropped,
        failures: logStats.failures,
      },
    });
  });

  // ── Actions: PM2 restart ──────────────────────────────────
  app.post('/api/restart', auth, async (req: Request, res: Response) => {
    audit('RESTART_REQUESTED', req.ip || 'unknown');
    res.json({ ok: true, message: 'Restarting in 2 seconds...' });
    setTimeout(async () => {
      try {
        await execFileAsync('pm2', ['restart', 'bollaclaw'], { timeout: 10000 });
      } catch {
        process.exit(0);
      }
    }, 2000);
  });

  // ── Global error handler ──────────────────────────────────
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error('Unhandled error in admin server', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  // ── SPA fallback ──────────────────────────────────────────
  app.get('*', (_req: Request, res: Response) => {
    const indexPath = path.join(staticDir, 'index.html');
    res.sendFile(indexPath);
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
