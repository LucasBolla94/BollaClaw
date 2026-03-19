import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../utils/config';
import { logger } from '../utils/logger';

export class DatabaseSingleton {
  private static instance: Database.Database | null = null;

  static getInstance(): Database.Database {
    if (!this.instance) {
      if (!fs.existsSync(config.paths.data)) {
        fs.mkdirSync(config.paths.data, { recursive: true });
      }

      const dbPath = path.join(config.paths.data, 'bollaclaw.db');
      this.instance = new Database(dbPath);

      // Enable WAL for better concurrent read performance
      this.instance.pragma('journal_mode = WAL');
      this.instance.pragma('foreign_keys = OFF');

      this.migrate();
      logger.info(`Database initialized at ${dbPath}`);
    }
    return this.instance;
  }

  private static migrate(): void {
    const db = this.instance!;

    db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'claude',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
    `);

    logger.info('Database migrations applied');
  }

  static close(): void {
    if (this.instance) {
      this.instance.close();
      this.instance = null;
    }
  }
}
