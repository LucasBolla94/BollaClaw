import * as dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import * as path from 'path';
import apiRoutes from './api/routes';
import { getDatabase, cleanupOldEvents } from './db/Database';
import { getDashboardHtml } from './dashboard/dashboard';

const PORT = parseInt(process.env.PORT || '21087', 10);
const HOST = process.env.HOST || '0.0.0.0';

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// API routes
app.use(apiRoutes);

// Dashboard (single HTML page)
app.get('/', (_req, res) => {
  res.type('html').send(getDashboardHtml());
});

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Initialize database
getDatabase();

// Schedule cleanup every 6 hours
setInterval(() => {
  try {
    cleanupOldEvents();
    console.log('[BollaWatch] Cleanup completed');
  } catch (err) {
    console.error('[BollaWatch] Cleanup error:', err);
  }
}, 6 * 60 * 60 * 1000);

// Start server
app.listen(PORT, HOST, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║   👁️  BollaWatch v0.1 - Telemetry Hub       ║
╠══════════════════════════════════════════════╣
║                                              ║
║   Dashboard: http://${HOST}:${PORT}             ║
║   API Base:  http://${HOST}:${PORT}/api/v1      ║
║                                              ║
║   Endpoints:                                 ║
║     POST /api/v1/register  — Register bot    ║
║     POST /api/v1/events    — Send events     ║
║     POST /api/v1/metrics   — Send metrics    ║
║     GET  /api/v1/events    — Query events    ║
║     GET  /api/v1/errors    — View errors     ║
║     GET  /api/v1/instances — List instances   ║
║     GET  /api/v1/metrics   — Query metrics   ║
║     GET  /api/v1/stats     — Quick stats     ║
║                                              ║
╚══════════════════════════════════════════════╝
  `);
});
