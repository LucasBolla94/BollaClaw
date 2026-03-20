export function cn(...inputs: (string | boolean | undefined | null)[]): string {
  return inputs.filter(Boolean).join(' ');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

export function formatNumber(n: number): string {
  return n.toLocaleString('pt-BR');
}

export function timeAgo(date: string | number): string {
  const now = Date.now();
  const then = typeof date === 'string' ? new Date(date).getTime() : date;
  const diff = Math.floor((now - then) / 1000);

  if (diff < 60) return 'agora';
  if (diff < 3600) return `${Math.floor(diff / 60)}m atrás`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h atrás`;
  return `${Math.floor(diff / 86400)}d atrás`;
}

export function getColorForPercent(percent: number): string {
  if (percent > 80) return 'text-red-400';
  if (percent > 50) return 'text-yellow-400';
  return 'text-emerald-400';
}

export function getBarColorForPercent(percent: number): string {
  if (percent > 80) return 'bg-red-400';
  if (percent > 50) return 'bg-yellow-400';
  return 'bg-emerald-400';
}
