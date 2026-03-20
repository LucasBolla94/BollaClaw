'use client';

import { useCallback } from 'react';
import { usePolling } from '@/hooks/usePolling';
import { apiClient } from '@/lib/api';

export function SoulPage() {
  const fetchSoul = useCallback(() => apiClient.soul(), []);
  const { data, loading } = usePolling(fetchSoul, 30000);
  const soul = data?.soul;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white tracking-tight">Soul</h2>
        <p className="text-sm text-slate-500 mt-1">Configuração de personalidade e identidade do agente</p>
      </div>

      <div className="glass-card p-6">
        {loading ? (
          <div className="text-slate-600 text-sm">Carregando configuração...</div>
        ) : !soul || Object.keys(soul).length === 0 ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-4 opacity-40">🧠</div>
            <p className="text-slate-500 text-sm">Nenhuma configuração de soul encontrada</p>
            <p className="text-slate-700 text-xs mt-1">Configure o arquivo soul.yaml para personalizar o agente</p>
          </div>
        ) : (
          <pre className="font-mono text-xs text-slate-400 whitespace-pre-wrap leading-relaxed overflow-x-auto">
            {JSON.stringify(soul, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
