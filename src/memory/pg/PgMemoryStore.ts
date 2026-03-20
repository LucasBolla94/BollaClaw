import * as crypto from 'crypto';
import { PgClient } from './PgClient';
import { EmbeddingService } from '../semantic/EmbeddingService';
import { logger } from '../../utils/logger';

// ============================================================
// PgMemoryStore — Long-Term Memory with pgvector
// ============================================================
// Replaces SQLite-based SemanticMemoryStore with PostgreSQL
// + pgvector for proper HNSW vector indexing.
//
// Features:
// - HNSW approximate nearest neighbor search (fast)
// - Trigram keyword search via pg_trgm
// - Hybrid scoring: vector similarity + keyword match
// - Token-aware budget management
// - SHA-256 deduplication
// - Context chunk storage for compacted conversations
// ============================================================

export type MemoryType = 'fact' | 'preference' | 'summary' | 'topic' | 'instruction' | 'context';

export interface MemoryEntry {
  id: string;
  userId: string;
  type: MemoryType;
  content: string;
  contentHash: string;
  tokenEstimate: number;
  importance: number;
  accessCount: number;
  lastAccessed: string | null;
  createdAt: string;
  expiresAt: string | null;
  metadata: Record<string, unknown>;
}

export interface SearchResult {
  entry: MemoryEntry;
  score: number;
  keywordScore: number;
  combinedScore: number;
}

export interface ContextChunk {
  id: string;
  userId: string;
  conversationId: string;
  chunkIndex: number;
  content: string;
  summary: string;
  messageCount: number;
  tokenCount: number;
  timeStart: string;
  timeEnd: string;
  createdAt: string;
}

export interface ChunkSearchResult {
  chunk: ContextChunk;
  score: number;
}

export class PgMemoryStore {
  private pg: PgClient;
  private embedder: EmbeddingService;
  private ready = false;

  constructor() {
    this.pg = PgClient.getInstance();
    this.embedder = new EmbeddingService();
  }

  async initialize(connectionString: string): Promise<boolean> {
    try {
      const pgOk = await this.pg.connect(connectionString);
      if (!pgOk) return false;

      const embedOk = await this.embedder.ensureReady();
      if (!embedOk) {
        logger.warn('[PgMemoryStore] Embedder not available');
        return false;
      }

      this.ready = true;
      logger.info('[PgMemoryStore] Ready (PostgreSQL + pgvector + ONNX embeddings)');
      return true;
    } catch (err) {
      logger.warn(`[PgMemoryStore] Initialization failed: ${err}`);
      return false;
    }
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

    try {
      // Check if exists
      const existing = await this.pg.queryOne<{ id: string }>(
        'SELECT id FROM memories WHERE content_hash = $1',
        [contentHash]
      );

      if (existing) {
        // Update importance if higher
        await this.pg.query(
          'UPDATE memories SET importance = GREATEST(importance, $1), last_accessed = NOW() WHERE id = $2',
          [importance, existing.id]
        );
        return existing.id;
      }

      // Generate embedding
      const embedding = await this.embedder.embedSingle(content);
      const embeddingStr = `[${embedding.join(',')}]`;
      const tokenEstimate = Math.ceil(content.length / 3.5);

      const result = await this.pg.queryOne<{ id: string }>(
        `INSERT INTO memories (user_id, type, content, embedding, content_hash, token_estimate, importance, expires_at, metadata)
         VALUES ($1, $2, $3, $4::vector, $5, $6, $7, $8, $9)
         RETURNING id`,
        [userId, type, content, embeddingStr, contentHash, tokenEstimate, importance, expiresAt, JSON.stringify(metadata)]
      );

      logger.info(`[PgMemoryStore] Stored ${type}: "${content.substring(0, 60)}..." (importance: ${importance})`);
      return result?.id ?? null;
    } catch (err) {
      logger.warn(`[PgMemoryStore] Store failed: ${err}`);
      return null;
    }
  }

  // ── Semantic Search (memories) ─────────────────────────────

  async search(params: {
    query: string;
    userId: string;
    topK?: number;
    minScore?: number;
    types?: MemoryType[];
    maxTokens?: number;
  }): Promise<SearchResult[]> {
    if (!this.ready) return [];

    const { query, userId, topK = 5, minScore = 0.35, types, maxTokens = 2000 } = params;

    try {
      const queryEmbedding = await this.embedder.embedSingle(query);
      const embeddingStr = `[${queryEmbedding.join(',')}]`;

      // Use pgvector's <=> operator for cosine distance (1 - similarity)
      // Combined with pg_trgm for keyword matching
      let sql = `
        SELECT
          id, user_id, type, content, content_hash, token_estimate,
          importance, access_count, last_accessed, created_at, expires_at, metadata,
          1 - (embedding <=> $1::vector) AS vector_score,
          COALESCE(similarity(content, $2), 0) AS keyword_score
        FROM memories
        WHERE user_id = $3
          AND (expires_at IS NULL OR expires_at > NOW())
      `;
      const sqlParams: unknown[] = [embeddingStr, query, userId];
      let paramIdx = 4;

      if (types && types.length > 0) {
        sql += ` AND type = ANY($${paramIdx})`;
        sqlParams.push(types);
        paramIdx++;
      }

      sql += `
        ORDER BY (0.7 * (1 - (embedding <=> $1::vector)) + 0.3 * COALESCE(similarity(content, $2), 0)) DESC
        LIMIT $${paramIdx}
      `;
      sqlParams.push(topK * 2); // Fetch extra to filter by token budget

      const rows = await this.pg.queryAll<{
        id: string;
        user_id: string;
        type: string;
        content: string;
        content_hash: string;
        token_estimate: number;
        importance: number;
        access_count: number;
        last_accessed: string | null;
        created_at: string;
        expires_at: string | null;
        metadata: string;
        vector_score: number;
        keyword_score: number;
      }>(sql, sqlParams);

      // Filter by score and token budget
      let tokenBudget = maxTokens;
      const results: SearchResult[] = [];

      for (const row of rows) {
        if (results.length >= topK) break;
        if (tokenBudget <= 0) break;

        const combinedScore = 0.7 * row.vector_score + 0.3 * row.keyword_score;
        if (combinedScore < minScore) continue;
        if (row.token_estimate > tokenBudget) continue;

        results.push({
          entry: {
            id: row.id,
            userId: row.user_id,
            type: row.type as MemoryType,
            content: row.content,
            contentHash: row.content_hash,
            tokenEstimate: row.token_estimate,
            importance: row.importance,
            accessCount: row.access_count,
            lastAccessed: row.last_accessed,
            createdAt: row.created_at,
            expiresAt: row.expires_at,
            metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
          },
          score: row.vector_score,
          keywordScore: row.keyword_score,
          combinedScore,
        });

        tokenBudget -= row.token_estimate;

        // Update access stats (fire-and-forget)
        this.pg.query(
          'UPDATE memories SET access_count = access_count + 1, last_accessed = NOW() WHERE id = $1',
          [row.id]
        ).catch(() => {});
      }

      return results;
    } catch (err) {
      logger.warn(`[PgMemoryStore] Search failed: ${err}`);
      return [];
    }
  }

  // ── Store context chunk (compacted conversation) ───────────

  async storeContextChunk(params: {
    userId: string;
    conversationId: string;
    chunkIndex: number;
    content: string;
    summary: string;
    messageCount: number;
    tokenCount: number;
    timeStart: string;
    timeEnd: string;
  }): Promise<string | null> {
    if (!this.ready) return null;

    try {
      const [contentEmbed, summaryEmbed] = await Promise.all([
        this.embedder.embedSingle(params.content),
        this.embedder.embedSingle(params.summary),
      ]);

      const result = await this.pg.queryOne<{ id: string }>(
        `INSERT INTO context_chunks
         (user_id, conversation_id, chunk_index, content, summary, embedding, summary_embedding,
          message_count, token_count, time_start, time_end)
         VALUES ($1, $2, $3, $4, $5, $6::vector, $7::vector, $8, $9, $10, $11)
         RETURNING id`,
        [
          params.userId, params.conversationId, params.chunkIndex,
          params.content, params.summary,
          `[${contentEmbed.join(',')}]`, `[${summaryEmbed.join(',')}]`,
          params.messageCount, params.tokenCount,
          params.timeStart, params.timeEnd,
        ]
      );

      logger.info(`[PgMemoryStore] Stored context chunk #${params.chunkIndex} (${params.messageCount} msgs, ${params.tokenCount} tokens)`);
      return result?.id ?? null;
    } catch (err) {
      logger.warn(`[PgMemoryStore] Store chunk failed: ${err}`);
      return null;
    }
  }

  // ── Search context chunks ──────────────────────────────────

  async searchContextChunks(params: {
    query: string;
    userId: string;
    conversationId?: string;
    topK?: number;
    maxTokens?: number;
  }): Promise<ChunkSearchResult[]> {
    if (!this.ready) return [];

    const { query, userId, conversationId, topK = 5, maxTokens = 4000 } = params;

    try {
      const queryEmbedding = await this.embedder.embedSingle(query);
      const embeddingStr = `[${queryEmbedding.join(',')}]`;

      let sql = `
        SELECT
          id, user_id, conversation_id, chunk_index, content, summary,
          message_count, token_count, time_start, time_end, created_at,
          GREATEST(
            1 - (embedding <=> $1::vector),
            1 - (summary_embedding <=> $1::vector)
          ) AS score
        FROM context_chunks
        WHERE user_id = $2
      `;
      const sqlParams: unknown[] = [embeddingStr, userId];
      let paramIdx = 3;

      if (conversationId) {
        sql += ` AND conversation_id = $${paramIdx}`;
        sqlParams.push(conversationId);
        paramIdx++;
      }

      sql += ` ORDER BY score DESC LIMIT $${paramIdx}`;
      sqlParams.push(topK * 2);

      const rows = await this.pg.queryAll<{
        id: string;
        user_id: string;
        conversation_id: string;
        chunk_index: number;
        content: string;
        summary: string;
        message_count: number;
        token_count: number;
        time_start: string;
        time_end: string;
        created_at: string;
        score: number;
      }>(sql, sqlParams);

      let tokenBudget = maxTokens;
      const results: ChunkSearchResult[] = [];

      for (const row of rows) {
        if (results.length >= topK) break;
        if (tokenBudget <= 0) break;
        if (row.token_count > tokenBudget) continue;

        results.push({
          chunk: {
            id: row.id,
            userId: row.user_id,
            conversationId: row.conversation_id,
            chunkIndex: row.chunk_index,
            content: row.content,
            summary: row.summary,
            messageCount: row.message_count,
            tokenCount: row.token_count,
            timeStart: row.time_start,
            timeEnd: row.time_end,
            createdAt: row.created_at,
          },
          score: row.score,
        });

        tokenBudget -= row.token_count;
      }

      return results;
    } catch (err) {
      logger.warn(`[PgMemoryStore] Search chunks failed: ${err}`);
      return [];
    }
  }

  // ── Store daily summary ────────────────────────────────────

  async storeDailySummary(params: {
    userId: string;
    period: string;
    summary: string;
    messageCount: number;
  }): Promise<void> {
    if (!this.ready) return;

    try {
      const embedding = await this.embedder.embedSingle(params.summary);
      const embeddingStr = `[${embedding.join(',')}]`;

      await this.pg.query(
        `INSERT INTO daily_summaries (user_id, period, summary, embedding, message_count)
         VALUES ($1, $2, $3, $4::vector, $5)
         ON CONFLICT (user_id, period)
         DO UPDATE SET summary = EXCLUDED.summary, embedding = EXCLUDED.embedding,
                       message_count = EXCLUDED.message_count`,
        [params.userId, params.period, params.summary, embeddingStr, params.messageCount]
      );
    } catch (err) {
      logger.warn(`[PgMemoryStore] Store daily summary failed: ${err}`);
    }
  }

  // ── Get last compacted timestamp for a conversation ────────

  async getLastCompactedTime(userId: string, conversationId: string): Promise<string | null> {
    try {
      const result = await this.pg.queryOne<{ time_end: string }>(
        'SELECT time_end FROM context_chunks WHERE user_id = $1 AND conversation_id = $2 ORDER BY time_end DESC LIMIT 1',
        [userId, conversationId]
      );
      return result?.time_end ?? null;
    } catch {
      return null;
    }
  }

  // ── Stats ──────────────────────────────────────────────────

  async getStats(userId: string): Promise<{
    totalMemories: number;
    totalChunks: number;
    totalTokensStored: number;
    byType: Record<string, number>;
  }> {
    try {
      const [memCount, chunkCount, tokenSum, byType] = await Promise.all([
        this.pg.queryOne<{ cnt: string }>('SELECT COUNT(*) as cnt FROM memories WHERE user_id = $1', [userId]),
        this.pg.queryOne<{ cnt: string }>('SELECT COUNT(*) as cnt FROM context_chunks WHERE user_id = $1', [userId]),
        this.pg.queryOne<{ total: string }>('SELECT COALESCE(SUM(token_estimate), 0) as total FROM memories WHERE user_id = $1', [userId]),
        this.pg.queryAll<{ type: string; cnt: string }>('SELECT type, COUNT(*) as cnt FROM memories WHERE user_id = $1 GROUP BY type', [userId]),
      ]);

      return {
        totalMemories: parseInt(memCount?.cnt ?? '0'),
        totalChunks: parseInt(chunkCount?.cnt ?? '0'),
        totalTokensStored: parseInt(tokenSum?.total ?? '0'),
        byType: Object.fromEntries(byType.map(r => [r.type, parseInt(r.cnt)])),
      };
    } catch {
      return { totalMemories: 0, totalChunks: 0, totalTokensStored: 0, byType: {} };
    }
  }

  // ── Pruning ────────────────────────────────────────────────

  async prune(userId: string, maxMemories = 1000): Promise<number> {
    try {
      // Delete expired
      const expired = await this.pg.query(
        'DELETE FROM memories WHERE user_id = $1 AND expires_at IS NOT NULL AND expires_at < NOW()',
        [userId]
      );

      let pruned = expired.rowCount ?? 0;

      // If over limit, delete lowest importance
      const countResult = await this.pg.queryOne<{ cnt: string }>(
        'SELECT COUNT(*) as cnt FROM memories WHERE user_id = $1',
        [userId]
      );
      const total = parseInt(countResult?.cnt ?? '0');

      if (total > maxMemories) {
        const toDelete = total - maxMemories;
        const result = await this.pg.query(
          `DELETE FROM memories WHERE id IN (
            SELECT id FROM memories WHERE user_id = $1
            ORDER BY importance ASC, access_count ASC, created_at ASC
            LIMIT $2
          )`,
          [userId, toDelete]
        );
        pruned += result.rowCount ?? 0;
      }

      if (pruned > 0) {
        logger.info(`[PgMemoryStore] Pruned ${pruned} memories for ${userId}`);
      }

      return pruned;
    } catch (err) {
      logger.warn(`[PgMemoryStore] Prune failed: ${err}`);
      return 0;
    }
  }

  // ── Close ──────────────────────────────────────────────────

  async close(): Promise<void> {
    await this.pg.close();
    this.ready = false;
  }
}
