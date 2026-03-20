import { ConversationRepository } from './ConversationRepository';
import { MessageRepository, StoredMessage } from './MessageRepository';
import { SemanticMemoryStore, SearchResult as SQLiteSearchResult } from './semantic/SemanticMemoryStore';
import { PgMemoryStore, SearchResult as PgSearchResult } from './pg/PgMemoryStore';
import { MemoryExtractor } from './semantic/MemoryExtractor';
import { ContextManager, ContextBuildResult } from './ContextManager';
import { BackgroundCompactor } from './BackgroundCompactor';
import { ILlmProvider, Message } from '../providers/ILlmProvider';
import { config } from '../utils/config';
import { logger } from '../utils/logger';

// ============================================================
// MemoryManager v2 — Unified Memory System
// ============================================================
// Architecture:
//   1. SQLite: conversation storage (messages, conversations)
//   2. PostgreSQL + pgvector: long-term memory + compacted context
//   3. ContextManager: token-aware context window (50k tokens)
//   4. BackgroundCompactor: async compaction pipeline
//
// Flow:
//   Message in → save to SQLite → build context (up to 50k tokens)
//   → if overflow: background compaction → pgvector
//   → agent uses memory_search tool for old context
//
// Fallback: if PostgreSQL is not available, uses SQLite-based
// SemanticMemoryStore (original v1 system).
// ============================================================

export class MemoryManager {
  private conversationRepo = new ConversationRepository();
  private messageRepo = new MessageRepository();
  private contextManager: ContextManager;
  private compactor: BackgroundCompactor | null = null;
  private extractor = new MemoryExtractor();

  // Memory stores (one will be active)
  private pgStore: PgMemoryStore | null = null;
  private sqliteStore: SemanticMemoryStore;

  private usePg = false;
  private semanticReady = false;

  constructor() {
    this.sqliteStore = new SemanticMemoryStore();
    this.contextManager = new ContextManager({
      maxContextTokens: 50000,
      systemReserve: 4000,
    });
  }

  // ── Initialization ─────────────────────────────────────────

  /**
   * Initialize the memory system.
   * Tries PostgreSQL first, falls back to SQLite semantic store.
   */
  async initialize(summaryProvider?: ILlmProvider): Promise<void> {
    // Try PostgreSQL + pgvector
    const pgConnectionString = process.env.PG_CONNECTION_STRING;
    if (pgConnectionString) {
      try {
        this.pgStore = new PgMemoryStore();
        const pgOk = await this.pgStore.initialize(pgConnectionString);

        if (pgOk) {
          this.usePg = true;
          this.semanticReady = true;
          this.compactor = new BackgroundCompactor(this.pgStore, summaryProvider);
          logger.info('[MemoryManager] v2 initialized: PostgreSQL + pgvector + ContextManager(50k)');
          return;
        }
      } catch (err) {
        logger.warn(`[MemoryManager] PostgreSQL init failed: ${err}`);
      }
    }

    // Fallback to SQLite semantic store
    try {
      const sqliteOk = await this.sqliteStore.initialize();
      if (sqliteOk) {
        this.semanticReady = true;
        logger.info('[MemoryManager] v1 fallback: SQLite semantic store + ContextManager(50k)');
      }
    } catch (err) {
      logger.warn(`[MemoryManager] SQLite semantic init failed: ${err}`);
    }
  }

  /** Legacy alias for initialize() */
  async initSemantic(): Promise<void> {
    await this.initialize();
  }

  // ── Context Preparation (v2: token-aware) ──────────────────

  /**
   * Save user message and build context within token budget.
   * Triggers background compaction if needed.
   */
  prepareContext(userId: string, userMessage: string, provider: string): {
    conversationId: string;
    messages: Message[];
    contextNote: string | null;
  } {
    // Get or create conversation
    const conversation = this.conversationRepo.findOrCreateByUserId(userId, provider);

    // Save user message to SQLite
    this.messageRepo.save(conversation.id, 'user', userMessage);

    // Build context within 50k token budget
    const contextResult = this.contextManager.buildContext(conversation.id);

    // If context was trimmed → queue background compaction
    if (contextResult.wasTrimmed && contextResult.compactionQueue.length > 0) {
      this.triggerCompaction(userId, conversation.id, contextResult.compactionQueue);
    }

    return {
      conversationId: conversation.id,
      messages: contextResult.messages,
      contextNote: contextResult.contextNote,
    };
  }

  // ── Semantic Context (long-term memories) ──────────────────

  /**
   * Search long-term memories for context enrichment.
   * Uses pgvector if available, falls back to SQLite.
   */
  async getSemanticContext(userId: string, userMessage: string): Promise<string> {
    if (!this.semanticReady) return '';

    // Smart gate: only search when it makes sense
    if (!this.extractor.shouldSearch(userMessage)) {
      return '';
    }

    try {
      let results: Array<{ type: string; content: string; score: number }>;

      if (this.usePg && this.pgStore) {
        // pgvector search
        const pgResults = await this.pgStore.search({
          query: userMessage,
          userId,
          topK: 5,
          minScore: 0.35,
          maxTokens: 2000,
        });
        results = pgResults.map(r => ({
          type: r.entry.type,
          content: r.entry.content,
          score: r.combinedScore,
        }));
      } else {
        // SQLite semantic search
        const sqliteResults = await this.sqliteStore.search({
          query: userMessage,
          userId,
          topK: 5,
          minScore: 0.35,
          maxTokens: 2000,
        });
        results = sqliteResults.map(r => ({
          type: r.entry.type,
          content: r.entry.content,
          score: r.combinedScore,
        }));
      }

      if (results.length === 0) return '';

      // Format memories as compact context block
      let context = '\n## Memórias relevantes\n';
      context += 'Informações que você lembra sobre conversas anteriores:\n';

      for (const r of results) {
        const typeLabel = this.typeLabel(r.type);
        context += `- [${typeLabel}] ${r.content}\n`;
      }

      context += '\nUse essas memórias naturalmente se forem relevantes para a conversa atual.\n';

      logger.info(`[MemoryManager] Injected ${results.length} memories (${context.length} chars)`);
      return context;
    } catch (err) {
      logger.warn(`[MemoryManager] Semantic search failed: ${err}`);
      return '';
    }
  }

  // ── Memory Extraction (zero-cost heuristics) ───────────────

  async learnFromMessage(userId: string, userMessage: string): Promise<void> {
    if (!this.semanticReady) return;

    try {
      const memories = this.extractor.extract(userMessage);

      for (const mem of memories) {
        if (this.usePg && this.pgStore) {
          await this.pgStore.store({
            userId,
            type: mem.type,
            content: mem.content,
            importance: mem.importance,
          });
        } else {
          await this.sqliteStore.store({
            userId,
            type: mem.type,
            content: mem.content,
            importance: mem.importance,
          });
        }
      }
    } catch (err) {
      logger.warn(`[MemoryManager] Memory extraction failed: ${err}`);
    }
  }

  // ── Explicit Memory Storage ────────────────────────────────

  async storeExplicitMemory(
    userId: string,
    content: string,
    type: 'fact' | 'preference' | 'instruction' = 'fact',
    importance = 80
  ): Promise<string | null> {
    if (!this.semanticReady) return null;

    if (this.usePg && this.pgStore) {
      return this.pgStore.store({ userId, type, content, importance });
    }
    return this.sqliteStore.store({ userId, type, content, importance });
  }

  // ── Persistence ────────────────────────────────────────────

  saveAssistantReply(conversationId: string, content: string): void {
    this.messageRepo.save(conversationId, 'assistant', content);
  }

  saveToolObservation(conversationId: string, content: string): void {
    this.messageRepo.save(conversationId, 'tool', content);
  }

  // ── Legacy methods (backwards compatibility) ───────────────

  getContext(conversationId: string): Message[] {
    const result = this.contextManager.buildContext(conversationId);
    return result.messages;
  }

  async archiveConversation(conversationId: string, userId: string): Promise<void> {
    if (!this.semanticReady) return;

    const recent = this.messageRepo.getRecent(conversationId, 50);
    if (recent.length < 10) return;

    const messages = recent.map(m => ({ role: m.role, content: m.content }));
    const summary = this.extractor.summarize(messages);

    const today = new Date().toISOString().split('T')[0];

    if (this.usePg && this.pgStore) {
      await this.pgStore.storeDailySummary({
        userId,
        period: today,
        summary,
        messageCount: recent.length,
      });
    } else {
      await this.sqliteStore.storeSummary({
        userId,
        period: today,
        summary,
        messageCount: recent.length,
      });
    }

    logger.info(`[MemoryManager] Archived conversation summary for ${userId} (${recent.length} messages)`);
  }

  // ── Stats & Monitoring ─────────────────────────────────────

  getMemoryStats(userId: string): Record<string, unknown> | null {
    if (!this.semanticReady) return null;

    if (this.usePg && this.pgStore) {
      // Return a promise — caller should await
      return { backend: 'postgresql', note: 'Use getMemoryStatsAsync for full stats' };
    }

    return this.sqliteStore.getStats(userId);
  }

  async getMemoryStatsAsync(userId: string): Promise<Record<string, unknown> | null> {
    if (!this.semanticReady) return null;

    if (this.usePg && this.pgStore) {
      const stats = await this.pgStore.getStats(userId);
      return {
        backend: 'postgresql',
        ...stats,
        compactorProcessing: this.compactor?.isProcessing() ?? false,
        compactorQueue: this.compactor?.getProcessingCount() ?? 0,
      };
    }

    return this.sqliteStore.getStats(userId);
  }

  getContextStats(conversationId: string) {
    return this.contextManager.getConversationTokenCount(conversationId);
  }

  pruneMemories(userId: string): number | Promise<number> {
    if (!this.semanticReady) return 0;

    if (this.usePg && this.pgStore) {
      return this.pgStore.prune(userId);
    }
    return this.sqliteStore.prune(userId);
  }

  // ── Accessors ──────────────────────────────────────────────

  getConversationRepo(): ConversationRepository {
    return this.conversationRepo;
  }

  getPgStore(): PgMemoryStore | null {
    return this.pgStore;
  }

  getSemanticStore(): SemanticMemoryStore | null {
    return this.semanticReady && !this.usePg ? this.sqliteStore : null;
  }

  isUsingPg(): boolean {
    return this.usePg;
  }

  getContextManager(): ContextManager {
    return this.contextManager;
  }

  // ── Private helpers ────────────────────────────────────────

  private triggerCompaction(userId: string, conversationId: string, messages: StoredMessage[]): void {
    if (!this.compactor) return;

    logger.info(`[MemoryManager] Triggering background compaction: ${messages.length} messages`);
    this.compactor.queueCompaction(userId, conversationId, messages);
  }

  private typeLabel(type: string): string {
    const labels: Record<string, string> = {
      fact: 'Fato',
      preference: 'Preferência',
      summary: 'Resumo',
      topic: 'Tópico',
      instruction: 'Instrução',
      context: 'Contexto',
    };
    return labels[type] || type;
  }
}
