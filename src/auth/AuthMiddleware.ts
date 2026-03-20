import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';

// ============================================================
// BollaWatch Auth — Simple token-based authentication
// ============================================================
// Two auth methods:
// 1. Dashboard: login form → session cookie
// 2. API (BollaClaw → BollaWatch): X-BollaWatch-Token header
//
// Both use the same BOLLAWATCH_SECRET from .env
// ============================================================

const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
const sessions = new Map<string, { createdAt: number }>();

function getSecret(): string {
  return process.env.BOLLAWATCH_SECRET || '35868115';
}

function generateSessionId(): string {
  return crypto.randomBytes(32).toString('hex');
}

function cleanExpiredSessions(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_DURATION_MS) {
      sessions.delete(id);
    }
  }
}

// Clean sessions every hour
setInterval(cleanExpiredSessions, 60 * 60 * 1000);

/**
 * Auth middleware — protects dashboard and API routes
 * Allows unauthenticated access to:
 *   - /health (monitoring)
 *   - /login (login page)
 *   - /api/v1/auth/login (login endpoint)
 *   - /api/v1/events (POST — BollaClaw sending events, uses token)
 *   - /api/v1/metrics (POST — BollaClaw sending metrics, uses token)
 *   - /api/v1/register (POST — BollaClaw registering, uses token)
 *   - /api/v1/logs (POST — BollaClaw sending logs, uses token)
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const path = req.path;
  const method = req.method;

  // Public routes — no auth required
  if (path === '/health') {
    next();
    return;
  }

  // Login routes
  if (path === '/login' || path === '/api/v1/auth/login') {
    next();
    return;
  }

  // Ingestion endpoints from BollaClaw — require API token
  const ingestionPaths = ['/api/v1/events', '/api/v1/metrics', '/api/v1/register', '/api/v1/logs'];
  if (method === 'POST' && ingestionPaths.includes(path)) {
    const token = req.headers['x-bollawatch-token'] as string;
    if (token && token === getSecret()) {
      next();
      return;
    }
    // Also allow if they have a valid session cookie (dashboard testing)
    const sessionId = parseCookie(req.headers.cookie || '', 'bw_session');
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      if (Date.now() - session.createdAt < SESSION_DURATION_MS) {
        next();
        return;
      }
    }
    res.status(401).json({ error: 'Unauthorized — invalid or missing X-BollaWatch-Token' });
    return;
  }

  // All other routes — require session cookie
  const sessionId = parseCookie(req.headers.cookie || '', 'bw_session');
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    if (Date.now() - session.createdAt < SESSION_DURATION_MS) {
      next();
      return;
    }
    sessions.delete(sessionId);
  }

  // Not authenticated — redirect to login for HTML requests, 401 for API
  if (req.headers.accept?.includes('text/html') || path === '/') {
    res.redirect('/login');
    return;
  }
  res.status(401).json({ error: 'Unauthorized — please login at /login' });
}

/**
 * Login route handlers
 */
export function handleLoginPage(_req: Request, res: Response): void {
  res.type('html').send(getLoginHtml());
}

export function handleLoginSubmit(req: Request, res: Response): void {
  const { password } = req.body || {};
  const secret = getSecret();

  if (password && password === secret) {
    const sessionId = generateSessionId();
    sessions.set(sessionId, { createdAt: Date.now() });
    res.setHeader('Set-Cookie', `bw_session=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DURATION_MS / 1000}`);
    res.json({ ok: true, redirect: '/' });
  } else {
    res.status(401).json({ error: 'Senha incorreta' });
  }
}

export function handleLogout(_req: Request, res: Response): void {
  const sessionId = parseCookie(_req.headers.cookie || '', 'bw_session');
  if (sessionId) sessions.delete(sessionId);
  res.setHeader('Set-Cookie', 'bw_session=; Path=/; HttpOnly; Max-Age=0');
  res.redirect('/login');
}

// ── Helpers ────────────────────────────────────────────────

function parseCookie(cookieStr: string, name: string): string | null {
  const match = cookieStr.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? match[1] : null;
}

function getLoginHtml(): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BollaWatch — Login</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif;
      background: #0b0d14; color: #e4e7f0; min-height: 100vh;
      display: flex; align-items: center; justify-content: center;
    }
    .login-box {
      background: #141722; border: 1px solid #252a3a; border-radius: 12px;
      padding: 40px; width: 380px; text-align: center;
    }
    .logo { font-size: 42px; margin-bottom: 8px; }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
    h1 .brand { color: #818cf8; }
    .subtitle { color: #5a5f78; font-size: 13px; margin-bottom: 28px; }
    .form-group { margin-bottom: 16px; text-align: left; }
    label { font-size: 12px; color: #8b90a8; margin-bottom: 6px; display: block; }
    input[type="password"] {
      width: 100%; padding: 10px 14px; background: #1c2030; border: 1px solid #252a3a;
      border-radius: 8px; color: #e4e7f0; font-size: 14px; outline: none;
      transition: border-color .2s;
    }
    input[type="password"]:focus { border-color: #6366f1; }
    .btn {
      width: 100%; padding: 10px; background: #6366f1; border: none; border-radius: 8px;
      color: #fff; font-size: 14px; font-weight: 600; cursor: pointer;
      transition: background .15s;
    }
    .btn:hover { background: #5558e6; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .error { color: #ef4444; font-size: 12px; margin-top: 12px; display: none; }
    .server-info { color: #5a5f78; font-size: 11px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="login-box">
    <div class="logo">👁️</div>
    <h1><span class="brand">Bolla</span>Watch</h1>
    <p class="subtitle">Telemetry Hub — Acesso Restrito</p>
    <form id="loginForm">
      <div class="form-group">
        <label>Senha de acesso</label>
        <input type="password" id="password" placeholder="Digite a senha..." autofocus>
      </div>
      <button type="submit" class="btn" id="submitBtn">Entrar</button>
      <div class="error" id="errorMsg"></div>
    </form>
    <div class="server-info">BollaWatch v2 — Dev Team Only</div>
  </div>
  <script>
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('submitBtn');
      const errEl = document.getElementById('errorMsg');
      const pwd = document.getElementById('password').value;
      btn.disabled = true;
      errEl.style.display = 'none';
      try {
        const res = await fetch('/api/v1/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pwd })
        });
        const data = await res.json();
        if (data.ok) {
          window.location.href = data.redirect || '/';
        } else {
          errEl.textContent = data.error || 'Erro no login';
          errEl.style.display = 'block';
        }
      } catch (err) {
        errEl.textContent = 'Erro de conexão';
        errEl.style.display = 'block';
      }
      btn.disabled = false;
    });
  </script>
</body>
</html>`;
}
