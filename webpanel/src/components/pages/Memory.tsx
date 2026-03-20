'use client';

import { useCallback } from 'react';
import { usePolling } from '@/hooks/usePolling';
import { apiClient } from '@/lib/api';

export function MemoryPage() {
  const fetchMemory = useCallback(() => apiClient.memory(), []);
  const { data, loading } = usePolling(fetchMemory, 30000);
  const memory = data?.memory;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white tracking-tight">Memória</h2>
        <p className="text-sm text-slate-500 mt-1">Estado da memória do agente</p>
      </div>

      <div className="glass-card p-6">
        {loading ? (
          <div className="text-slate-600 text-sm">Carregando memória...</div>
        ) : !memory || Object.keys(memory).length === 0 ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-4 opacity-40">💾</div>
            <p className="text-slate-500 text-sm">Memória vazia</p>
            <p className="text-slate-700 text-xs mt-1">O agente armazena contexto das conversas aqui</p>
          </div>
        ) : (
          <pre className="font-mono text-xs text-slate-400 whitespace-pre-wrap leading-relaxed overflow-x-auto">
            {JSON.stringify(memory, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
