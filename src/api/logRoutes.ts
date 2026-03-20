import { Router, Request, Response } from 'express';
import { getDatabase } from '../db/Database';

// ============================================================
// BollaWatch Log Routes — Raw log ingestion & querying
// ============================================================
// Receives raw stdout/stderr log lines from BollaClaw via PM2
// Filters noise, stores important entries, provides search
// ============================================================

const router = Router();

// ── Log importance classification ────────────────────────

const NOISE_PATTERNS = [
  /^\s*$/,                              // empty lines
  /heartbeat/i,                         // heartbeat spam
  /^\[Telemetry\] Flush/,              // telemetry flush messages
  /^\[Telemetry\] Reporting to/,       // telemetry init
  /npm warn/i,                          // npm warnings
  /ExperimentalWarning/i,              // Node experimental warnings
  /DeprecationWarning/i,               // deprecation warnings
];

const ERROR_PATTERNS = [
  /error/i,
  /fatal/i,
  /crash/i,
  /ENOENT/i,
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /unhandled/i,
  /exception/i,
  /stack trace/i,
  /TypeError/i,
  /ReferenceError/i,
  /SyntaxError/i,
  /Cannot find module/i,
  /ENOMEM/i,
  /killed/i,
];

const IMPORTANT_PATTERNS = [
  /started/i,
  /initialized/i,
  /shutting down/i,
  /restarting/i,
  /connected/i,
  /disconnected/i,
  /loaded/i,
  /migration/i,
  /skill/i,
  /provider/i,
  /Soul/i,
  /AgentController/i,
  /Orchestrator/i,
  /listening on/i,
  /PM2/i,
];

function classifyLog(line: string): { level: 'error' | 'warn' | 'info' | 'debug'; important: boolean } {
  // Check noise first
  for (const pattern of NOISE_PATTERNS) {
    if (pattern.test(line)) {
      return { level: 'debug', important: false };
    }
  }

  // Check errors
  for (const pattern of ERROR_PATTERNS) {
    if (pattern.test(line)) {
      return { level: 'error', important: true };
    }
  }

  // Check important
  for (const pattern of IMPORTANT_PATTERNS) {
    if (pattern.test(line)) {
      return { level: 'info', important: true };
    }
  }

  // Warning patterns
  if (/warn/i.test(line)) {
    return { level: 'warn', important: true };
  }

  // Default: info, not important (will be stored but lower priority)
  return { level: 'info', important: false };
}

// ── Ensure logs table exists ──────────────────────────────

function ensureLogsTable(): void {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'stdout',
      level TEXT NOT NULL DEFAULT 'info',
      message TEXT NOT NULL,
      important INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (instance_id) REFERENCES instances(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_logs_instance ON logs(instance_id);
    CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);
    CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_logs_important ON logs(important, created_at);
  `);
}

// Init on import
try { ensureLogsTable(); } catch { /* DB may not be ready yet */ }

// ============================================================
// ENDPOINTS
// ============================================================

// POST /api/v1/logs — Receive raw log lines (batch)
router.post('/api/v1/logs', (req: Request, res: Response) => {
  try {
    ensureLogsTable();
    const { instance_id, logs } = req.body;

    if (!instance_id || typeof instance_id !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid instance_id' });
    }
    if (!logs || !Array.isArray(logs) || logs.length === 0) {
      return res.status(400).json({ error: 'Missing or empty logs array' });
    }
    if (logs.length > 500) {
      return res.status(400).json({ error: 'Batch too large (max 500 lines)' });
    }

    const db = getDatabase();

    // Update instance heartbeat
    db.prepare(`
      UPDATE instances SET last_seen = datetime('now'), status = 'online' WHERE id = ?
    `).run(instance_id);

    const insert = db.prepare(`
      INSERT INTO logs (instance_id, source, level, message, important, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    let stored = 0;
    let filtered = 0;

    const insertMany = db.transaction((entries: Array<{ source?: string; message: string; timestamp?: string }>) => {
      for (const entry of entries) {
        const msg = (entry.message || '').substring(0, 5000);
        if (!msg.trim()) { filtered++; continue; }

        const classification = classifyLog(msg);

        // Skip noise (debug level, not important)
        if (classification.level === 'debug' && !classification.important) {
          filtered++;
          continue;
        }

        const source = entry.source === 'stderr' ? 'stderr' : 'stdout';
        const timestamp = entry.timestamp || new Date().toISOString();

        insert.run(instance_id, source, classification.level, msg, classification.important ? 1 : 0, timestamp);
        stored++;
      }
    });

    insertMany(logs);

    return res.json({ ok: true, stored, filtered });
  } catch (err) {
    console.error('[BollaWatch] Error receiving logs:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/v1/logs — Query logs with filters
router.get('/api/v1/logs', (req: Request, res: Response) => {
  try {
    ensureLogsTable();
    const db = getDatabase();
    const { instance_id, level, source, search, important_only } = req.query;
    const limit = Math.min(Math.max(parseInt(String(req.query.limit), 10) || 200, 1), 1000);
    const offset = Math.max(parseInt(String(req.query.offset), 10) || 0, 0);
    const hours = Math.min(Math.max(parseInt(String(req.query.hours), 10) || 24, 1), 720);

    let where = `WHERE l.created_at >= datetime('now', '-${hours} hours')`;
    const params: unknown[] = [];

    if (instance_id) { where += ' AND l.instance_id = ?'; params.push(String(instance_id)); }
    if (level) { where += ' AND l.level = ?'; params.push(String(level)); }
    if (source) { where += ' AND l.source = ?'; params.push(String(source)); }
    if (search) { where += ' AND l.message LIKE ?'; params.push(`%${search}%`); }
    if (important_only === '1' || important_only === 'true') { where += ' AND l.important = 1'; }

    const countResult = db.prepare(
      `SELECT COUNT(*) as total FROM logs l ${where}`
    ).get(...params) as { total: number };

    const logs = db.prepare(`
      SELECT l.*, i.name as instance_name
      FROM logs l
      LEFT JOIN instances i ON l.instance_id = i.id
      ${where}
      ORDER BY l.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    // Stats
    const stats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN level = 'error' THEN 1 ELSE 0 END) as errors,
        SUM(CASE WHEN level = 'warn' THEN 1 ELSE 0 END) as warnings,
        SUM(CASE WHEN important = 1 THEN 1 ELSE 0 END) as important
      FROM logs l ${where}
    `).get(...params);

    return res.json({ total: countResult.total, limit, offset, hours, stats, logs });
  } catch (err) {
    console.error('[BollaWatch] Error querying logs:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/v1/logs — Clear old logs
router.delete('/api/v1/logs', (req: Request, res: Response) => {
  try {
    ensureLogsTable();
    const db = getDatabase();
    const hours = Math.max(parseInt(String(req.query.hours), 10) || 168, 1); // default 7 days

    const result = db.prepare(
      `DELETE FROM logs WHERE created_at < datetime('now', '-${hours} hours')`
    ).run();

    return res.json({ ok: true, deleted: result.changes });
  } catch (err) {
    console.error('[BollaWatch] Error deleting logs:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
