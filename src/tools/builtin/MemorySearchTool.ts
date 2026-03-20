import { BaseTool, ToolResult } from '../BaseTool';
import { PgMemoryStore } from '../../memory/pg/PgMemoryStore';
import { logger } from '../../utils/logger';

// ============================================================
// MemorySearchTool — Agent Tool for Searching Long-Term Memory
// ============================================================
// Allows the agent to search its own memory when:
// - Conversation context was compacted (older messages)
// - It needs to recall facts, preferences, or past topics
// - User asks about something from a previous conversation
//
// Searches BOTH:
// - Long-term memories (facts, preferences, instructions)
// - Compacted conversation chunks (with summaries)
//
// Returns formatted results the agent can use in its response.
// ============================================================

export class MemorySearchTool extends BaseTool {
  readonly name = 'memory_search';
  readonly description =
    'Busca na memória de longo prazo. Use quando precisar lembrar de conversas anteriores, ' +
    'fatos sobre o usuário, preferências, instruções, ou contexto de conversas que saíram da janela atual. ' +
    'Parâmetros: query (texto para buscar), type (opcional: fact|preference|instruction|topic|context|conversation)';

  readonly parameters = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Texto ou pergunta para buscar na memória (ex: "qual o projeto do usuário", "preferências de linguagem")',
      },
      type: {
        type: 'string',
        enum: ['fact', 'preference', 'instruction', 'topic', 'context', 'conversation', 'all'],
        description: 'Tipo de memória para filtrar. "conversation" busca em chunks de conversa compactados. "all" busca em tudo.',
      },
      max_results: {
        type: 'number',
        description: 'Número máximo de resultados (padrão: 5, max: 10)',
      },
    },
    required: ['query'],
  };

  private pgStore: PgMemoryStore;
  private currentUserId: string | null = null;
  private currentConversationId: string | null = null;

  constructor(pgStore: PgMemoryStore) {
    super();
    this.pgStore = pgStore;
  }

  /** Set context for the current request (called before each agent loop) */
  setContext(userId: string, conversationId: string): void {
    this.currentUserId = userId;
    this.currentConversationId = conversationId;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const query = String(args.query || '');
    const type = String(args.type || 'all');
    const maxResults = Math.min(Number(args.max_results) || 5, 10);

    if (!query) {
      return { output: 'Erro: query é obrigatório' };
    }

    if (!this.currentUserId) {
      return { output: 'Erro: contexto do usuário não definido' };
    }

    if (!this.pgStore.isReady()) {
      return { output: 'Sistema de memória não disponível no momento.' };
    }

    try {
      const parts: string[] = [];

      // Search memories (facts, preferences, etc.)
      if (type !== 'conversation') {
        const memoryTypes = type === 'all' ? undefined : [type as any];
        const memories = await this.pgStore.search({
          query,
          userId: this.currentUserId,
          topK: maxResults,
          minScore: 0.30,
          types: memoryTypes,
          maxTokens: 3000,
        });

        if (memories.length > 0) {
          parts.push('## Memórias encontradas:');
          for (const r of memories) {
            const typeLabel = this.typeLabel(r.entry.type);
            const score = Math.round(r.combinedScore * 100);
            parts.push(`- [${typeLabel}] (${score}% relevância) ${r.entry.content}`);
          }
        }
      }

      // Search conversation chunks (compacted context)
      if (type === 'conversation' || type === 'all') {
        const chunks = await this.pgStore.searchContextChunks({
          query,
          userId: this.currentUserId,
          conversationId: this.currentConversationId ?? undefined,
          topK: maxResults,
          maxTokens: 4000,
        });

        if (chunks.length > 0) {
          parts.push('## Contexto de conversas anteriores:');
          for (const r of chunks) {
            const score = Math.round(r.score * 100);
            const timeRange = `${this.formatDate(r.chunk.timeStart)} → ${this.formatDate(r.chunk.timeEnd)}`;
            parts.push(`--- Chunk (${score}% relevância, ${timeRange}, ${r.chunk.messageCount} msgs) ---`);
            parts.push(`Resumo: ${r.chunk.summary}`);
            // Include content snippet if it fits
            if (r.chunk.content.length <= 1500) {
              parts.push(`Conteúdo: ${r.chunk.content}`);
            } else {
              parts.push(`Conteúdo (trecho): ${r.chunk.content.substring(0, 1500)}...`);
            }
          }
        }
      }

      if (parts.length === 0) {
        return { output: `Nenhuma memória relevante encontrada para: "${query}"` };
      }

      const output = parts.join('\n');
      logger.info(`[MemorySearch] Found ${parts.length} results for query: "${query.substring(0, 50)}"`);
      return { output };
    } catch (err) {
      logger.warn(`[MemorySearch] Search failed: ${err}`);
      return { output: `Erro ao buscar na memória: ${err}`, error: String(err) };
    }
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

  private formatDate(isoStr: string): string {
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
