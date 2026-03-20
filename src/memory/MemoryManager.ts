import { ConversationRepository } from './ConversationRepository';
import { MessageRepository, StoredMessage } from './MessageRepository';
import { SemanticMemoryStore, SearchResult } from './semantic/SemanticMemoryStore';
import { MemoryExtractor } from './semantic/MemoryExtractor';
import { Message } from '../providers/ILlmProvider';
import { config } from '../utils/config';
import { logger } from '../utils/logger';

// ============================================================
// MemoryManager — Unified Short + Long Term Memory
// ============================================================
// Short-term: SQLite conversation history (recent N messages)
// Long-term:  Semantic memory with embeddings (surgical search)
//
// Token optimization strategy:
// 1. Always include recent N messages (short-term)
// 2. Only search long-term memory when heuristics detect need
// 3. Inject relevant memories as a compact "context block"
// 4. Budget: max 2000 tokens for injected memories
// 5. Auto-extract facts/preferences from every message (free)
// 6. Auto-summarize old conversations periodically
// ============================================================

export class MemoryManager {
  private conversationRepo = new ConversationRepository();
  private messageRepo = new MessageRepository();
  private semanticStore: SemanticMemoryStore;
  private extractor = new MemoryExtractor();
  private semanticReady = false;

  constructor() {
    this.semanticStore = new SemanticMemoryStore();
  }

  /** Initialize semantic memory (async, non-blocking) */
  async initSemantic(): Promise<void> {
    this.semanticReady = await this.semanticStore.initialize();
    if (this.semanticReady) {
      logger.info('[MemoryManager] Semantic memory enabled (local ONNX)');
    }
  }

  /** Get or create conversation for user, save user message, return context window */
  prepareContext(userId: string, userMessage: string, provider: string): {
    conversationId: string;
    messages: Message[];
  } {
    const conversation = this.conversationRepo.findOrCreateByUserId(userId, provider);
    this.messageRepo.save(conversation.id, 'user', userMessage);

    const recent = this.messageRepo.getRecent(conversation.id, config.agent.memoryWindowSize);
    const messages: Message[] = recent.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    return { conversationId: conversation.id, messages };
  }

  /**
   * Enrich context with relevant long-term memories.
   * Only searches when heuristics detect the message might benefit.
   * Returns additional context string to prepend to system prompt.
   */
  async getSemanticContext(userId: string, userMessage: string): Promise<string> {
    if (!this.semanticReady) return '';

    // Smart gate: only search when it makes sense
    if (!this.extractor.shouldSearch(userMessage)) {
      return '';
    }

    try {
      const results = await this.semanticStore.search({
        query: userMessage,
        userId,
        topK: 5,
        minScore: 0.35,
        maxTokens: 2000,
      });

      if (results.length === 0) return '';

      // Format memories as a compact context block
      let context = '\n## Memórias relevantes\n';
      context += 'Informações que você lembra sobre conversas anteriores:\n';

      for (const r of results) {
        const typeLabel = this.typeLabel(r.entry.type);
        context += `- [${typeLabel}] ${r.entry.content}\n`;
      }

      context += '\nUse essas memórias naturalmente se forem relevantes para a conversa atual.\n';

      logger.info(`[MemoryManager] Injected ${results.length} memories (${context.length} chars)`);
      return context;
    } catch (err) {
      logger.warn(`[MemoryManager] Semantic search failed: ${err}`);
      return '';
    }
  }

  /**
   * Extract and store memorable information from user message.
   * Runs after every message (zero token cost — pure heuristics).
   */
  async learnFromMessage(userId: string, userMessage: string): Promise<void> {
    if (!this.semanticReady) return;

    try {
      const memories = this.extractor.extract(userMessage);

      for (const mem of memories) {
        await this.semanticStore.store({
          userId,
          type: mem.type,
          content: mem.content,
          importance: mem.importance,
        });
      }
    } catch (err) {
      logger.warn(`[MemoryManager] Memory extraction failed: ${err}`);
    }
  }

  /**
   * Store an explicit memory (e.g., from "lembra que..." commands).
   */
  async storeExplicitMemory(
    userId: string,
    content: string,
    type: 'fact' | 'preference' | 'instruction' = 'fact',
    importance = 80
  ): Promise<string | null> {
    if (!this.semanticReady) return null;
    return this.semanticStore.store({ userId, type, content, importance });
  }

  /**
   * Summarize and archive old conversations.
   * Call this periodically (e.g., every 50 messages or daily).
   */
  async archiveConversation(
    conversationId: string,
    userId: string
  ): Promise<void> {
    if (!this.semanticReady) return;

    const recent = this.messageRepo.getRecent(conversationId, 50);
    if (recent.length < 10) return; // Not enough to summarize

    const messages = recent.map(m => ({ role: m.role, content: m.content }));
    const summary = this.extractor.summarize(messages);

    const today = new Date().toISOString().split('T')[0];
    await this.semanticStore.storeSummary({
      userId,
      period: today,
      summary,
      messageCount: recent.length,
    });

    logger.info(`[MemoryManager] Archived conversation summary for ${userId} (${recent.length} messages)`);
  }

  /** Save assistant response */
  saveAssistantReply(conversationId: string, content: string): void {
    this.messageRepo.save(conversationId, 'assistant', content);
  }

  /** Save tool observation */
  saveToolObservation(conversationId: string, content: string): void {
    this.messageRepo.save(conversationId, 'tool', content);
  }

  /** Get recent messages for context (without saving new ones) */
  getContext(conversationId: string): Message[] {
    const recent = this.messageRepo.getRecent(conversationId, config.agent.memoryWindowSize);
    return recent.map((m) => ({ role: m.role, content: m.content }));
  }

  /** Get memory stats for a user */
  getMemoryStats(userId: string) {
    if (!this.semanticReady) return null;
    return this.semanticStore.getStats(userId);
  }

  /** Prune old memories */
  pruneMemories(userId: string): number {
    if (!this.semanticReady) return 0;
    return this.semanticStore.prune(userId);
  }

  getConversationRepo(): ConversationRepository {
    return this.conversationRepo;
  }

  getSemanticStore(): SemanticMemoryStore | null {
    return this.semanticReady ? this.semanticStore : null;
  }

  // ── Private helpers ──────────────────────────────────────

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
