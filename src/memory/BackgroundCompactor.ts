import { StoredMessage } from './MessageRepository';
import { PgMemoryStore } from './pg/PgMemoryStore';
import { ILlmProvider, Message } from '../providers/ILlmProvider';
import { logger } from '../utils/logger';

// ============================================================
// BackgroundCompactor — Async Compaction Pipeline
// ============================================================
// Runs in background (non-blocking) when conversation context
// exceeds the 50k token window. Takes old messages, creates:
//
// 1. Content embedding → pgvector (searchable raw content)
// 2. LLM summary → pgvector (compressed representation)
// 3. Summary embedding → pgvector (searchable summary)
//
// The agent can later use memory_search to find relevant
// chunks from compacted conversations.
//
// Design principles:
// - Fire-and-forget (never blocks the response)
// - Idempotent (safe to re-run on same messages)
// - Chunked processing (groups of ~20 messages per chunk)
// - Uses cheap/fast router LLM for summaries
// - Graceful degradation (heuristic summary if LLM fails)
// ============================================================

const CHUNK_SIZE = 20;           // Messages per chunk
const MAX_CONTENT_LENGTH = 8000; // Max chars per chunk content (for embedding)
const SUMMARY_TIMEOUT_MS = 30000; // 30s timeout for LLM summary

export class BackgroundCompactor {
  private pgStore: PgMemoryStore;
  private summaryProvider: ILlmProvider | null;
  private processing = new Set<string>(); // Track in-flight compactions

  constructor(pgStore: PgMemoryStore, summaryProvider?: ILlmProvider) {
    this.pgStore = pgStore;
    this.summaryProvider = summaryProvider ?? null;
  }

  /**
   * Queue messages for background compaction.
   * Non-blocking — returns immediately.
   */
  queueCompaction(
    userId: string,
    conversationId: string,
    messages: StoredMessage[]
  ): void {
    if (messages.length === 0) return;
    if (!this.pgStore.isReady()) return;

    // Deduplicate: don't compact the same conversation twice at the same time
    const key = `${userId}:${conversationId}`;
    if (this.processing.has(key)) {
      logger.info(`[BackgroundCompactor] Already processing ${key}, skipping`);
      return;
    }

    // Fire and forget
    this.processing.add(key);
    this.processCompaction(userId, conversationId, messages)
      .catch(err => {
        logger.warn(`[BackgroundCompactor] Compaction failed for ${key}: ${err}`);
      })
      .finally(() => {
        this.processing.delete(key);
      });
  }

  /**
   * Process compaction for a set of messages.
   * Groups into chunks and processes each one.
   */
  private async processCompaction(
    userId: string,
    conversationId: string,
    messages: StoredMessage[]
  ): Promise<void> {
    // Check what's already been compacted (avoid re-processing)
    const lastCompacted = await this.pgStore.getLastCompactedTime(userId, conversationId);

    // Filter out already-compacted messages
    let toProcess = messages;
    if (lastCompacted) {
      toProcess = messages.filter(m => m.created_at > lastCompacted);
    }

    if (toProcess.length === 0) {
      logger.info(`[BackgroundCompactor] Nothing new to compact for ${userId}`);
      return;
    }

    // Sort by time ascending
    toProcess.sort((a, b) => a.created_at.localeCompare(b.created_at));

    // Split into chunks
    const chunks = this.splitIntoChunks(toProcess, CHUNK_SIZE);

    logger.info(
      `[BackgroundCompactor] Compacting ${toProcess.length} messages into ${chunks.length} chunks for ${userId}`
    );

    // Process each chunk
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      try {
        await this.processChunk(userId, conversationId, chunk, i);
      } catch (err) {
        logger.warn(`[BackgroundCompactor] Chunk ${i} failed: ${err}`);
        // Continue with next chunk
      }
    }

    // Also generate a daily summary
    await this.generateDailySummary(userId, conversationId, toProcess);

    logger.info(`[BackgroundCompactor] Compaction complete for ${userId}: ${chunks.length} chunks stored`);
  }

  /**
   * Process a single chunk: content + summary → pgvector
   */
  private async processChunk(
    userId: string,
    conversationId: string,
    messages: StoredMessage[],
    chunkIndex: number
  ): Promise<void> {
    // Build chunk content (concatenated messages, truncated if needed)
    const content = this.buildChunkContent(messages);
    const tokenCount = Math.ceil(content.length / 3.5);

    // Generate summary (LLM or heuristic)
    const summary = await this.generateSummary(messages);

    // Time range
    const timeStart = messages[0].created_at;
    const timeEnd = messages[messages.length - 1].created_at;

    // Store in pgvector (content embedding + summary embedding)
    await this.pgStore.storeContextChunk({
      userId,
      conversationId,
      chunkIndex,
      content,
      summary,
      messageCount: messages.length,
      tokenCount,
      timeStart,
      timeEnd,
    });
  }

  /**
   * Build chunk content string from messages.
   * Format: concise, preserving speaker and content.
   */
  private buildChunkContent(messages: StoredMessage[]): string {
    const parts: string[] = [];
    let totalLen = 0;

    for (const msg of messages) {
      const role = msg.role === 'user' ? 'U' : msg.role === 'assistant' ? 'A' : 'S';
      // Truncate very long individual messages
      const content = msg.content.length > 2000
        ? msg.content.substring(0, 2000) + '...'
        : msg.content;

      const line = `[${role}] ${content}`;

      if (totalLen + line.length > MAX_CONTENT_LENGTH) {
        parts.push(line.substring(0, MAX_CONTENT_LENGTH - totalLen));
        break;
      }

      parts.push(line);
      totalLen += line.length;
    }

    return parts.join('\n');
  }

  /**
   * Generate a summary for a chunk of messages.
   * Tries LLM first (router provider), falls back to heuristic.
   */
  private async generateSummary(messages: StoredMessage[]): Promise<string> {
    // Try LLM summary first
    if (this.summaryProvider) {
      try {
        return await this.generateLlmSummary(messages);
      } catch (err) {
        logger.warn(`[BackgroundCompactor] LLM summary failed, using heuristic: ${err}`);
      }
    }

    // Heuristic fallback
    return this.generateHeuristicSummary(messages);
  }

  /**
   * Generate summary using the cheap/fast router LLM.
   */
  private async generateLlmSummary(messages: StoredMessage[]): Promise<string> {
    // Build a compact transcript
    const transcript = messages.map(m => {
      const role = m.role === 'user' ? 'Usuário' : m.role === 'assistant' ? 'Assistente' : 'Sistema';
      const content = m.content.length > 500 ? m.content.substring(0, 500) + '...' : m.content;
      return `${role}: ${content}`;
    }).join('\n');

    // Keep transcript under 3000 chars to stay cheap
    const truncatedTranscript = transcript.length > 3000
      ? transcript.substring(0, 3000) + '\n...'
      : transcript;

    const prompt: Message[] = [
      {
        role: 'system',
        content: `Você é um sumarizador de conversas. Gere um resumo conciso (2-4 frases) em português.
Inclua: tópicos discutidos, decisões tomadas, informações importantes, e pendências.
Seja direto e informativo. Não inclua saudações ou formalidades.`,
      },
      {
        role: 'user',
        content: `Resuma esta conversa:\n\n${truncatedTranscript}`,
      },
    ];

    const response = await Promise.race([
      this.summaryProvider!.complete(prompt),
      this.timeout<never>(SUMMARY_TIMEOUT_MS),
    ]);

    if (response.content && response.content.length > 10) {
      return response.content;
    }

    // Fallback if LLM returned empty
    return this.generateHeuristicSummary(messages);
  }

  /**
   * Heuristic summary (zero cost, no LLM).
   */
  private generateHeuristicSummary(messages: StoredMessage[]): string {
    const userMsgs = messages.filter(m => m.role === 'user');
    const topics = new Set<string>();

    for (const msg of userMsgs) {
      // Extract long words as topic indicators
      const words = msg.content.split(/\s+/).filter(w => w.length > 5 && !w.startsWith('http'));
      for (const word of words.slice(0, 3)) {
        topics.add(word.toLowerCase());
      }
    }

    const parts: string[] = [];
    parts.push(`Conversa com ${messages.length} mensagens.`);

    if (topics.size > 0) {
      parts.push(`Tópicos: ${Array.from(topics).slice(0, 8).join(', ')}.`);
    }

    if (userMsgs.length > 0) {
      const first = userMsgs[0].content.substring(0, 100);
      parts.push(`Início: "${first}"`);

      if (userMsgs.length > 1) {
        const last = userMsgs[userMsgs.length - 1].content.substring(0, 100);
        parts.push(`Último: "${last}"`);
      }
    }

    // Include timestamp range
    if (messages.length > 0) {
      parts.push(`Período: ${messages[0].created_at} a ${messages[messages.length - 1].created_at}`);
    }

    return parts.join(' ');
  }

  /**
   * Generate daily summary from compacted messages.
   */
  private async generateDailySummary(
    userId: string,
    _conversationId: string,
    messages: StoredMessage[]
  ): Promise<void> {
    // Group by date
    const byDate = new Map<string, StoredMessage[]>();
    for (const msg of messages) {
      const date = msg.created_at.split('T')[0] || msg.created_at.split(' ')[0];
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date)!.push(msg);
    }

    for (const [date, dateMsgs] of byDate) {
      const summary = await this.generateSummary(dateMsgs);
      await this.pgStore.storeDailySummary({
        userId,
        period: date,
        summary,
        messageCount: dateMsgs.length,
      });
    }
  }

  // ── Helpers ────────────────────────────────────────────────

  private splitIntoChunks(messages: StoredMessage[], size: number): StoredMessage[][] {
    const chunks: StoredMessage[][] = [];
    for (let i = 0; i < messages.length; i += size) {
      chunks.push(messages.slice(i, i + size));
    }
    return chunks;
  }

  private timeout<T>(ms: number): Promise<T> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    );
  }

  isProcessing(): boolean {
    return this.processing.size > 0;
  }

  getProcessingCount(): number {
    return this.processing.size;
  }
}
