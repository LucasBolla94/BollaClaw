import { MessageRepository, StoredMessage } from './MessageRepository';
import { Message } from '../providers/ILlmProvider';
import { logger } from '../utils/logger';

// ============================================================
// ContextManager — Token-Aware Context Window Builder
// ============================================================
// Strategy:
//   1. Send up to MAX_CONTEXT_TOKENS of real conversation history
//   2. Walk from newest to oldest, accumulate tokens
//   3. If conversation exceeds budget → only include what fits
//   4. Older messages are returned separately for background
//      compaction (embedding + summary → pgvector)
//   5. Agent can use memory_search tool to access old context
//
// NO constant summarization. NO aggressive compaction.
// The conversation flows naturally until it hits 50k tokens,
// then background processing kicks in silently.
// ============================================================

export interface ContextBuildResult {
  /** Messages to send to the LLM (within token budget) */
  messages: Message[];
  /** Token count of included messages */
  tokenCount: number;
  /** Number of messages excluded from context (older than budget) */
  excludedCount: number;
  /** Messages that need compaction (oldest, fell out of context) */
  compactionQueue: StoredMessage[];
  /** Whether the context was trimmed (some messages excluded) */
  wasTrimmed: boolean;
  /** If trimmed, a context note to prepend */
  contextNote: string | null;
}

// Token estimation: Portuguese text averages ~3.5 chars per token
// We use a conservative estimate to avoid overflowing context
const CHARS_PER_TOKEN = 3.5;

export class ContextManager {
  // ── Configuration ──────────────────────────────────────────
  // Total token budget for conversation messages
  // (excludes system prompt, semantic memories, tool descriptions)
  private readonly MAX_CONTEXT_TOKENS: number;

  // Reserve tokens for system prompt + semantic context + tools
  private readonly SYSTEM_RESERVE: number;

  // Effective budget = MAX_CONTEXT_TOKENS - SYSTEM_RESERVE
  private readonly MESSAGE_BUDGET: number;

  // Maximum messages to fetch from DB (safety limit)
  private readonly MAX_MESSAGES_FETCH = 2000;

  private messageRepo: MessageRepository;

  constructor(options?: {
    maxContextTokens?: number;
    systemReserve?: number;
  }) {
    this.MAX_CONTEXT_TOKENS = options?.maxContextTokens ?? 50000;
    this.SYSTEM_RESERVE = options?.systemReserve ?? 4000;
    this.MESSAGE_BUDGET = this.MAX_CONTEXT_TOKENS - this.SYSTEM_RESERVE;
    this.messageRepo = new MessageRepository();
  }

  // ── Build context within token budget ──────────────────────

  buildContext(conversationId: string): ContextBuildResult {
    // Fetch recent messages (newest first, then reversed)
    const allMessages = this.messageRepo.getRecent(conversationId, this.MAX_MESSAGES_FETCH);

    if (allMessages.length === 0) {
      return {
        messages: [],
        tokenCount: 0,
        excludedCount: 0,
        compactionQueue: [],
        wasTrimmed: false,
        contextNote: null,
      };
    }

    // Walk from newest to oldest, accumulate tokens
    let totalTokens = 0;
    let cutoffIndex = 0; // Everything from cutoffIndex onwards is included

    for (let i = allMessages.length - 1; i >= 0; i--) {
      const msgTokens = this.estimateTokens(allMessages[i].content);
      // Add overhead for role token + message framing (~4 tokens)
      const totalMsgTokens = msgTokens + 4;

      if (totalTokens + totalMsgTokens > this.MESSAGE_BUDGET) {
        cutoffIndex = i + 1;
        break;
      }
      totalTokens += totalMsgTokens;
    }

    // Split: included (recent) vs excluded (old)
    const includedMessages = allMessages.slice(cutoffIndex);
    const excludedMessages = allMessages.slice(0, cutoffIndex);

    // Convert to LLM format
    const messages: Message[] = includedMessages.map(m => ({
      role: m.role as Message['role'],
      content: m.content,
    }));

    // Build context note if messages were excluded
    let contextNote: string | null = null;
    if (excludedMessages.length > 0) {
      const oldestIncluded = includedMessages[0]?.created_at ?? '';
      contextNote = `[Contexto anterior: ${excludedMessages.length} mensagens anteriores foram arquivadas. ` +
        `O contexto visível começa em ${this.formatTimestamp(oldestIncluded)}. ` +
        `Use a ferramenta memory_search para buscar informações de conversas anteriores se necessário.]`;
    }

    logger.info(
      `[ContextManager] Built context: ${includedMessages.length} messages (${totalTokens} tokens), ` +
      `${excludedMessages.length} excluded${excludedMessages.length > 0 ? ' → queued for compaction' : ''}`
    );

    return {
      messages,
      tokenCount: totalTokens,
      excludedCount: excludedMessages.length,
      compactionQueue: excludedMessages,
      wasTrimmed: excludedMessages.length > 0,
      contextNote,
    };
  }

  // ── Token estimation ───────────────────────────────────────

  estimateTokens(text: string): number {
    // Hybrid estimation:
    // 1. Character-based: text.length / CHARS_PER_TOKEN
    // 2. Word-based: words * 1.3 (average tokens per word)
    // Use the higher estimate for safety

    const charEstimate = Math.ceil(text.length / CHARS_PER_TOKEN);
    const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
    const wordEstimate = Math.ceil(wordCount * 1.3);

    return Math.max(charEstimate, wordEstimate);
  }

  // ── Get conversation token count (for monitoring) ──────────

  getConversationTokenCount(conversationId: string): {
    totalMessages: number;
    totalTokens: number;
    withinBudget: boolean;
    budgetUsedPercent: number;
  } {
    const allMessages = this.messageRepo.getRecent(conversationId, this.MAX_MESSAGES_FETCH);
    let totalTokens = 0;

    for (const msg of allMessages) {
      totalTokens += this.estimateTokens(msg.content) + 4;
    }

    return {
      totalMessages: allMessages.length,
      totalTokens,
      withinBudget: totalTokens <= this.MESSAGE_BUDGET,
      budgetUsedPercent: Math.round((totalTokens / this.MESSAGE_BUDGET) * 100),
    };
  }

  // ── Config getters ─────────────────────────────────────────

  getMaxContextTokens(): number {
    return this.MAX_CONTEXT_TOKENS;
  }

  getMessageBudget(): number {
    return this.MESSAGE_BUDGET;
  }

  // ── Private helpers ────────────────────────────────────────

  private formatTimestamp(isoStr: string): string {
    try {
      const date = new Date(isoStr);
      return date.toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoStr;
    }
  }
}
