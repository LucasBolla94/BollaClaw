'use client';

interface Props {
  label: string;
  value: string;
  subtitle: string;
  percent?: number;
  icon: React.ReactNode;
  color?: 'brand' | 'green' | 'yellow' | 'red' | 'blue';
}

const colorMap = {
  brand: { bar: 'bg-brand-500', text: 'text-brand-400', bg: 'bg-brand-500/10' },
  green: { bar: 'bg-emerald-400', text: 'text-emerald-400', bg: 'bg-emerald-400/10' },
  yellow: { bar: 'bg-amber-400', text: 'text-amber-400', bg: 'bg-amber-400/10' },
  red: { bar: 'bg-red-400', text: 'text-red-400', bg: 'bg-red-400/10' },
  blue: { bar: 'bg-blue-400', text: 'text-blue-400', bg: 'bg-blue-400/10' },
};

function getAutoColor(percent: number): 'green' | 'yellow' | 'red' {
  if (percent > 80) return 'red';
  if (percent > 50) return 'yellow';
  return 'green';
}

export function StatCard({ label, value, subtitle, percent, icon, color }: Props) {
  const effectiveColor = color || (percent != null ? getAutoColor(percent) : 'brand');
  const colors = colorMap[effectiveColor];

  return (
    <div className="glass-card p-5 space-y-3 animate-slide-in">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">{label}</span>
        <div className={`w-8 h-8 rounded-lg ${colors.bg} flex items-center justify-center ${colors.text}`}>
          {icon}
        </div>
      </div>
      <div>
        <div className={`text-2xl font-semibold ${colors.text} tracking-tight`}>{value}</div>
        <div className="text-xs text-slate-600 mt-0.5">{subtitle}</div>
      </div>
      {percent != null && (
        <div className="h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
          <div
            className={`h-full ${colors.bar} rounded-full transition-all duration-700 ease-out`}
            style={{ width: `${Math.min(percent, 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}
