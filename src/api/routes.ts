import { Router, Request, Response } from 'express';
import {
  getDatabase,
  cleanupOldEvents,
  archiveDatabase,
  listArchives,
  getDatabaseHealth,
  getDatabaseSizeMB,
} from '../db/Database';

// ============================================================
// BollaWatch API v1 — Telemetry collection & management
// ============================================================

const router = Router();

// ── Helpers ───────────────────────────────────────────────

function safeParseJSON(str: string | null): unknown {
  if (!str) return {};
  try { return JSON.parse(str); } catch { return str; }
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = parseInt(String(value), 10);
  if (isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function sanitizeString(str: unknown, maxLen = 500): string {
  if (typeof str !== 'string') return '';
  return str.substring(0, maxLen).trim();
}

function logAction(action: string, details?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  console.log(`[BollaWatch] [${timestamp}] ${action}`, details ? JSON.stringify(details) : '');
}

// ============================================================
// INGESTION ENDPOINTS
// ============================================================

// POST /api/v1/events — Receive telemetry events (batch)
router.post('/api/v1/events', (req: Request, res: Response) => {
  try {
    const { instance_id, events } = req.body;

    if (!instance_id || typeof instance_id !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid instance_id' });
    }
    if (!events || !Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: 'Missing or empty events array' });
    }
    if (events.length > 200) {
      return res.status(400).json({ error: 'Batch too large (max 200 events)' });
    }

    const db = getDatabase();

    // Upsert instance heartbeat
    db.prepare(`
      INSERT INTO instances (id, last_seen, status)
      VALUES (?, datetime('now'), 'online')
      ON CONFLICT(id) DO UPDATE SET last_seen = datetime('now'), status = 'online'
    `).run(instance_id);

    // Insert events in transaction
    const insertEvent = db.prepare(`
      INSERT INTO events (instance_id, type, severity, category, message, data, stack_trace, duration_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((evts: Array<Record<string, unknown>>) => {
      let inserted = 0;
      for (const evt of evts) {
        const type = sanitizeString(evt.type, 50) || 'unknown';
        const severity = sanitizeString(evt.severity, 10) || 'info';
        const category = sanitizeString(evt.category, 100) || null;
        const message = sanitizeString(evt.message, 2000) || null;
        const stackTrace = typeof evt.stack_trace === 'string' ? evt.stack_trace.substring(0, 5000) : null;
        const durationMs = typeof evt.duration_ms === 'number' ? Math.round(evt.duration_ms) : null;
        const timestamp = typeof evt.timestamp === 'string' ? evt.timestamp : new Date().toISOString();
        const data = JSON.stringify(evt.data || {});

        insertEvent.run(instance_id, type, severity, category, message, data, stackTrace, durationMs, timestamp);
        inserted++;
      }
      return inserted;
    });

    const count = insertMany(events);
    return res.json({ ok: true, received: count });
  } catch (err) {
    console.error('[BollaWatch] Error receiving events:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/v1/register — Register/update instance info
router.post('/api/v1/register', (req: Request, res: Response) => {
  try {
    const { instance_id, name, hostname, version, provider, model, server_url, meta } = req.body;

    if (!instance_id || typeof instance_id !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid instance_id' });
    }

    const db = getDatabase();
    db.prepare(`
      INSERT INTO instances (id, name, hostname, version, provider, model, server_url, meta, last_seen, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 'online')
      ON CONFLICT(id) DO UPDATE SET
        name = COALESCE(?, name),
        hostname = COALESCE(?, hostname),
        version = COALESCE(?, version),
        provider = COALESCE(?, provider),
        model = COALESCE(?, model),
        server_url = COALESCE(?, server_url),
        meta = COALESCE(?, meta),
        last_seen = datetime('now'),
        status = 'online'
    `).run(
      instance_id,
      sanitizeString(name, 100) || 'BollaClaw',
      sanitizeString(hostname, 200),
      sanitizeString(version, 20),
      sanitizeString(provider, 50),
      sanitizeString(model, 100),
      sanitizeString(server_url, 200),
      JSON.stringify(meta || {}),
      sanitizeString(name, 100) || null,
      sanitizeString(hostname, 200) || null,
      sanitizeString(version, 20) || null,
      sanitizeString(provider, 50) || null,
      sanitizeString(model, 100) || null,
      sanitizeString(server_url, 200) || null,
      JSON.stringify(meta || {})
    );

    logAction('INSTANCE_REGISTERED', { instance_id, name });
    return res.json({ ok: true, instance_id });
  } catch (err) {
    console.error('[BollaWatch] Error registering instance:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/v1/metrics — Receive periodic metrics snapshot
router.post('/api/v1/metrics', (req: Request, res: Response) => {
  try {
    const { instance_id, ...metrics } = req.body;

    if (!instance_id || typeof instance_id !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid instance_id' });
    }

    const db = getDatabase();

    // Update instance heartbeat
    db.prepare(`
      UPDATE instances SET last_seen = datetime('now'), status = 'online' WHERE id = ?
    `).run(instance_id);

    db.prepare(`
      INSERT INTO metrics (instance_id, cpu_percent, memory_mb, memory_percent, uptime_seconds,
        messages_processed, tool_calls_total, errors_total, avg_response_ms, active_conversations)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      instance_id,
      typeof metrics.cpu_percent === 'number' ? metrics.cpu_percent : null,
      typeof metrics.memory_mb === 'number' ? metrics.memory_mb : null,
      typeof metrics.memory_percent === 'number' ? metrics.memory_percent : null,
      typeof metrics.uptime_seconds === 'number' ? metrics.uptime_seconds : null,
      typeof metrics.messages_processed === 'number' ? metrics.messages_processed : 0,
      typeof metrics.tool_calls_total === 'number' ? metrics.tool_calls_total : 0,
      typeof metrics.errors_total === 'number' ? metrics.errors_total : 0,
      typeof metrics.avg_response_ms === 'number' ? metrics.avg_response_ms : null,
      typeof metrics.active_conversations === 'number' ? metrics.active_conversations : 0
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error('[BollaWatch] Error receiving metrics:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// QUERY ENDPOINTS
// ============================================================

// GET /api/v1/events — Query events with filters
router.get('/api/v1/events', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const {
      instance_id, type, severity, category, search, from, to, resolved,
    } = req.query;

    const limit = clampInt(req.query.limit, 1, 500, 100);
    const offset = clampInt(req.query.offset, 0, 1000000, 0);

    let where = 'WHERE 1=1';
    const params: unknown[] = [];

    if (instance_id) { where += ' AND e.instance_id = ?'; params.push(String(instance_id)); }
    if (type) { where += ' AND e.type = ?'; params.push(String(type)); }
    if (severity) { where += ' AND e.severity = ?'; params.push(String(severity)); }
    if (category) { where += ' AND e.category = ?'; params.push(String(category)); }
    if (search) { where += ' AND (e.message LIKE ? OR e.data LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    if (from) { where += ' AND e.created_at >= ?'; params.push(String(from)); }
    if (to) { where += ' AND e.created_at <= ?'; params.push(String(to)); }
    if (resolved !== undefined && resolved !== '') {
      where += ' AND e.resolved = ?';
      params.push(parseInt(String(resolved), 10) || 0);
    }

    const countResult = db.prepare(
      `SELECT COUNT(*) as total FROM events e ${where}`
    ).get(...params) as { total: number };

    const events = db.prepare(`
      SELECT e.*, i.name as instance_name
      FROM events e
      LEFT JOIN instances i ON e.instance_id = i.id
      ${where}
      ORDER BY e.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    return res.json({
      total: countResult.total,
      limit,
      offset,
      events: (events as Array<Record<string, unknown>>).map(e => ({
        ...e,
        data: safeParseJSON(e.data as string),
      })),
    });
  } catch (err) {
    console.error('[BollaWatch] Error querying events:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/v1/errors — Error-specific view with grouping
router.get('/api/v1/errors', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { instance_id, include_resolved } = req.query;
    const limit = clampInt(req.query.limit, 1, 500, 50);
    const hours = clampInt(req.query.hours, 1, 720, 24);

    let where = `WHERE e.severity IN ('error', 'fatal') AND e.created_at >= datetime('now', ? || ' hours')`;
    const params: unknown[] = [`-${hours}`];

    if (!include_resolved) {
      where += ' AND e.resolved = 0';
    }
    if (instance_id) { where += ' AND e.instance_id = ?'; params.push(String(instance_id)); }

    const errors = db.prepare(`
      SELECT e.*, i.name as instance_name
      FROM events e
      LEFT JOIN instances i ON e.instance_id = i.id
      ${where}
      ORDER BY e.created_at DESC
      LIMIT ?
    `).all(...params, limit);

    // Group by message pattern
    const grouped: Record<string, { count: number; last_seen: string; instances: string[] }> = {};
    for (const err of errors as Array<Record<string, unknown>>) {
      const key = (err.message as string) || 'unknown';
      if (!grouped[key]) {
        grouped[key] = { count: 0, last_seen: err.created_at as string, instances: [] };
      }
      grouped[key].count++;
      if (!grouped[key].instances.includes(err.instance_id as string)) {
        grouped[key].instances.push(err.instance_id as string);
      }
    }

    return res.json({
      total: (errors as unknown[]).length,
      hours,
      errors: (errors as Array<Record<string, unknown>>).map(e => ({
        ...e,
        data: safeParseJSON(e.data as string),
      })),
      patterns: Object.entries(grouped)
        .map(([message, info]) => ({ message, ...info }))
        .sort((a, b) => b.count - a.count),
    });
  } catch (err) {
    console.error('[BollaWatch] Error querying errors:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/v1/instances — List all instances
router.get('/api/v1/instances', (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const instances = db.prepare(`
      SELECT i.*,
        (SELECT COUNT(*) FROM events WHERE instance_id = i.id AND severity IN ('error','fatal') AND resolved = 0
         AND created_at >= datetime('now', '-24 hours')) as errors_24h,
        (SELECT COUNT(*) FROM events WHERE instance_id = i.id
         AND created_at >= datetime('now', '-24 hours')) as events_24h
      FROM instances i
      ORDER BY i.last_seen DESC
    `).all();

    // Mark offline instances (no heartbeat in 5 min)
    for (const inst of instances as Array<Record<string, unknown>>) {
      const lastSeen = new Date((inst.last_seen as string) + 'Z').getTime();
      const fiveMinAgo = Date.now() - 5 * 60 * 1000;
      if (lastSeen < fiveMinAgo) {
        inst.status = 'offline';
      }
      inst.meta = safeParseJSON(inst.meta as string);
    }

    return res.json({ instances });
  } catch (err) {
    console.error('[BollaWatch] Error listing instances:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/v1/metrics — Query metrics for charts
router.get('/api/v1/metrics', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { instance_id } = req.query;
    const hours = clampInt(req.query.hours, 1, 720, 24);

    let where = `WHERE created_at >= datetime('now', ? || ' hours')`;
    const params: unknown[] = [`-${hours}`];

    if (instance_id) { where += ' AND instance_id = ?'; params.push(String(instance_id)); }

    const metrics = db.prepare(
      `SELECT * FROM metrics ${where} ORDER BY created_at ASC`
    ).all(...params);

    const summary = db.prepare(`
      SELECT
        AVG(cpu_percent) as avg_cpu,
        AVG(memory_mb) as avg_memory_mb,
        MAX(memory_mb) as peak_memory_mb,
        SUM(messages_processed) as total_messages,
        SUM(tool_calls_total) as total_tool_calls,
        SUM(errors_total) as total_errors,
        AVG(avg_response_ms) as avg_response_ms
      FROM metrics ${where}
    `).get(...params);

    return res.json({ metrics, summary, hours });
  } catch (err) {
    console.error('[BollaWatch] Error querying metrics:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/v1/stats — Quick overview stats
router.get('/api/v1/stats', (_req: Request, res: Response) => {
  try {
    const db = getDatabase();

    const stats = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM instances) as total_instances,
        (SELECT COUNT(*) FROM instances WHERE last_seen >= datetime('now', '-5 minutes')) as online_instances,
        (SELECT COUNT(*) FROM events WHERE created_at >= datetime('now', '-24 hours')) as events_24h,
        (SELECT COUNT(*) FROM events WHERE severity IN ('error','fatal') AND resolved = 0 AND created_at >= datetime('now', '-24 hours')) as errors_24h,
        (SELECT COUNT(*) FROM events WHERE type = 'message' AND created_at >= datetime('now', '-24 hours')) as messages_24h,
        (SELECT COUNT(*) FROM events WHERE type = 'tool_call' AND created_at >= datetime('now', '-24 hours')) as tool_calls_24h,
        (SELECT COUNT(*) FROM events WHERE resolved = 1 AND resolved_at >= datetime('now', '-24 hours')) as resolved_24h,
        (SELECT COUNT(*) FROM events WHERE severity IN ('error','fatal') AND resolved = 0) as unresolved_errors_total,
        (SELECT COUNT(*) FROM events) as total_events
    `).get();

    return res.json(stats);
  } catch (err) {
    console.error('[BollaWatch] Error getting stats:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// EVENT MANAGEMENT ENDPOINTS
// ============================================================

// PUT /api/v1/events/:id/resolve — Resolve single event
router.put('/api/v1/events/:id/resolve', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const eventId = parseInt(req.params.id, 10);
    const note = sanitizeString(req.body?.note, 500) || null;

    if (isNaN(eventId)) {
      return res.status(400).json({ error: 'Invalid event ID' });
    }

    const result = db.prepare(`
      UPDATE events SET resolved = 1, resolved_at = datetime('now'), resolved_note = ?
      WHERE id = ? AND resolved = 0
    `).run(note, eventId);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Event not found or already resolved' });
    }

    logAction('EVENT_RESOLVED', { eventId, note });
    return res.json({ ok: true, resolved: 1 });
  } catch (err) {
    console.error('[BollaWatch] Error resolving event:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/v1/events/resolve-batch — Resolve multiple events
router.put('/api/v1/events/resolve-batch', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { event_ids, note } = req.body;

    if (!event_ids || !Array.isArray(event_ids) || event_ids.length === 0) {
      return res.status(400).json({ error: 'Missing or empty event_ids array' });
    }
    if (event_ids.length > 1000) {
      return res.status(400).json({ error: 'Too many events (max 1000)' });
    }

    const sanitizedNote = sanitizeString(note, 500) || null;
    const placeholders = event_ids.map(() => '?').join(',');

    const result = db.prepare(`
      UPDATE events SET resolved = 1, resolved_at = datetime('now'), resolved_note = ?
      WHERE id IN (${placeholders}) AND resolved = 0
    `).run(sanitizedNote, ...event_ids);

    logAction('EVENTS_RESOLVED_BATCH', { count: result.changes, note: sanitizedNote });
    return res.json({ ok: true, resolved: result.changes });
  } catch (err) {
    console.error('[BollaWatch] Error batch resolving:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/v1/events/resolve-pattern — Resolve by message pattern
router.put('/api/v1/events/resolve-pattern', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { message_pattern, note } = req.body;

    if (!message_pattern || typeof message_pattern !== 'string') {
      return res.status(400).json({ error: 'Missing message_pattern' });
    }

    const sanitizedNote = sanitizeString(note, 500) || null;

    const result = db.prepare(`
      UPDATE events SET resolved = 1, resolved_at = datetime('now'), resolved_note = ?
      WHERE message LIKE ? AND resolved = 0
    `).run(sanitizedNote, `%${message_pattern}%`);

    logAction('EVENTS_RESOLVED_PATTERN', { pattern: message_pattern, count: result.changes });
    return res.json({ ok: true, resolved: result.changes, pattern: message_pattern });
  } catch (err) {
    console.error('[BollaWatch] Error resolving by pattern:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// INSTANCE MANAGEMENT ENDPOINTS
// ============================================================

// DELETE /api/v1/instances/:id — Delete instance and cascade
router.delete('/api/v1/instances/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const instanceId = req.params.id;

    const deleteAll = db.transaction(() => {
      const eventsResult = db.prepare('DELETE FROM events WHERE instance_id = ?').run(instanceId);
      const metricsResult = db.prepare('DELETE FROM metrics WHERE instance_id = ?').run(instanceId);
      const instanceResult = db.prepare('DELETE FROM instances WHERE id = ?').run(instanceId);
      return {
        instance_deleted: instanceResult.changes,
        events_deleted: eventsResult.changes,
        metrics_deleted: metricsResult.changes,
      };
    });

    const result = deleteAll();

    if (result.instance_deleted === 0) {
      return res.status(404).json({ error: 'Instance not found' });
    }

    logAction('INSTANCE_DELETED', { instanceId, ...result });
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[BollaWatch] Error deleting instance:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/v1/instances/cleanup-stale — Remove stale instances
router.delete('/api/v1/instances/cleanup-stale', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const hours = clampInt(req.body?.hours || req.query.hours, 1, 8760, 48);
    const namePattern = sanitizeString(req.body?.name_pattern || req.query.name_pattern, 100);

    let where = `WHERE last_seen < datetime('now', ? || ' hours')`;
    const params: unknown[] = [`-${hours}`];

    if (namePattern) {
      where += ' AND name LIKE ?';
      params.push(`%${namePattern}%`);
    }

    // Find stale instances first
    const staleInstances = db.prepare(
      `SELECT id FROM instances ${where}`
    ).all(...params) as Array<{ id: string }>;

    if (staleInstances.length === 0) {
      return res.json({ ok: true, deleted: 0, message: 'No stale instances found' });
    }

    const deleteStale = db.transaction(() => {
      let totalEvents = 0;
      let totalMetrics = 0;

      for (const inst of staleInstances) {
        const ev = db.prepare('DELETE FROM events WHERE instance_id = ?').run(inst.id);
        const me = db.prepare('DELETE FROM metrics WHERE instance_id = ?').run(inst.id);
        totalEvents += ev.changes;
        totalMetrics += me.changes;
      }

      const ids = staleInstances.map(i => i.id);
      const placeholders = ids.map(() => '?').join(',');
      const instResult = db.prepare(`DELETE FROM instances WHERE id IN (${placeholders})`).run(...ids);

      return {
        instances_deleted: instResult.changes,
        events_deleted: totalEvents,
        metrics_deleted: totalMetrics,
      };
    });

    const result = deleteStale();
    logAction('STALE_INSTANCES_CLEANED', result);
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[BollaWatch] Error cleaning stale instances:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/v1/instances/:id/rename — Rename instance
router.put('/api/v1/instances/:id/rename', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const instanceId = req.params.id;
    const newName = sanitizeString(req.body?.name, 100);

    if (!newName) {
      return res.status(400).json({ error: 'Missing name' });
    }

    const result = db.prepare('UPDATE instances SET name = ? WHERE id = ?').run(newName, instanceId);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Instance not found' });
    }

    logAction('INSTANCE_RENAMED', { instanceId, newName });
    return res.json({ ok: true, name: newName });
  } catch (err) {
    console.error('[BollaWatch] Error renaming instance:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// ARCHIVE & MAINTENANCE ENDPOINTS
// ============================================================

// POST /api/v1/archive — Archive resolved events + compact DB
router.post('/api/v1/archive', (_req: Request, res: Response) => {
  try {
    const result = archiveDatabase();
    logAction('DATABASE_ARCHIVED', result);
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[BollaWatch] Error archiving:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/v1/archives — List archive files
router.get('/api/v1/archives', (_req: Request, res: Response) => {
  try {
    const archives = listArchives();
    return res.json({ archives, count: archives.length });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/v1/cleanup — Trigger manual cleanup
router.post('/api/v1/cleanup', (_req: Request, res: Response) => {
  try {
    const result = cleanupOldEvents();
    logAction('CLEANUP_EXECUTED', result);
    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/v1/events — Clear events with filters
router.delete('/api/v1/events', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { instance_id, before, type } = req.query;

    let where = 'WHERE 1=1';
    const params: unknown[] = [];

    if (instance_id) { where += ' AND instance_id = ?'; params.push(String(instance_id)); }
    if (before) { where += ' AND created_at < ?'; params.push(String(before)); }
    if (type) { where += ' AND type = ?'; params.push(String(type)); }

    const result = db.prepare(`DELETE FROM events ${where}`).run(...params);

    logAction('EVENTS_DELETED', { filters: { instance_id, before, type }, count: result.changes });
    return res.json({ ok: true, deleted: result.changes });
  } catch (err) {
    console.error('[BollaWatch] Error deleting events:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// HEALTH & STATUS ENDPOINTS
// ============================================================

// GET /api/v1/health/full — Complete health check for automation
router.get('/api/v1/health/full', (_req: Request, res: Response) => {
  try {
    const health = getDatabaseHealth();
    return res.json({
      ...health,
      uptime_seconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ status: 'critical', error: 'Health check failed' });
  }
});

// GET /api/v1/db/size — Quick DB size check
router.get('/api/v1/db/size', (_req: Request, res: Response) => {
  try {
    return res.json({ sizeMB: getDatabaseSizeMB() });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
