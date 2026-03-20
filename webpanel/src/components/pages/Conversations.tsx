'use client';

import { useState, useCallback, useEffect } from 'react';
import { apiClient, type Conversation, type Message } from '@/lib/api';
import { timeAgo } from '@/lib/utils';

export function ConversationsPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadConversations = useCallback(async () => {
    try {
      const res = await apiClient.conversations();
      setConversations(res.conversations || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  const selectConversation = async (id: string) => {
    setSelected(id);
    try {
      const res = await apiClient.messages(id);
      setMessages(res.messages || []);
    } catch {
      setMessages([]);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white tracking-tight">Conversas</h2>
        <p className="text-sm text-slate-500 mt-1">Histórico de conversas do Telegram</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 h-[calc(100vh-180px)]">
        {/* Conversation list */}
        <div className="glass-card overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-slate-600 text-sm">Carregando...</div>
          ) : conversations.length === 0 ? (
            <div className="p-8 text-center">
              <div className="text-3xl mb-3 opacity-50">💬</div>
              <p className="text-slate-600 text-sm">Nenhuma conversa encontrada</p>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.04]">
              {conversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => selectConversation(conv.id)}
                  className={`w-full text-left p-4 transition-all hover:bg-white/[0.03] ${
                    selected === conv.id ? 'bg-brand-500/5 border-l-2 border-brand-500' : 'border-l-2 border-transparent'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-slate-300 truncate">
                      {conv.username || `User ${conv.userId}`}
                    </span>
                    <span className="text-[10px] text-slate-600 flex-shrink-0 ml-2">
                      {timeAgo(conv.lastMessageAt)}
                    </span>
                  </div>
                  <div className="text-xs text-slate-600 truncate">{conv.lastMessage}</div>
                  <div className="text-[10px] text-slate-700 mt-1">{conv.messageCount} mensagens</div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Messages */}
        <div className="glass-card overflow-y-auto p-4">
          {!selected ? (
            <div className="h-full flex items-center justify-center text-slate-600 text-sm">
              Selecione uma conversa
            </div>
          ) : messages.length === 0 ? (
            <div className="h-full flex items-center justify-center text-slate-600 text-sm">
              Nenhuma mensagem
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`max-w-[85%] ${msg.role === 'user' ? 'ml-auto' : ''}`}
                >
                  <div
                    className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-brand-500/15 text-brand-100 rounded-br-md'
                        : 'bg-white/[0.04] text-slate-300 rounded-bl-md'
                    }`}
                  >
                    {msg.content}
                  </div>
                  <div className={`text-[10px] text-slate-700 mt-1 ${msg.role === 'user' ? 'text-right' : ''}`}>
                    {new Date(msg.timestamp).toLocaleString('pt-BR')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
