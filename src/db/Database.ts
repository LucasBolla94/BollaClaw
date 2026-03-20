import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

// ============================================================
// Database — SQLite connection, schema, migrations, cleanup
// ============================================================

let db: Database.Database | null = null;

const DB_VERSION = 2; // Bump this when adding new migrations

export function getDatabase(): Database.Database {
  if (db) return db;

  const dbPath = process.env.DB_PATH || './data/bollawatch.db';
  const dir = path.dirname(dbPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);

  // Performance & safety pragmas
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('cache_size = -8000'); // 8MB cache

  initSchema(db);
  runMigrations(db);

  return db;
}

export function closeDatabase(): void {
  if (db) {
    try {
      db.pragma('optimize');
      db.close();
    } catch {
      // ignore close errors
    }
    db = null;
  }
}

export function getDatabasePath(): string {
  return process.env.DB_PATH || './data/bollawatch.db';
}

export function getDatabaseSizeMB(): number {
  const dbPath = getDatabasePath();
  try {
    const stats = fs.statSync(dbPath);
    return Math.round((stats.size / 1024 / 1024) * 100) / 100;
  } catch {
    return 0;
  }
}

// ── Schema ────────────────────────────────────────────────

function initSchema(db: Database.Database): void {
  db.exec(`
    -- Schema version tracking
    CREATE TABLE IF NOT EXISTS schema_version (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT OR IGNORE INTO schema_version (id, version) VALUES (1, 1);

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
      resolved INTEGER NOT NULL DEFAULT 0,
      resolved_at TEXT,
      resolved_note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (instance_id) REFERENCES instances(id) ON DELETE CASCADE
    );

    -- Indexes for fast queries
    CREATE INDEX IF NOT EXISTS idx_events_instance ON events(instance_id);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
    CREATE INDEX IF NOT EXISTS idx_events_severity ON events(severity);
    CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
    CREATE INDEX IF NOT EXISTS idx_events_type_created ON events(type, created_at);
    CREATE INDEX IF NOT EXISTS idx_events_resolved ON events(resolved);
    CREATE INDEX IF NOT EXISTS idx_events_severity_resolved ON events(severity, resolved, created_at);

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
      FOREIGN KEY (instance_id) REFERENCES instances(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_metrics_instance ON metrics(instance_id);
    CREATE INDEX IF NOT EXISTS idx_metrics_created ON metrics(created_at);
  `);
}

// ── Migrations ────────────────────────────────────────────

function runMigrations(db: Database.Database): void {
  const row = db.prepare('SELECT version FROM schema_version WHERE id = 1').get() as { version: number } | undefined;
  const currentVersion = row?.version || 1;

  if (currentVersion < 2) {
    migrateToV2(db);
  }

  // Update version
  if (currentVersion < DB_VERSION) {
    db.prepare('UPDATE schema_version SET version = ?, updated_at = datetime(\'now\') WHERE id = 1').run(DB_VERSION);
  }
}

function migrateToV2(db: Database.Database): void {
  // Add resolved columns if they don't exist
  const columns = db.prepare('PRAGMA table_info(events)').all() as Array<{ name: string }>;
  const colNames = new Set(columns.map(c => c.name));

  if (!colNames.has('resolved')) {
    db.exec('ALTER TABLE events ADD COLUMN resolved INTEGER NOT NULL DEFAULT 0');
  }
  if (!colNames.has('resolved_at')) {
    db.exec('ALTER TABLE events ADD COLUMN resolved_at TEXT');
  }
  if (!colNames.has('resolved_note')) {
    db.exec('ALTER TABLE events ADD COLUMN resolved_note TEXT');
  }

  // Ensure indexes exist
  db.exec('CREATE INDEX IF NOT EXISTS idx_events_resolved ON events(resolved)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_events_severity_resolved ON events(severity, resolved, created_at)');

  console.log('[BollaWatch] Migration to v2 complete (resolved columns)');
}

// ── Cleanup ──────────────────────────────────────────────

export function cleanupOldEvents(): { eventsDeleted: number; metricsDeleted: number } {
  const database = getDatabase();
  const maxEvents = parseInt(process.env.MAX_EVENTS || '100000', 10);
  const maxAgeDays = parseInt(process.env.MAX_AGE_DAYS || '30', 10);

  let eventsDeleted = 0;
  let metricsDeleted = 0;

  const cleanup = database.transaction(() => {
    // Delete by age
    const ageResult = database.prepare(
      `DELETE FROM events WHERE created_at < datetime('now', '-' || ? || ' days')`
    ).run(maxAgeDays);
    eventsDeleted += ageResult.changes;

    const metricsResult = database.prepare(
      `DELETE FROM metrics WHERE created_at < datetime('now', '-' || ? || ' days')`
    ).run(maxAgeDays);
    metricsDeleted += metricsResult.changes;

    // Delete by count (keep newest)
    const count = database.prepare('SELECT COUNT(*) as cnt FROM events').get() as { cnt: number };
    if (count.cnt > maxEvents) {
      const deleteCount = count.cnt - maxEvents;
      const countResult = database.prepare(
        `DELETE FROM events WHERE id IN (SELECT id FROM events ORDER BY created_at ASC LIMIT ?)`
      ).run(deleteCount);
      eventsDeleted += countResult.changes;
    }
  });

  cleanup();
  return { eventsDeleted, metricsDeleted };
}

// ── Archive ──────────────────────────────────────────────

export function archiveDatabase(): { archivedTo: string; dbSizeBefore: number; dbSizeAfter: number; resolvedArchived: number } {
  const database = getDatabase();
  const dbPath = getDatabasePath();
  const dir = path.dirname(dbPath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const archiveName = `bollawatch-archive-${timestamp}.db`;
  const archivePath = path.join(dir, archiveName);

  const dbSizeBefore = getDatabaseSizeMB();

  // Copy current DB as archive
  fs.copyFileSync(dbPath, archivePath);

  // Delete all resolved events
  const resolved = database.prepare(`DELETE FROM events WHERE resolved = 1`).run();

  // VACUUM to reclaim space
  database.exec('VACUUM');

  const dbSizeAfter = getDatabaseSizeMB();

  return {
    archivedTo: archiveName,
    dbSizeBefore,
    dbSizeAfter,
    resolvedArchived: resolved.changes,
  };
}

export function listArchives(): Array<{ name: string; sizeMB: number; createdAt: string }> {
  const dbPath = getDatabasePath();
  const dir = path.dirname(dbPath);

  try {
    const files = fs.readdirSync(dir)
      .filter(f => f.startsWith('bollawatch-archive-') && f.endsWith('.db'))
      .map(f => {
        const filePath = path.join(dir, f);
        const stats = fs.statSync(filePath);
        return {
          name: f,
          sizeMB: Math.round((stats.size / 1024 / 1024) * 100) / 100,
          createdAt: stats.mtime.toISOString(),
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return files;
  } catch {
    return [];
  }
}

// ── Health Check ─────────────────────────────────────────

export function getDatabaseHealth(): {
  status: 'healthy' | 'degraded' | 'critical';
  sizeMB: number;
  totalEvents: number;
  unresolvedErrors: number;
  totalInstances: number;
  onlineInstances: number;
  staleInstances: number;
  lastEventAt: string | null;
  lastErrorAt: string | null;
  archiveCount: number;
  recommendations: string[];
} {
  const database = getDatabase();
  const recommendations: string[] = [];

  const stats = database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM events) as total_events,
      (SELECT COUNT(*) FROM events WHERE severity IN ('error','fatal') AND resolved = 0) as unresolved_errors,
      (SELECT COUNT(*) FROM instances) as total_instances,
      (SELECT COUNT(*) FROM instances WHERE last_seen >= datetime('now', '-5 minutes')) as online_instances,
      (SELECT COUNT(*) FROM instances WHERE last_seen < datetime('now', '-48 hours')) as stale_instances,
      (SELECT MAX(created_at) FROM events) as last_event_at,
      (SELECT MAX(created_at) FROM events WHERE severity IN ('error','fatal')) as last_error_at
  `).get() as Record<string, unknown>;

  const sizeMB = getDatabaseSizeMB();
  const archiveCount = listArchives().length;
  const unresolvedErrors = (stats.unresolved_errors as number) || 0;
  const onlineInstances = (stats.online_instances as number) || 0;
  const staleInstances = (stats.stale_instances as number) || 0;

  // Determine status
  let status: 'healthy' | 'degraded' | 'critical' = 'healthy';
  if (unresolvedErrors > 5 || onlineInstances === 0) {
    status = 'critical';
  } else if (unresolvedErrors > 0 || staleInstances > 3) {
    status = 'degraded';
  }

  // Generate recommendations
  if (staleInstances > 0) {
    recommendations.push(`${staleInstances} stale instance(s) should be cleaned up`);
  }
  if (unresolvedErrors > 0) {
    recommendations.push(`${unresolvedErrors} unresolved error(s) need attention`);
  }
  if (sizeMB > 50) {
    recommendations.push(`Database is ${sizeMB}MB — consider archiving`);
  }
  if ((stats.total_events as number) > 80000) {
    recommendations.push(`${stats.total_events} events — approaching 100K cleanup threshold`);
  }

  return {
    status,
    sizeMB,
    totalEvents: (stats.total_events as number) || 0,
    unresolvedErrors,
    totalInstances: (stats.total_instances as number) || 0,
    onlineInstances,
    staleInstances,
    lastEventAt: (stats.last_event_at as string) || null,
    lastErrorAt: (stats.last_error_at as string) || null,
    archiveCount,
    recommendations,
  };
}
