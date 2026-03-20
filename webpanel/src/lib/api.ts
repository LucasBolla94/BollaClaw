// ── BollaClaw API Client ──────────────────────────────────────
// Communicates with the Express AdminServer on the same origin.
// Uses httpOnly cookie auth + CSRF double-submit pattern.

function getCsrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)csrf-token=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function api<T = unknown>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {};
  const csrf = getCsrfToken();

  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }
  if (csrf && options.method && options.method !== 'GET') {
    headers['X-CSRF-Token'] = csrf;
  }

  const res = await fetch(`/api${endpoint}`, {
    credentials: 'same-origin',
    ...options,
    headers: { ...headers, ...(options.headers as Record<string, string>) },
  });

  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('auth:logout'));
    throw new ApiError('Unauthorized', 401);
  }

  if (res.status === 403) {
    // CSRF mismatch — refresh and retry once
    await fetch('/api/csrf-token', { credentials: 'same-origin' });
    const newCsrf = getCsrfToken();
    if (newCsrf) headers['X-CSRF-Token'] = newCsrf;
    const retry = await fetch(`/api${endpoint}`, {
      credentials: 'same-origin',
      ...options,
      headers: { ...headers, ...(options.headers as Record<string, string>) },
    });
    if (!retry.ok) throw new ApiError('CSRF refresh failed', retry.status);
    return retry.json();
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(body.error || res.statusText, res.status);
  }

  return res.json();
}

// ── Typed API functions ───────────────────────────────────────

export interface SystemStatus {
  system: {
    hostname: string;
    platform: string;
    cpuModel: string;
    cpuCores: number;
    cpuUsage: number;
    ramUsed: number;
    ramTotal: number;
    ramPercent: number;
    diskUsed: number;
    diskTotal: number;
    diskPercent: number;
    uptime: number;
    uptimeFormatted: string;
    nodeVersion: string;
    processUptime: string;
    pid: number;
  };
  agent: {
    provider: string;
    model: string;
    skills: string[];
    tools: string[];
    soulConfigured: boolean;
    conversationCount: number;
  };
  git: {
    branch: string;
    commit: string;
    lastCommitMsg: string;
  };
  pm2: {
    status: string;
    uptime: string;
    restarts: number;
    memory: string;
  };
  config: {
    stt: string;
    maxIter: number;
    memWindow: number;
    adminPort: number;
    telegramAllowed: number[];
  };
}

export interface TelemetryStatus {
  enabled: boolean;
  connected: boolean;
  instanceId: string;
  logForwarder: {
    connected: boolean;
    queueSize: number;
    totalSent: number;
    totalDropped: number;
    failures: number;
  };
}

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  meta?: Record<string, unknown>;
}

export interface Conversation {
  id: string;
  userId: number;
  username: string;
  messageCount: number;
  lastMessage: string;
  lastMessageAt: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface SessionInfo {
  userId: string;
  createdAt: number;
  lastActivity: number;
  mustChangePassword: boolean;
}

export const apiClient = {
  // Auth
  login: (password: string) =>
    api<{ ok: boolean; mustChangePassword?: boolean }>('/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),

  logout: () => api('/logout', { method: 'POST' }),

  session: () => api<SessionInfo>('/session'),

  changePassword: (currentPassword: string, newPassword: string) =>
    api<{ ok: boolean }>('/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  // Dashboard
  status: () => api<SystemStatus>('/status'),
  telemetryStatus: () => api<TelemetryStatus>('/telemetry-status'),

  // Logs
  logs: (limit = 200, level?: string) =>
    api<{ logs: LogEntry[] }>(`/logs?limit=${limit}${level ? `&level=${level}` : ''}`),

  clearLogs: () => api('/logs', { method: 'DELETE' }),

  // Soul & Memory
  soul: () => api<{ soul: Record<string, unknown> }>('/soul'),
  memory: () => api<{ memory: Record<string, unknown> }>('/memory'),

  // Conversations
  conversations: () => api<{ conversations: Conversation[] }>('/conversations'),
  messages: (id: string, limit = 50) =>
    api<{ messages: Message[] }>(`/conversations/${id}/messages?limit=${limit}`),

  // Actions
  reloadSkills: () => api('/reload-skills', { method: 'POST' }),
  reloadProviders: () => api('/reload-providers', { method: 'POST' }),
  reloadIdentity: () => api('/reload-identity', { method: 'POST' }),
  restart: () => api('/restart', { method: 'POST' }),

  // Health
  health: () => api<{ status: string; uptime: number }>('/health'),
};
