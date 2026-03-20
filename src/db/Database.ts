import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (db) return db;

  const dbPath = process.env.DB_PATH || './data/bollawatch.db';
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  initSchema(db);
  return db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    -- Instances: each BollaClaw bot that reports telemetry
    CREATE TABLE IF NOT EXISTS instances (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT 'BollaClaw',
      hostname TEXT,
      version TEXT,
      provider TEXT,
      model TEXT,
      server_url TEXT,
      first_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'online',
      meta TEXT DEFAULT '{}'
    );

    -- Events: all telemetry events
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id TEXT NOT NULL,
      type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      category TEXT,
      message TEXT,
      data TEXT DEFAULT '{}',
      stack_trace TEXT,
      duration_ms INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (instance_id) REFERENCES instances(id)
    );

    -- Indexes for fast queries
    CREATE INDEX IF NOT EXISTS idx_events_instance ON events(instance_id);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
    CREATE INDEX IF NOT EXISTS idx_events_severity ON events(severity);
    CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
    CREATE INDEX IF NOT EXISTS idx_events_type_created ON events(type, created_at);

    -- Metrics snapshots: periodic system metrics
    CREATE TABLE IF NOT EXISTS metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id TEXT NOT NULL,
      cpu_percent REAL,
      memory_mb REAL,
      memory_percent REAL,
      uptime_seconds INTEGER,
      messages_processed INTEGER DEFAULT 0,
      tool_calls_total INTEGER DEFAULT 0,
      errors_total INTEGER DEFAULT 0,
      avg_response_ms REAL,
      active_conversations INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (instance_id) REFERENCES instances(id)
    );

    CREATE INDEX IF NOT EXISTS idx_metrics_instance ON metrics(instance_id);
    CREATE INDEX IF NOT EXISTS idx_metrics_created ON metrics(created_at);
  `);
}

/**
 * Auto-cleanup old events beyond retention limits
 */
export function cleanupOldEvents(): void {
  const database = getDatabase();
  const maxEvents = parseInt(process.env.MAX_EVENTS || '100000', 10);
  const maxAgeDays = parseInt(process.env.MAX_AGE_DAYS || '30', 10);

  // Delete by age
  database.prepare(
    `DELETE FROM events WHERE created_at < datetime('now', '-' || ? || ' days')`
  ).run(maxAgeDays);

  database.prepare(
    `DELETE FROM metrics WHERE created_at < datetime('now', '-' || ? || ' days')`
  ).run(maxAgeDays);

  // Delete by count (keep newest)
  const count = database.prepare('SELECT COUNT(*) as cnt FROM events').get() as { cnt: number };
  if (count.cnt > maxEvents) {
    const deleteCount = count.cnt - maxEvents;
    database.prepare(
      `DELETE FROM events WHERE id IN (SELECT id FROM events ORDER BY created_at ASC LIMIT ?)`
    ).run(deleteCount);
  }
}
