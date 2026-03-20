'use client';

import { useCallback } from 'react';
import { usePolling } from '@/hooks/usePolling';
import { apiClient, type SystemStatus, type TelemetryStatus } from '@/lib/api';
import { formatBytes } from '@/lib/utils';
import { StatCard } from '@/components/ui/StatCard';
import { InfoCard } from '@/components/ui/InfoCard';

export function Dashboard() {
  const fetchStatus = useCallback(() => apiClient.status(), []);
  const fetchTelemetry = useCallback(() => apiClient.telemetryStatus(), []);

  const { data: status } = usePolling<SystemStatus>(fetchStatus, 5000);
  const { data: telemetry } = usePolling<TelemetryStatus>(fetchTelemetry, 10000);

  const s = status?.system;
  const a = status?.agent;
  const g = status?.git;
  const p = status?.pm2;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-white tracking-tight">Dashboard</h2>
        <p className="text-sm text-slate-500 mt-1">Monitoramento em tempo real do sistema</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="CPU"
          value={s ? `${s.cpuUsage}%` : '—'}
          subtitle={s ? `${s.cpuCores} cores` : 'carregando...'}
          percent={s?.cpuUsage}
          icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" /></svg>}
        />
        <StatCard
          label="RAM"
          value={s ? `${(s.ramUsed / 1073741824).toFixed(1)}G` : '—'}
          subtitle={s ? `${formatBytes(s.ramTotal)} total` : 'carregando...'}
          percent={s?.ramPercent}
          icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>}
        />
        <StatCard
          label="Disco"
          value={s ? `${s.diskPercent}%` : '—'}
          subtitle={s ? `${formatBytes(s.diskTotal)} total` : 'carregando...'}
          percent={s?.diskPercent}
          icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M4 7v10c0 2 2 3 4 3h8c2 0 4-1 4-3V7c0-2-2-3-4-3H8C6 4 4 5 4 7z" /><path d="M8 12h8" /></svg>}
        />
        <StatCard
          label="Uptime"
          value={s?.uptimeFormatted ?? '—'}
          subtitle={s ? `Process: ${s.processUptime}` : 'carregando...'}
          color="brand"
          icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
        />
      </div>

      {/* Info cards grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Agent */}
        <InfoCard
          title="Agente"
          icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>}
          badge={a?.soulConfigured ? { text: 'Configurada', color: 'green' } : { text: 'Pendente', color: 'yellow' }}
          rows={[
            { label: 'Provider', value: a?.provider ?? '—' },
            { label: 'Modelo', value: a?.model ?? '—' },
            { label: 'Skills', value: a?.skills?.length ?? 0 },
            { label: 'Tools', value: a?.tools?.length ?? 0 },
            { label: 'Conversas', value: a?.conversationCount ?? 0 },
          ]}
          tags={a?.skills}
        >
          {a?.tools && a.tools.length > 0 && (
            <div className="mt-3 pt-3 border-t border-white/[0.04]">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-600 mb-2">Tools</div>
              <div className="flex flex-wrap gap-1.5">
                {a.tools.map((t) => (
                  <span key={t} className="text-[10px] px-2 py-0.5 rounded-md bg-brand-500/5 text-brand-400/70 border border-brand-500/10">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
        </InfoCard>

        {/* Right column: Git + PM2 + System + BollaWatch */}
        <div className="space-y-4">
          <InfoCard
            title="Git"
            icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></svg>}
            rows={[
              { label: 'Branch', value: g?.branch ?? '—' },
              { label: 'Commit', value: g?.commit?.slice(0, 8) ?? '—', mono: true },
              { label: 'Mensagem', value: g?.lastCommitMsg ?? '—' },
            ]}
          />

          <InfoCard
            title="PM2"
            icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>}
            badge={p ? { text: p.status, color: p.status === 'online' ? 'green' : 'red' } : undefined}
            rows={[
              { label: 'Uptime', value: p?.uptime ?? '—' },
              { label: 'Restarts', value: p?.restarts ?? 0 },
              { label: 'Memória', value: p?.memory ?? '—' },
            ]}
          />

          <InfoCard
            title="Sistema"
            icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" /></svg>}
            rows={[
              { label: 'Hostname', value: s?.hostname ?? '—' },
              { label: 'Plataforma', value: s?.platform ?? '—' },
              { label: 'Node.js', value: s?.nodeVersion ?? '—', mono: true },
              { label: 'PID', value: s?.pid ?? '—', mono: true },
            ]}
          />

          <InfoCard
            title="BollaWatch"
            icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.858 15.355-5.858 21.213 0" /></svg>}
            badge={
              telemetry
                ? telemetry.connected
                  ? { text: 'Conectado', color: 'green' }
                  : telemetry.enabled
                    ? { text: 'Desconectado', color: 'red' }
                    : { text: 'Desativado', color: 'gray' }
                : undefined
            }
            rows={[
              { label: 'Conexão', value: telemetry?.connected ? 'Ativo' : telemetry?.enabled ? 'Offline' : 'Desativado' },
              { label: 'Logs enviados', value: telemetry?.logForwarder?.totalSent?.toLocaleString() ?? '—' },
              { label: 'Logs perdidos', value: telemetry?.logForwarder?.totalDropped?.toLocaleString() ?? '—' },
              { label: 'Fila', value: telemetry?.logForwarder?.queueSize ?? '—' },
              { label: 'Instance ID', value: telemetry?.instanceId?.slice(0, 16) ?? '—', mono: true },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
