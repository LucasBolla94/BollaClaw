import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { EmbeddingService } from './EmbeddingService';
import { logger } from '../../utils/logger';
import { config } from '../../utils/config';

// ============================================================
// SemanticMemoryStore — Long-Term Memory with Vector Search
// ============================================================
// Architecture inspired by OpenClaw's memsearch but optimized:
// - SQLite + custom cosine similarity (zero external deps)
// - Local ONNX embeddings (no API costs)
// - SHA-256 deduplication (never re-embed same content)
// - Tiered memory: facts, summaries, preferences, topics
// - Token-aware: tracks estimated token cost per memory
// ============================================================

export type MemoryType =
  | 'fact'           // Learned facts about the owner
  | 'preference'     // Owner's preferences
  | 'summary'        // Conversation summaries
  | 'topic'          // Frequently discussed topics
  | 'instruction'    // Standing instructions from owner
  | 'context';       // Contextual memories (time-bound)

export interface MemoryEntry {
  id: string;
  userId: string;
  type: MemoryType;
  content: string;
  embedding: number[];
  contentHash: string;
  tokenEstimate: number;
  importance: number;       // 0-100 — how important this memory is
  accessCount: number;      // How often this memory was retrieved
  lastAccessed: string;
  createdAt: string;
  expiresAt: string | null; // null = permanent
  metadata: Record<string, unknown>;
}

export interface SearchResult {
  entry: MemoryEntry;
  score: number;            // Cosine similarity score
  keywordScore: number;     // BM25-like keyword score
  combinedScore: number;    // Hybrid fusion score
}

export class SemanticMemoryStore {
  private db: Database.Database;
  private embedder: EmbeddingService;
  private ready = false;

  constructor(dataDir?: string) {
    const dir = dataDir || config.paths.data;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const dbPath = path.join(dir, 'memory-semantic.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this.embedder = new EmbeddingService();
    this.migrate();
  }

  // ── Schema ───────────────────────────────────────────────

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'fact',
        content TEXT NOT NULL,
        embedding BLOB NOT NULL,
        content_hash TEXT NOT NULL UNIQUE,
        token_estimate INTEGER NOT NULL DEFAULT 0,
        importance INTEGER NOT NULL DEFAULT 50,
        access_count INTEGER NOT NULL DEFAULT 0,
        last_accessed TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT,
        metadata TEXT DEFAULT '{}'
      );

      CREATE INDEX IF NOT EXISTS idx_mem_user ON memories(user_id);
      CREATE INDEX IF NOT EXISTS idx_mem_type ON memories(type);
      CREATE INDEX IF NOT EXISTS idx_mem_hash ON memories(content_hash);
      CREATE INDEX IF NOT EXISTS idx_mem_importance ON memories(importance DESC);
      CREATE INDEX IF NOT EXISTS idx_mem_accessed ON memories(last_accessed DESC);

      CREATE TABLE IF NOT EXISTS memory_summaries (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        period TEXT NOT NULL,
        summary TEXT NOT NULL,
        embedding BLOB NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_summ_user ON memory_summaries(user_id, period);
    `);

    logger.info('[SemanticMemory] Schema initialized');
  }

  // ── Initialize embedder ──────────────────────────────────

  async initialize(): Promise<boolean> {
    this.ready = await this.embedder.ensureReady();
    if (this.ready) {
      logger.info('[SemanticMemory] Embedder ready (ONNX local)');
    } else {
      logger.warn('[SemanticMemory] Embedder not available — semantic search disabled');
    }
    return this.ready;
  }

  isReady(): boolean {
    return this.ready;
  }

  // ── Store memory ─────────────────────────────────────────

  async store(params: {
    userId: string;
    type: MemoryType;
    content: string;
    importance?: number;
    expiresAt?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<string | null> {
    if (!this.ready) return null;

    const { userId, type, content, importance = 50, expiresAt = null, metadata = {} } = params;

    // Deduplicate via SHA-256
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');
    const existing = this.db.prepare('SELECT id FROM memories WHERE content_hash = ?').get(contentHash) as { id: string } | undefined;
    if (existing) {
      // Update importance if higher
      this.db.prepare('UPDATE memories SET importance = MAX(importance, ?), last_accessed = datetime("now") WHERE id = ?')
        .run(importance, existing.id);
      return existing.id;
    }

    // Generate embedding
    const embedding = await this.embedder.embedSingle(content);
    const embeddingBlob = Buffer.from(new Float32Array(embedding).buffer);

    const id = crypto.randomUUID();
    const tokenEstimate = Math.ceil(content.length / 4); // Rough token estimate

    this.db.prepare(`
      INSERT INTO memories (id, user_id, type, content, embedding, content_hash, token_estimate, importance, expires_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, userId, type, content, embeddingBlob, contentHash,
      tokenEstimate, importance, expiresAt, JSON.stringify(metadata)
    );

    logger.info(`[SemanticMemory] Stored ${type}: "${content.substring(0, 60)}..." (importance: ${importance})`);
    return id;
  }

  // ── Semantic Search ──────────────────────────────────────

  async search(params: {
    query: string;
    userId: string;
    topK?: number;
    minScore?: number;
    types?: MemoryType[];
    maxTokens?: number;
  }): Promise<SearchResult[]> {
    if (!this.ready) return [];

    const { query, userId, topK = 5, minScore = 0.3, types, maxTokens = 2000 } = params;

    // Generate query embedding
    const queryEmbedding = await this.embedder.embedSingle(query);

    // Get all memories for this user (filtered by type if specified)
    let sql = 'SELECT * FROM memories WHERE user_id = ?';
    const sqlParams: unknown[] = [userId];

    if (types && types.length > 0) {
      sql += ` AND type IN (${types.map(() => '?').join(',')})`;
      sqlParams.push(...types);
    }

    // Exclude expired
    sql += ' AND (expires_at IS NULL OR expires_at > datetime("now"))';
    sql += ' ORDER BY importance DESC';

    const rows = this.db.prepare(sql).all(...sqlParams) as Array<{
      id: string;
      user_id: string;
      type: string;
      content: string;
      embedding: Buffer;
      content_hash: string;
      token_estimate: number;
      importance: number;
      access_count: number;
      last_accessed: string;
      created_at: string;
      expires_at: string | null;
      metadata: string;
    }>;

    // Score each memory
    const queryWords = new Set(query.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const results: SearchResult[] = [];

    for (const row of rows) {
      // Decode embedding from BLOB
      const storedEmbedding = Array.from(new Float32Array(
        row.embedding.buffer.slice(row.embedding.byteOffset, row.embedding.byteOffset + row.embedding.byteLength)
      ));

      // Cosine similarity
      const score = EmbeddingService.cosineSimilarity(queryEmbedding, storedEmbedding);

      // Keyword score (simple BM25-like)
      const contentWords = row.content.toLowerCase().split(/\s+/);
      let keywordHits = 0;
      for (const word of queryWords) {
        if (contentWords.some(cw => cw.includes(word))) keywordHits++;
      }
      const keywordScore = queryWords.size > 0 ? keywordHits / queryWords.size : 0;

      // Reciprocal Rank Fusion: combine semantic + keyword
      const combinedScore = 0.7 * score + 0.3 * keywordScore;

      if (combinedScore >= minScore) {
        results.push({
          entry: {
            id: row.id,
            userId: row.user_id,
            type: row.type as MemoryType,
            content: row.content,
            embedding: storedEmbedding,
            contentHash: row.content_hash,
            tokenEstimate: row.token_estimate,
            importance: row.importance,
            accessCount: row.access_count,
            lastAccessed: row.last_accessed,
            createdAt: row.created_at,
            expiresAt: row.expires_at,
            metadata: JSON.parse(row.metadata || '{}'),
          },
          score,
          keywordScore,
          combinedScore,
        });
      }
    }

    // Sort by combined score descending
    results.sort((a, b) => b.combinedScore - a.combinedScore);

    // Token budget: only return results that fit within maxTokens
    let tokenBudget = maxTokens;
    const finalResults: SearchResult[] = [];

    for (const result of results) {
      if (finalResults.length >= topK) break;
      if (tokenBudget <= 0) break;

      if (result.entry.tokenEstimate <= tokenBudget) {
        finalResults.push(result);
        tokenBudget -= result.entry.tokenEstimate;

        // Update access stats
        this.db.prepare(
          'UPDATE memories SET access_count = access_count + 1, last_accessed = datetime("now") WHERE id = ?'
        ).run(result.entry.id);
      }
    }

    return finalResults;
  }

  // ── Store conversation summary ────────────────────────────

  async storeSummary(params: {
    userId: string;
    period: string;      // e.g., "2026-03-20" or "2026-W12"
    summary: string;
    messageCount: number;
  }): Promise<void> {
    if (!this.ready) return;

    const { userId, period, summary, messageCount } = params;
    const embedding = await this.embedder.embedSingle(summary);
    const embeddingBlob = Buffer.from(new Float32Array(embedding).buffer);
    const id = crypto.randomUUID();

    // Upsert: replace if same period exists
    this.db.prepare('DELETE FROM memory_summaries WHERE user_id = ? AND period = ?')
      .run(userId, period);

    this.db.prepare(`
      INSERT INTO memory_summaries (id, user_id, period, summary, embedding, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, userId, period, summary, embeddingBlob, messageCount);
  }

  // ── Get stats ────────────────────────────────────────────

  getStats(userId: string): {
    totalMemories: number;
    byType: Record<string, number>;
    totalTokens: number;
    oldestMemory: string;
    newestMemory: string;
  } {
    const total = this.db.prepare('SELECT COUNT(*) as cnt FROM memories WHERE user_id = ?')
      .get(userId) as { cnt: number };

    const byType = this.db.prepare(
      'SELECT type, COUNT(*) as cnt FROM memories WHERE user_id = ? GROUP BY type'
    ).all(userId) as Array<{ type: string; cnt: number }>;

    const tokens = this.db.prepare(
      'SELECT SUM(token_estimate) as total FROM memories WHERE user_id = ?'
    ).get(userId) as { total: number | null };

    const oldest = this.db.prepare(
      'SELECT MIN(created_at) as d FROM memories WHERE user_id = ?'
    ).get(userId) as { d: string | null };

    const newest = this.db.prepare(
      'SELECT MAX(created_at) as d FROM memories WHERE user_id = ?'
    ).get(userId) as { d: string | null };

    return {
      totalMemories: total.cnt,
      byType: Object.fromEntries(byType.map(r => [r.type, r.cnt])),
      totalTokens: tokens.total || 0,
      oldestMemory: oldest.d || '',
      newestMemory: newest.d || '',
    };
  }

  // ── Cleanup: prune expired and low-importance memories ───

  prune(userId: string, maxMemories = 500): number {
    // Delete expired
    const expired = this.db.prepare(
      'DELETE FROM memories WHERE user_id = ? AND expires_at IS NOT NULL AND expires_at < datetime("now")'
    ).run(userId);

    // If still over limit, delete lowest importance first
    const total = (this.db.prepare('SELECT COUNT(*) as cnt FROM memories WHERE user_id = ?')
      .get(userId) as { cnt: number }).cnt;

    let pruned = expired.changes;

    if (total > maxMemories) {
      const toDelete = total - maxMemories;
      const rows = this.db.prepare(
        'SELECT id FROM memories WHERE user_id = ? ORDER BY importance ASC, access_count ASC, created_at ASC LIMIT ?'
      ).all(userId, toDelete) as Array<{ id: string }>;

      for (const row of rows) {
        this.db.prepare('DELETE FROM memories WHERE id = ?').run(row.id);
        pruned++;
      }
    }

    if (pruned > 0) {
      logger.info(`[SemanticMemory] Pruned ${pruned} memories for ${userId}`);
    }

    return pruned;
  }

  // ── Delete specific memory ────────────────────────────────

  delete(memoryId: string): boolean {
    const result = this.db.prepare('DELETE FROM memories WHERE id = ?').run(memoryId);
    return result.changes > 0;
  }

  // ── Close ─────────────────────────────────────────────────

  close(): void {
    this.db.close();
  }
}
