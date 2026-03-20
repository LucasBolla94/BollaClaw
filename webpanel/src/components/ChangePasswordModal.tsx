'use client';

import { useState, FormEvent } from 'react';
import { apiClient } from '@/lib/api';

interface Props {
  forced: boolean;
  onClose: () => void;
}

export function ChangePasswordModal({ forced, onClose }: Props) {
  const [current, setCurrent] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (newPwd.length < 8) return setError('Mínimo 8 caracteres');
    if (newPwd !== confirm) return setError('Senhas não conferem');

    setLoading(true);
    setError('');
    try {
      await apiClient.changePassword(current, newPwd);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao alterar senha');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="glass-card p-6 w-full max-w-md mx-4 space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-white">
            {forced ? 'Defina uma nova senha' : 'Alterar senha'}
          </h3>
          <p className="text-sm text-slate-500 mt-1">
            {forced ? 'Você precisa trocar a senha padrão.' : 'Defina uma nova senha para o painel.'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            placeholder="Senha atual"
            autoComplete="current-password"
            className="w-full px-4 py-2.5 bg-surface-3/50 border border-white/[0.06] rounded-lg text-white placeholder-slate-600 focus:outline-none focus:border-brand-500/50 text-sm"
          />
          <input
            type="password"
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
            placeholder="Nova senha (mín. 8 caracteres)"
            autoComplete="new-password"
            className="w-full px-4 py-2.5 bg-surface-3/50 border border-white/[0.06] rounded-lg text-white placeholder-slate-600 focus:outline-none focus:border-brand-500/50 text-sm"
          />
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirmar nova senha"
            autoComplete="new-password"
            className="w-full px-4 py-2.5 bg-surface-3/50 border border-white/[0.06] rounded-lg text-white placeholder-slate-600 focus:outline-none focus:border-brand-500/50 text-sm"
          />

          {error && (
            <p className="text-red-400 text-sm px-1">{error}</p>
          )}

          <div className="flex gap-3 pt-2">
            {!forced && (
              <button type="button" onClick={onClose} className="flex-1 py-2.5 text-sm rounded-lg border border-white/[0.06] text-slate-400 hover:bg-white/[0.03] transition-all">
                Cancelar
              </button>
            )}
            <button type="submit" disabled={loading} className="flex-1 py-2.5 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-500 disabled:opacity-50 transition-all font-medium">
              {loading ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
