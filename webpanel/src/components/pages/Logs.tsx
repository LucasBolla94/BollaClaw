'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { usePolling } from '@/hooks/usePolling';
import { apiClient, type LogEntry } from '@/lib/api';

type LogLevel = 'all' | 'info' | 'warn' | 'error' | 'debug';

const levelStyles: Record<string, string> = {
  info: 'log-info',
  warn: 'log-warn',
  error: 'log-error',
  debug: 'log-debug',
};

const levelBadge: Record<string, string> = {
  info: 'bg-blue-400/10 text-blue-400',
  warn: 'bg-amber-400/10 text-amber-400',
  error: 'bg-red-400/10 text-red-400',
  debug: 'bg-slate-400/10 text-slate-500',
};

export function LogsPage() {
  const [filter, setFilter] = useState<LogLevel>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchLogs = useCallback(
    () => apiClient.logs(300, filter === 'all' ? undefined : filter),
    [filter]
  );

  const { data } = usePolling(fetchLogs, 3000);
  const logs = data?.logs ?? [];

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const filters: { id: LogLevel; label: string }[] = [
    { id: 'all', label: 'Todos' },
    { id: 'info', label: 'Info' },
    { id: 'warn', label: 'Warn' },
    { id: 'error', label: 'Error' },
    { id: 'debug', label: 'Debug' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white tracking-tight">Logs</h2>
          <p className="text-sm text-slate-500 mt-1">Monitoramento em tempo real</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Auto-scroll toggle */}
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`text-xs px-3 py-1.5 rounded-md border transition-all ${
              autoScroll
                ? 'border-brand-500/30 bg-brand-500/10 text-brand-400'
                : 'border-white/[0.06] text-slate-600 hover:text-slate-400'
            }`}
          >
            Auto-scroll {autoScroll ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-1 p-1 bg-surface-2/50 rounded-lg w-fit">
        {filters.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              filter === f.id
                ? 'bg-surface-4 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-400'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Log output */}
      <div
        ref={containerRef}
        className="glass-card p-0 h-[calc(100vh-280px)] overflow-y-auto font-mono text-xs"
      >
        {logs.length === 0 ? (
          <div className="h-full flex items-center justify-center text-slate-600">
            Nenhum log encontrado
          </div>
        ) : (
          <div className="divide-y divide-white/[0.02]">
            {logs.map((log, i) => (
              <div key={i} className={`flex items-start gap-3 px-4 py-1.5 hover:bg-white/[0.02] ${levelStyles[log.level] || ''}`}>
                <span className="text-slate-700 flex-shrink-0 w-[140px] tabular-nums">
                  {new Date(log.timestamp).toLocaleTimeString('pt-BR', { hour12: false, fractionalSecondDigits: 3 })}
                </span>
                <span className={`flex-shrink-0 px-1.5 py-0 rounded text-[10px] font-medium uppercase ${levelBadge[log.level] || 'text-slate-500'}`}>
                  {log.level}
                </span>
                <span className="text-slate-400 break-all">{log.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
