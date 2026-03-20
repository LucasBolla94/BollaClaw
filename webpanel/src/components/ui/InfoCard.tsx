'use client';

interface InfoRow {
  label: string;
  value: string | number;
  mono?: boolean;
}

interface Props {
  title: string;
  icon: React.ReactNode;
  badge?: { text: string; color: 'green' | 'red' | 'yellow' | 'blue' | 'gray' };
  rows: InfoRow[];
  tags?: string[];
  children?: React.ReactNode;
}

const badgeColors = {
  green: 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20',
  red: 'bg-red-400/10 text-red-400 border-red-400/20',
  yellow: 'bg-amber-400/10 text-amber-400 border-amber-400/20',
  blue: 'bg-blue-400/10 text-blue-400 border-blue-400/20',
  gray: 'bg-slate-400/10 text-slate-500 border-slate-400/20',
};

export function InfoCard({ title, icon, badge, rows, tags, children }: Props) {
  return (
    <div className="glass-card p-5 animate-slide-in">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <span className="text-slate-400">{icon}</span>
          <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
        </div>
        {badge && (
          <span className={`text-[10px] font-medium px-2.5 py-0.5 rounded-full border ${badgeColors[badge.color]}`}>
            {badge.text}
          </span>
        )}
      </div>

      <div className="space-y-2.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between">
            <span className="text-xs text-slate-600">{row.label}</span>
            <span className={`text-xs text-slate-300 ${row.mono ? 'font-mono text-[11px]' : ''}`}>
              {row.value}
            </span>
          </div>
        ))}
      </div>

      {tags && tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-4 pt-3 border-t border-white/[0.04]">
          {tags.map((tag) => (
            <span key={tag} className="text-[10px] px-2 py-0.5 rounded-md bg-white/[0.04] text-slate-500 border border-white/[0.04]">
              {tag}
            </span>
          ))}
        </div>
      )}

      {children}
    </div>
  );
}
