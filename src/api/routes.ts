import { Router, Request, Response } from 'express';
import { getDatabase, cleanupOldEvents } from '../db/Database';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// ============================================================
// POST /api/v1/events — Receive telemetry events (batch)
// ============================================================
router.post('/api/v1/events', (req: Request, res: Response) => {
  try {
    const { instance_id, events } = req.body;

    if (!instance_id || !events || !Array.isArray(events)) {
      return res.status(400).json({ error: 'Missing instance_id or events array' });
    }

    const db = getDatabase();

    // Upsert instance
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

    const insertMany = db.transaction((evts: any[]) => {
      for (const evt of evts) {
        insertEvent.run(
          instance_id,
          evt.type || 'unknown',
          evt.severity || 'info',
          evt.category || null,
          evt.message || null,
          JSON.stringify(evt.data || {}),
          evt.stack_trace || null,
          evt.duration_ms || null,
          evt.timestamp || new Date().toISOString()
        );
      }
    });

    insertMany(events);

    return res.json({ ok: true, received: events.length });
  } catch (err) {
    console.error('Error receiving events:', err);
    return res.status(500).json({ error: String(err) });
  }
});

// ============================================================
// POST /api/v1/register — Register/update instance info
// ============================================================
router.post('/api/v1/register', (req: Request, res: Response) => {
  try {
    const { instance_id, name, hostname, version, provider, model, server_url, meta } = req.body;

    if (!instance_id) {
      return res.status(400).json({ error: 'Missing instance_id' });
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
      instance_id, name, hostname, version, provider, model, server_url, JSON.stringify(meta || {}),
      name, hostname, version, provider, model, server_url, JSON.stringify(meta || {})
    );

    return res.json({ ok: true, instance_id });
  } catch (err) {
    console.error('Error registering instance:', err);
    return res.status(500).json({ error: String(err) });
  }
});

// ============================================================
// POST /api/v1/metrics — Receive periodic metrics snapshot
// ============================================================
router.post('/api/v1/metrics', (req: Request, res: Response) => {
  try {
    const { instance_id, ...metrics } = req.body;

    if (!instance_id) {
      return res.status(400).json({ error: 'Missing instance_id' });
    }

    const db = getDatabase();

    // Update instance last_seen
    db.prepare(`
      UPDATE instances SET last_seen = datetime('now'), status = 'online' WHERE id = ?
    `).run(instance_id);

    db.prepare(`
      INSERT INTO metrics (instance_id, cpu_percent, memory_mb, memory_percent, uptime_seconds,
        messages_processed, tool_calls_total, errors_total, avg_response_ms, active_conversations)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      instance_id,
      metrics.cpu_percent ?? null,
      metrics.memory_mb ?? null,
      metrics.memory_percent ?? null,
      metrics.uptime_seconds ?? null,
      metrics.messages_processed ?? 0,
      metrics.tool_calls_total ?? 0,
      metrics.errors_total ?? 0,
      metrics.avg_response_ms ?? null,
      metrics.active_conversations ?? 0
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error('Error receiving metrics:', err);
    return res.status(500).json({ error: String(err) });
  }
});

// ============================================================
// GET /api/v1/events — Query events
// ============================================================
router.get('/api/v1/events', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const {
      instance_id,
      type,
      severity,
      category,
      search,
      limit = '100',
      offset = '0',
      from,
      to,
    } = req.query;

    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (instance_id) { where += ' AND e.instance_id = ?'; params.push(instance_id); }
    if (type) { where += ' AND e.type = ?'; params.push(type); }
    if (severity) { where += ' AND e.severity = ?'; params.push(severity); }
    if (category) { where += ' AND e.category = ?'; params.push(category); }
    if (search) { where += ' AND (e.message LIKE ? OR e.data LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    if (from) { where += ' AND e.created_at >= ?'; params.push(from); }
    if (to) { where += ' AND e.created_at <= ?'; params.push(to); }

    // Count total
    const countResult = db.prepare(
      `SELECT COUNT(*) as total FROM events e ${where}`
    ).get(...params) as { total: number };

    // Fetch page
    const events = db.prepare(`
      SELECT e.*, i.name as instance_name
      FROM events e
      LEFT JOIN instances i ON e.instance_id = i.id
      ${where}
      ORDER BY e.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, parseInt(limit as string), parseInt(offset as string));

    return res.json({
      total: countResult.total,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
      events: events.map((e: any) => ({
        ...e,
        data: safeParseJSON(e.data),
      })),
    });
  } catch (err) {
    console.error('Error querying events:', err);
    return res.status(500).json({ error: String(err) });
  }
});

// ============================================================
// GET /api/v1/errors — Error-specific view with grouping
// ============================================================
router.get('/api/v1/errors', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { instance_id, limit = '50', hours = '24' } = req.query;

    let where = `WHERE e.severity IN ('error', 'fatal') AND e.created_at >= datetime('now', '-${hours} hours')`;
    const params: any[] = [];

    if (instance_id) { where += ' AND e.instance_id = ?'; params.push(instance_id); }

    const errors = db.prepare(`
      SELECT e.*, i.name as instance_name
      FROM events e
      LEFT JOIN instances i ON e.instance_id = i.id
      ${where}
      ORDER BY e.created_at DESC
      LIMIT ?
    `).all(...params, parseInt(limit as string));

    // Group errors by message for pattern detection
    const grouped: Record<string, { count: number; last_seen: string; instances: string[] }> = {};
    for (const err of errors as any[]) {
      const key = err.message || 'unknown';
      if (!grouped[key]) {
        grouped[key] = { count: 0, last_seen: err.created_at, instances: [] };
      }
      grouped[key].count++;
      if (!grouped[key].instances.includes(err.instance_id)) {
        grouped[key].instances.push(err.instance_id);
      }
    }

    return res.json({
      total: (errors as any[]).length,
      hours: parseInt(hours as string),
      errors: (errors as any[]).map((e: any) => ({
        ...e,
        data: safeParseJSON(e.data),
      })),
      patterns: Object.entries(grouped)
        .map(([message, info]) => ({ message, ...info }))
        .sort((a, b) => b.count - a.count),
    });
  } catch (err) {
    console.error('Error querying errors:', err);
    return res.status(500).json({ error: String(err) });
  }
});

// ============================================================
// GET /api/v1/instances — List all instances
// ============================================================
router.get('/api/v1/instances', (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const instances = db.prepare(`
      SELECT i.*,
        (SELECT COUNT(*) FROM events WHERE instance_id = i.id AND severity IN ('error','fatal')
         AND created_at >= datetime('now', '-24 hours')) as errors_24h,
        (SELECT COUNT(*) FROM events WHERE instance_id = i.id
         AND created_at >= datetime('now', '-24 hours')) as events_24h
      FROM instances i
      ORDER BY i.last_seen DESC
    `).all();

    // Mark offline instances (no heartbeat in 5 min)
    for (const inst of instances as any[]) {
      const lastSeen = new Date(inst.last_seen + 'Z').getTime();
      const fiveMinAgo = Date.now() - 5 * 60 * 1000;
      if (lastSeen < fiveMinAgo) {
        inst.status = 'offline';
      }
      inst.meta = safeParseJSON(inst.meta);
    }

    return res.json({ instances });
  } catch (err) {
    console.error('Error listing instances:', err);
    return res.status(500).json({ error: String(err) });
  }
});

// ============================================================
// GET /api/v1/metrics — Query metrics for dashboard charts
// ============================================================
router.get('/api/v1/metrics', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { instance_id, hours = '24' } = req.query;

    let where = `WHERE created_at >= datetime('now', '-${hours} hours')`;
    const params: any[] = [];

    if (instance_id) { where += ' AND instance_id = ?'; params.push(instance_id); }

    const metrics = db.prepare(`
      SELECT * FROM metrics ${where} ORDER BY created_at ASC
    `).all(...params);

    // Aggregate summary
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

    return res.json({ metrics, summary, hours: parseInt(hours as string) });
  } catch (err) {
    console.error('Error querying metrics:', err);
    return res.status(500).json({ error: String(err) });
  }
});

// ============================================================
// GET /api/v1/stats — Quick overview stats
// ============================================================
router.get('/api/v1/stats', (_req: Request, res: Response) => {
  try {
    const db = getDatabase();

    const stats = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM instances) as total_instances,
        (SELECT COUNT(*) FROM instances WHERE status = 'online') as online_instances,
        (SELECT COUNT(*) FROM events WHERE created_at >= datetime('now', '-24 hours')) as events_24h,
        (SELECT COUNT(*) FROM events WHERE severity IN ('error','fatal') AND created_at >= datetime('now', '-24 hours')) as errors_24h,
        (SELECT COUNT(*) FROM events WHERE type = 'message' AND created_at >= datetime('now', '-24 hours')) as messages_24h,
        (SELECT COUNT(*) FROM events WHERE type = 'tool_call' AND created_at >= datetime('now', '-24 hours')) as tool_calls_24h,
        (SELECT COUNT(*) FROM events) as total_events
    `).get();

    return res.json(stats);
  } catch (err) {
    console.error('Error getting stats:', err);
    return res.status(500).json({ error: String(err) });
  }
});

// ============================================================
// DELETE /api/v1/events — Clear events (with filters)
// ============================================================
router.delete('/api/v1/events', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { instance_id, before, type } = req.query;

    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (instance_id) { where += ' AND instance_id = ?'; params.push(instance_id); }
    if (before) { where += ' AND created_at < ?'; params.push(before); }
    if (type) { where += ' AND type = ?'; params.push(type); }

    const result = db.prepare(`DELETE FROM events ${where}`).run(...params);

    return res.json({ ok: true, deleted: result.changes });
  } catch (err) {
    console.error('Error deleting events:', err);
    return res.status(500).json({ error: String(err) });
  }
});

// ============================================================
// POST /api/v1/cleanup — Trigger manual cleanup
// ============================================================
router.post('/api/v1/cleanup', (_req: Request, res: Response) => {
  try {
    cleanupOldEvents();
    return res.json({ ok: true, message: 'Cleanup completed' });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

function safeParseJSON(str: string | null): any {
  if (!str) return {};
  try { return JSON.parse(str); } catch { return str; }
}

export default router;
