import * as dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import apiRoutes from './api/routes';
import logRoutes from './api/logRoutes';
import { getDatabase, cleanupOldEvents, closeDatabase } from './db/Database';
import { getDashboardHtml } from './dashboard/dashboard';
import { authMiddleware, handleLoginPage, handleLoginSubmit, handleLogout } from './auth/AuthMiddleware';

// ============================================================
// BollaWatch v2 — Central Telemetry Hub
// URL: http://watch.bolla.network
// ============================================================

const PORT = parseInt(process.env.PORT || '21087', 10);
const HOST = process.env.HOST || '0.0.0.0';
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

const app = express();

// ── Middleware ─────────────────────────────────────────────

// Security headers
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Request logging (only non-heartbeat routes to avoid spam)
app.use((req, _res, next) => {
  if (req.method !== 'POST' || (!req.path.includes('/events') && !req.path.includes('/metrics') && !req.path.includes('/logs'))) {
    if (req.path !== '/health' && req.path !== '/' && req.path !== '/login') {
      console.log(`[BollaWatch] ${req.method} ${req.path}`);
    }
  }
  next();
});

// ── Authentication ────────────────────────────────────────
app.use(authMiddleware);

// ── Login routes (before API routes) ─────────────────────
app.get('/login', handleLoginPage);
app.post('/api/v1/auth/login', handleLoginSubmit);
app.get('/logout', handleLogout);

// ── Routes ────────────────────────────────────────────────

// API routes
app.use(apiRoutes);

// Log ingestion routes
app.use(logRoutes);

// Dashboard (single HTML page)
app.get('/', (_req, res) => {
  res.type('html').send(getDashboardHtml());
});

// Health check (public — no auth)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: Math.round(process.uptime()), timestamp: new Date().toISOString() });
});

// ── Initialize ────────────────────────────────────────────

// Test database connection on startup
try {
  getDatabase();
  console.log('[BollaWatch] Database initialized successfully');
} catch (err) {
  console.error('[BollaWatch] FATAL: Database initialization failed:', err);
  process.exit(1);
}

// Run initial cleanup
try {
  const result = cleanupOldEvents();
  if (result.eventsDeleted > 0 || result.metricsDeleted > 0) {
    console.log(`[BollaWatch] Startup cleanup: ${result.eventsDeleted} events, ${result.metricsDeleted} metrics removed`);
  }
} catch (err) {
  console.error('[BollaWatch] Warning: Startup cleanup failed:', err);
}

// Schedule periodic cleanup
const cleanupTimer = setInterval(() => {
  try {
    const result = cleanupOldEvents();
    if (result.eventsDeleted > 0 || result.metricsDeleted > 0) {
      console.log(`[BollaWatch] Cleanup: ${result.eventsDeleted} events, ${result.metricsDeleted} metrics removed`);
    }
  } catch (err) {
    console.error('[BollaWatch] Cleanup error:', err);
  }
}, CLEANUP_INTERVAL_MS);

// ── Start Server ──────────────────────────────────────────

const server = app.listen(PORT, HOST, () => {
  const secret = process.env.BOLLAWATCH_SECRET || 'bollaclaw';
  console.log(`
╔═══════════════════════════════════════════════════╗
║   👁️  BollaWatch v2 — Telemetry Hub              ║
╠═══════════════════════════════════════════════════╣
║                                                   ║
║   URL:     http://watch.bolla.network             ║
║   Local:   http://${HOST}:${PORT}                    ║
║   Health:  http://${HOST}:${PORT}/health            ║
║                                                   ║
║   Auth:    ENABLED (senha: ${secret.substring(0,3)}...)               ║
║                                                   ║
║   Features:                                       ║
║     • Event + Log ingestion & querying            ║
║     • Instance management & cleanup               ║
║     • Resolve/unresolve events                    ║
║     • Raw PM2 log capture                         ║
║     • DB archiving & log rotation                 ║
║     • Full health API for automation              ║
║                                                   ║
╚═══════════════════════════════════════════════════╝
  `);
});

// ── Graceful Shutdown ─────────────────────────────────────

function gracefulShutdown(signal: string): void {
  console.log(`[BollaWatch] ${signal} received — shutting down gracefully...`);

  clearInterval(cleanupTimer);

  server.close(() => {
    console.log('[BollaWatch] HTTP server closed');
    closeDatabase();
    console.log('[BollaWatch] Database closed');
    process.exit(0);
  });

  // Force close after 10s
  setTimeout(() => {
    console.error('[BollaWatch] Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  console.error('[BollaWatch] Uncaught exception:', err);
  // Don't crash — log and continue
});

process.on('unhandledRejection', (reason) => {
  console.error('[BollaWatch] Unhandled rejection:', reason);
});
