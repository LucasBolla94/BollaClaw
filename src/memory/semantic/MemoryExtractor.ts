import { MemoryType } from './SemanticMemoryStore';
import { logger } from '../../utils/logger';

// ============================================================
// MemoryExtractor — Intelligent Memory Extraction
// ============================================================
// Analyzes conversations to extract memorable information
// WITHOUT using the LLM (zero token cost). Uses pattern
// matching and heuristics to identify facts, preferences,
// instructions, and topics from user messages.
// ============================================================

export interface ExtractedMemory {
  type: MemoryType;
  content: string;
  importance: number;
}

// Patterns that indicate preference/likes
const PREFERENCE_PATTERNS = [
  /(?:eu |)(gosto|prefiro|curto|adoro|amo)\s+(.+)/i,
  /(?:eu |)(não gosto|odeio|detesto|não curto)\s+(.+)/i,
  /(?:eu |)(prefiro|escolho)\s+(.+)\s+(?:ao invés|em vez)\s+(.+)/i,
  /(?:i |)(like|love|prefer|enjoy|hate|dislike)\s+(.+)/i,
  /meu? (?:favorit[oa]|preferid[oa])\s+(?:é|são)\s+(.+)/i,
  /my (?:favorite|preferred)\s+(?:is|are)\s+(.+)/i,
];

// Patterns that indicate facts about the user
const FACT_PATTERNS = [
  /(?:eu |)(sou|trabalho|moro|tenho|faço|estudo)\s+(.+)/i,
  /(?:i |)(am|work|live|have|do|study)\s+(.+)/i,
  /meu? (?:nome|email|telefone|empresa|cargo)\s+(?:é|são)\s+(.+)/i,
  /(?:my |)(name|email|phone|company|job|role)\s+(?:is|are)\s+(.+)/i,
  /(?:eu |)(?:nasci|moro|trabalho) (?:em|no|na)\s+(.+)/i,
  /tenho (\d+) anos/i,
  /(?:i'm|i am) (\d+) years old/i,
];

// Patterns that indicate standing instructions
const INSTRUCTION_PATTERNS = [
  /sempre\s+(.+)/i,
  /nunca\s+(.+)/i,
  /(?:a partir de agora|de agora em diante)\s+(.+)/i,
  /(?:from now on|always|never)\s+(.+)/i,
  /(?:lembr[ae]|lembra|anota|guarda)\s+(?:que|isso:?)\s+(.+)/i,
  /(?:remember|note)\s+(?:that|this:?)\s+(.+)/i,
  /quando (?:eu |)(pedir|falar|mencionar)\s+(.+)/i,
];

// Patterns that suggest technical/project topics
const TOPIC_PATTERNS = [
  /(?:estou |)(trabalhando|desenvolvendo|criando|construindo)\s+(.+)/i,
  /(?:i'm |)(working on|developing|building|creating)\s+(.+)/i,
  /(?:meu |my )(?:projeto|project|app|site|sistema|system)\s+(.+)/i,
  /(?:vou |)(usar|implementar|integrar|migrar)\s+(.+)/i,
];

export class MemoryExtractor {
  // ── Extract memories from a user message ─────────────────

  extract(userMessage: string): ExtractedMemory[] {
    const memories: ExtractedMemory[] = [];
    const msg = userMessage.trim();

    // Skip very short messages
    if (msg.length < 10) return memories;

    // Check preference patterns
    for (const pattern of PREFERENCE_PATTERNS) {
      const match = msg.match(pattern);
      if (match) {
        memories.push({
          type: 'preference',
          content: this.cleanExtract(msg, match),
          importance: 65,
        });
        break; // One preference per message
      }
    }

    // Check fact patterns
    for (const pattern of FACT_PATTERNS) {
      const match = msg.match(pattern);
      if (match) {
        memories.push({
          type: 'fact',
          content: this.cleanExtract(msg, match),
          importance: 75,
        });
        break;
      }
    }

    // Check instruction patterns
    for (const pattern of INSTRUCTION_PATTERNS) {
      const match = msg.match(pattern);
      if (match) {
        memories.push({
          type: 'instruction',
          content: this.cleanExtract(msg, match),
          importance: 85,
        });
        break;
      }
    }

    // Check topic patterns
    for (const pattern of TOPIC_PATTERNS) {
      const match = msg.match(pattern);
      if (match) {
        memories.push({
          type: 'topic',
          content: this.cleanExtract(msg, match),
          importance: 55,
        });
        break;
      }
    }

    return memories;
  }

  // ── Generate conversation summary ─────────────────────────
  // Summarizes without LLM — extracts key points heuristically

  summarize(messages: Array<{ role: string; content: string }>): string {
    const userMessages = messages
      .filter(m => m.role === 'user')
      .map(m => m.content);

    const assistantMessages = messages
      .filter(m => m.role === 'assistant')
      .map(m => m.content);

    // Extract topics from user messages
    const topics = new Set<string>();
    for (const msg of userMessages) {
      const words = msg.split(/\s+/).filter(w => w.length > 5);
      for (const word of words.slice(0, 5)) {
        topics.add(word.toLowerCase());
      }
    }

    // Build summary
    const parts: string[] = [];

    if (userMessages.length > 0) {
      parts.push(`Conversa com ${messages.length} mensagens.`);
    }

    if (topics.size > 0) {
      const topicList = Array.from(topics).slice(0, 10).join(', ');
      parts.push(`Tópicos: ${topicList}.`);
    }

    // Include first and last user messages as context anchors
    if (userMessages.length > 0) {
      const first = userMessages[0].substring(0, 100);
      parts.push(`Início: "${first}"`);

      if (userMessages.length > 1) {
        const last = userMessages[userMessages.length - 1].substring(0, 100);
        parts.push(`Fim: "${last}"`);
      }
    }

    return parts.join(' ');
  }

  // ── Decide if a query needs memory search ────────────────
  // Returns true only when the message might benefit from
  // long-term memory (saves tokens by not searching always)

  shouldSearch(userMessage: string): boolean {
    const msg = userMessage.toLowerCase().trim();

    // Explicit memory triggers
    if (msg.includes('lembra') || msg.includes('remember')) return true;
    if (msg.includes('da última vez') || msg.includes('last time')) return true;
    if (msg.includes('como eu') || msg.includes('como a gente')) return true;
    if (msg.includes('meu projeto') || msg.includes('my project')) return true;
    if (msg.includes('você sabe') || msg.includes('you know')) return true;
    if (msg.includes('a gente conversou') || msg.includes('we talked')) return true;
    if (msg.includes('eu te disse') || msg.includes('i told you')) return true;
    if (msg.includes('aquele') || msg.includes('aquela')) return true;
    if (msg.includes('o que eu') || msg.includes('what i')) return true;

    // Questions about context that might require memory
    if (msg.startsWith('qual') || msg.startsWith('what') ||
        msg.startsWith('como') || msg.startsWith('how') ||
        msg.startsWith('onde') || msg.startsWith('where')) {
      // Only if the question seems personal/contextual
      if (msg.includes('meu') || msg.includes('minha') ||
          msg.includes('my') || msg.includes('our') ||
          msg.includes('nosso') || msg.includes('nossa')) {
        return true;
      }
    }

    // Long messages with context references
    if (msg.length > 200 && (msg.includes('contexto') || msg.includes('context'))) {
      return true;
    }

    return false;
  }

  // ── Private helpers ──────────────────────────────────────

  private cleanExtract(fullMessage: string, match: RegExpMatchArray): string {
    // Use the full message if it's short enough, otherwise use the match
    if (fullMessage.length <= 200) return fullMessage;
    return match[0].substring(0, 200);
  }
}
