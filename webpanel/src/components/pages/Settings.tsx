'use client';

import { useState, useCallback } from 'react';
import { usePolling } from '@/hooks/usePolling';
import { apiClient, type SystemStatus } from '@/lib/api';

interface Props {
  onChangePassword: () => void;
}

export function SettingsPage({ onChangePassword }: Props) {
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const fetchStatus = useCallback(() => apiClient.status(), []);
  const { data: status } = usePolling<SystemStatus>(fetchStatus, 10000);
  const cfg = status?.config;

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const runAction = async (action: string, fn: () => Promise<unknown>) => {
    setActionLoading(action);
    try {
      await fn();
      showToast(`${action} concluído com sucesso`);
    } catch (err) {
      showToast(`Erro: ${err instanceof Error ? err.message : 'falha'}`);
    } finally {
      setActionLoading(null);
    }
  };

  const actions = [
    { id: 'skills', label: 'Recarregar Skills', desc: 'Atualiza a lista de skills do agente', fn: apiClient.reloadSkills },
    { id: 'providers', label: 'Recarregar Providers', desc: 'Reconecta aos providers de LLM', fn: apiClient.reloadProviders },
    { id: 'identity', label: 'Recarregar Identity', desc: 'Recarrega a configuração soul.yaml', fn: apiClient.reloadIdentity },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white tracking-tight">Configurações</h2>
        <p className="text-sm text-slate-500 mt-1">Gerenciamento do sistema</p>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed top-6 right-6 z-50 px-4 py-2.5 glass-card text-sm text-slate-300 animate-slide-in">
          {toast}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Config */}
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
            Configuração Atual
          </h3>
          <div className="space-y-2.5">
            <div className="flex justify-between">
              <span className="text-xs text-slate-600">STT Provider</span>
              <span className="text-xs text-slate-300">{cfg?.stt ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-slate-600">Max Iterações</span>
              <span className="text-xs text-slate-300 font-mono">{cfg?.maxIter ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-slate-600">Janela de Memória</span>
              <span className="text-xs text-slate-300 font-mono">{cfg?.memWindow ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-slate-600">Porta Admin</span>
              <span className="text-xs text-slate-300 font-mono">{cfg?.adminPort ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-slate-600">Telegram Allowed</span>
              <span className="text-xs text-slate-300 font-mono">{cfg?.telegramAllowed?.join(', ') ?? '—'}</span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-4">
          <div className="glass-card p-5">
            <h3 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
              <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              Ações Rápidas
            </h3>
            <div className="space-y-2">
              {actions.map((action) => (
                <button
                  key={action.id}
                  onClick={() => runAction(action.label, action.fn)}
                  disabled={actionLoading !== null}
                  className="w-full flex items-center justify-between p-3 rounded-lg border border-white/[0.04] hover:border-white/[0.08] hover:bg-white/[0.02] transition-all disabled:opacity-50 group"
                >
                  <div className="text-left">
                    <div className="text-xs font-medium text-slate-300 group-hover:text-white transition-colors">{action.label}</div>
                    <div className="text-[10px] text-slate-600">{action.desc}</div>
                  </div>
                  {actionLoading === action.id ? (
                    <svg className="w-4 h-4 text-brand-400 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 text-slate-600 group-hover:text-slate-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M9 5l7 7-7 7" /></svg>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Security */}
          <div className="glass-card p-5">
            <h3 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
              <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
              Segurança
            </h3>
            <button
              onClick={onChangePassword}
              className="w-full flex items-center justify-between p-3 rounded-lg border border-white/[0.04] hover:border-brand-500/20 hover:bg-brand-500/5 transition-all group"
            >
              <div className="text-left">
                <div className="text-xs font-medium text-slate-300 group-hover:text-brand-300 transition-colors">Alterar Senha</div>
                <div className="text-[10px] text-slate-600">Modifica a senha de acesso ao painel</div>
              </div>
              <svg className="w-4 h-4 text-slate-600 group-hover:text-brand-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M9 5l7 7-7 7" /></svg>
            </button>

            <button
              onClick={() => runAction('Restart', apiClient.restart)}
              disabled={actionLoading !== null}
              className="w-full mt-2 flex items-center justify-between p-3 rounded-lg border border-red-500/10 hover:border-red-500/20 hover:bg-red-500/5 transition-all group disabled:opacity-50"
            >
              <div className="text-left">
                <div className="text-xs font-medium text-red-400/70 group-hover:text-red-400 transition-colors">Reiniciar Agente</div>
                <div className="text-[10px] text-slate-600">Restart via PM2 — downtime de ~2s</div>
              </div>
              {actionLoading === 'Restart' ? (
                <svg className="w-4 h-4 text-red-400 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-4 h-4 text-slate-600 group-hover:text-red-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
