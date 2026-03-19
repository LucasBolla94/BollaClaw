import { v4 as uuidv4 } from 'uuid';
import { DatabaseSingleton } from './Database';

export interface StoredMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  created_at: string;
}

export class MessageRepository {
  private db = DatabaseSingleton.getInstance();

  save(conversationId: string, role: StoredMessage['role'], content: string): StoredMessage {
    const id = uuidv4();
    // Sanitize null bytes that crash SQLite
    const sanitized = content.replace(/\u0000/g, '');

    this.db
      .prepare(
        'INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)'
      )
      .run(id, conversationId, role, sanitized);

    return this.db
      .prepare('SELECT * FROM messages WHERE id = ?')
      .get(id) as StoredMessage;
  }

  getRecent(conversationId: string, limit: number): StoredMessage[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM (
            SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?
          ) ORDER BY created_at ASC`
        )
        .all(conversationId, limit) as StoredMessage[]
    );
  }

  countByConversation(conversationId: string): number {
    const result = this.db
      .prepare('SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = ?')
      .get(conversationId) as { cnt: number };
    return result.cnt;
  }
}
