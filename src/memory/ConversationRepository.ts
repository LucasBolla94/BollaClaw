import { v4 as uuidv4 } from 'uuid';
import { DatabaseSingleton } from './Database';

export interface Conversation {
  id: string;
  user_id: string;
  provider: string;
  created_at: string;
  updated_at: string;
}

export class ConversationRepository {
  private db = DatabaseSingleton.getInstance();

  findOrCreateByUserId(userId: string, provider: string): Conversation {
    const existing = this.db
      .prepare('SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1')
      .get(userId) as Conversation | undefined;

    if (existing) {
      this.db
        .prepare("UPDATE conversations SET updated_at = datetime('now'), provider = ? WHERE id = ?")
        .run(provider, existing.id);
      return { ...existing, provider, updated_at: new Date().toISOString() };
    }

    const id = uuidv4();
    this.db
      .prepare(
        "INSERT INTO conversations (id, user_id, provider) VALUES (?, ?, ?)"
      )
      .run(id, userId, provider);

    return this.db
      .prepare('SELECT * FROM conversations WHERE id = ?')
      .get(id) as Conversation;
  }

  findById(id: string): Conversation | undefined {
    return this.db
      .prepare('SELECT * FROM conversations WHERE id = ?')
      .get(id) as Conversation | undefined;
  }

  listRecent(limit = 20): Conversation[] {
    return this.db
      .prepare('SELECT * FROM conversations ORDER BY updated_at DESC LIMIT ?')
      .all(limit) as Conversation[];
  }
}
