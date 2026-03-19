import { ConversationRepository } from './ConversationRepository';
import { MessageRepository, StoredMessage } from './MessageRepository';
import { Message } from '../providers/ILlmProvider';
import { config } from '../utils/config';

export class MemoryManager {
  private conversationRepo = new ConversationRepository();
  private messageRepo = new MessageRepository();

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

  getConversationRepo(): ConversationRepository {
    return this.conversationRepo;
  }
}
