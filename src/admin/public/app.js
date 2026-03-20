/* ═══════════════════════════════════════════════════════════════
   BollaClaw Web Panel — Application Logic
   ═══════════════════════════════════════════════════════════════
   Security: httpOnly cookie auth, CSRF double-submit, no eval(),
   no innerHTML with user data, strict CSP compatible.
   ═══════════════════════════════════════════════════════════════ */

'use strict';

// ── State ──────────────────────────────────────────────────────
const state = {
  authenticated: false,
  currentPage: 'dashboard',
  csrfToken: null,
  status: null,
  logs: [],
  conversations: [],
  selectedConv: null,
  messages: [],
  soul: null,
  memory: null,
  pollIntervals: [],
  logFilter: 'all',
};

// ── API client (uses httpOnly cookie, sends CSRF header) ──────

function getCsrfToken() {
  const match = document.cookie.match(/(?:^|;\s*)csrf-token=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function api(endpoint, options = {}) {
  const csrf = getCsrfToken();
  const headers = { ...options.headers };

  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }
  if (csrf && options.method && options.method !== 'GET') {
    headers['X-CSRF-Token'] = csrf;
  }

  const res = await fetch(`/api${endpoint}`, {
    credentials: 'same-origin',
    ...options,
    headers,
  });

  if (res.status === 401) {
    showLogin();
    throw new Error('Unauthorized');
  }

  if (res.status === 403) {
    // CSRF failed — refresh token and retry once
    await fetch('/api/csrf-token', { credentials: 'same-origin' });
    const newCsrf = getCsrfToken();
    if (newCsrf) headers['X-CSRF-Token'] = newCsrf;
    const retry = await fetch(`/api${endpoint}`, { credentials: 'same-origin', ...options, headers });
    if (!retry.ok) throw new Error('Request failed');
    return retry.json();
  }

  if (res.status === 429) {
    const data = await res.json();
    toast(`Muitas tentativas. Tente em ${data.retryAfter}s`, 'error');
    throw new Error('Rate limited');
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(data.error || 'Request failed');
  }

  return res.json();
}

// ── Toast notifications ────────────────────────────────────────

function toast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;

  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  el.textContent = `${icons[type] || ''} ${message}`;

  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(100%)';
    el.style.transition = '.3s ease';
    setTimeout(() => el.remove(), 300);
  }, 4000);
}

// ── Login ──────────────────────────────────────────────────────

function showLogin() {
  state.authenticated = false;
  stopPolling();
  document.getElementById('login-overlay').style.display = 'flex';
  document.getElementById('app-container').style.display = 'none';
}

function hideLogin() {
  state.authenticated = true;
  document.getElementById('login-overlay').style.display = 'none';
  document.getElementById('app-container').style.display = 'flex';
}

async function handleLogin(e) {
  e.preventDefault();
  const input = document.getElementById('login-password');
  const btn = document.getElementById('login-btn');
  const err = document.getElementById('login-error');

  const password = input.value.trim();
  if (!password) {
    err.textContent = 'Digite a senha';
    err.classList.add('visible');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Entrando...';
  err.classList.remove('visible');

  try {
    const data = await api('/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });

    input.value = '';
    hideLogin();

    if (data.mustChangePassword) {
      showChangePasswordModal(true);
    }

    startApp();
  } catch (error) {
    err.textContent = error.message || 'Senha incorreta';
    err.classList.add('visible');
    input.classList.add('error');
    input.focus();
    setTimeout(() => input.classList.remove('error'), 2000);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
}

async function handleLogout() {
  try {
    await api('/logout', { method: 'POST' });
  } catch { /* ignore */ }
  showLogin();
}

// ── Change password modal ──────────────────────────────────────

function showChangePasswordModal(forced = false) {
  const modal = document.getElementById('password-modal');
  modal.classList.add('visible');
  if (forced) {
    document.getElementById('pwd-title').textContent = 'Troque sua senha';
    document.getElementById('pwd-subtitle').textContent = 'Por segurança, defina uma nova senha no primeiro acesso.';
  }
}

function hideChangePasswordModal() {
  document.getElementById('password-modal').classList.remove('visible');
  document.getElementById('pwd-current').value = '';
  document.getElementById('pwd-new').value = '';
  document.getElementById('pwd-confirm').value = '';
  document.getElementById('pwd-error').classList.remove('visible');
}

async function handleChangePassword(e) {
  e.preventDefault();
  const current = document.getElementById('pwd-current').value;
  const newPwd = document.getElementById('pwd-new').value;
  const confirm = document.getElementById('pwd-confirm').value;
  const err = document.getElementById('pwd-error');

  if (newPwd !== confirm) {
    err.textContent = 'Senhas não coincidem';
    err.classList.add('visible');
    return;
  }

  if (newPwd.length < 8) {
    err.textContent = 'Mínimo 8 caracteres';
    err.classList.add('visible');
    return;
  }

  try {
    await api('/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: current, newPassword: newPwd }),
    });
    hideChangePasswordModal();
    toast('Senha alterada com sucesso', 'success');
  } catch (error) {
    err.textContent = error.message || 'Erro ao alterar senha';
    err.classList.add('visible');
  }
}

// ── Navigation ─────────────────────────────────────────────────

function navigate(page) {
  state.currentPage = page;

  // Update nav items
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });

  // Show active page
  document.querySelectorAll('.page').forEach(el => {
    el.classList.toggle('active', el.id === `page-${page}`);
  });

  // Load page-specific data
  switch (page) {
    case 'dashboard': loadStatus(); break;
    case 'logs': loadLogs(); break;
    case 'conversations': loadConversations(); break;
    case 'soul': loadSoul(); break;
    case 'memory': loadMemory(); break;
  }
}

// ── Dashboard ──────────────────────────────────────────────────

async function loadStatus() {
  try {
    state.status = await api('/status');
    renderDashboard();
  } catch { /* handled by api() */ }
  try {
    state.telemetry = await api('/telemetry-status');
    renderBollaWatch();
  } catch { /* BollaWatch status optional */ }
}

function renderDashboard() {
  const s = state.status;
  if (!s) return;

  // Stat cards
  const cpuColor = s.system.cpuUsage > 80 ? 'red' : s.system.cpuUsage > 50 ? 'yellow' : 'green';
  const ramColor = s.system.ramPercent > 80 ? 'red' : s.system.ramPercent > 50 ? 'yellow' : 'green';
  const diskColor = s.system.diskPercent > 85 ? 'red' : s.system.diskPercent > 60 ? 'yellow' : 'green';

  setStatCard('stat-cpu', `${s.system.cpuUsage}%`, `${s.system.cpuCores} cores`, s.system.cpuUsage, cpuColor);
  setStatCard('stat-ram', `${((s.system.ramUsed / 1073741824)).toFixed(1)}G`, formatBytesJS(s.system.ramTotal) + ' total', s.system.ramPercent, ramColor);
  setStatCard('stat-disk', `${s.system.diskPercent}%`, formatBytesJS(s.system.diskTotal) + ' total', s.system.diskPercent, diskColor);
  setStatCard('stat-uptime', s.system.uptimeFormatted, `Process: ${s.system.processUptime}`, 0, 'accent');

  // Agent info
  setInfo('info-provider', s.agent?.provider || '—');
  setInfo('info-model', s.agent?.model || '—');
  setInfo('info-skills', s.agent?.skills?.length || 0);
  setInfo('info-tools', s.agent?.tools?.length || 0);
  setInfo('info-soul', s.agent?.soulConfigured ? '✓ Configurada' : '✕ Pendente');
  setInfo('info-conversations', s.agent?.conversationCount || 0);

  // Git info
  setInfo('info-branch', s.git?.branch || '—');
  setInfo('info-commit', s.git?.commit || '—');
  setInfo('info-commit-msg', s.git?.lastCommitMsg || '—');

  // PM2
  if (s.pm2) {
    setInfo('info-pm2-status', s.pm2.status);
    setInfo('info-pm2-uptime', s.pm2.uptime);
    setInfo('info-pm2-restarts', s.pm2.restarts);
    setInfo('info-pm2-memory', s.pm2.memory);
  }

  // System
  setInfo('info-hostname', s.system.hostname);
  setInfo('info-platform', s.system.platform);
  setInfo('info-node', s.system.nodeVersion);
  setInfo('info-pid', s.system.pid);

  // Skills tags
  const skillsContainer = document.getElementById('skills-tags');
  if (skillsContainer && s.agent?.skills) {
    skillsContainer.textContent = '';
    s.agent.skills.forEach(skill => {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = skill;
      skillsContainer.appendChild(tag);
    });
  }

  // Tools tags
  const toolsContainer = document.getElementById('tools-tags');
  if (toolsContainer && s.agent?.tools) {
    toolsContainer.textContent = '';
    s.agent.tools.forEach(tool => {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = tool;
      toolsContainer.appendChild(tag);
    });
  }
}

function renderBollaWatch() {
  const t = state.telemetry;
  if (!t) return;

  const badge = document.getElementById('bw-status-badge');
  if (badge) {
    if (!t.enabled) {
      badge.textContent = 'Desativado';
      badge.className = 'badge badge-gray';
    } else if (t.connected && t.logForwarder?.connected) {
      badge.textContent = 'Conectado';
      badge.className = 'badge badge-green';
    } else {
      badge.textContent = 'Desconectado';
      badge.className = 'badge badge-red';
    }
  }

  const lf = t.logForwarder || {};
  setInfo('bw-connection', t.connected ? 'Ativo' : 'Offline');
  setInfo('bw-sent', (lf.totalSent || 0).toLocaleString());
  setInfo('bw-dropped', (lf.totalDropped || 0).toLocaleString());
  setInfo('bw-queue', lf.queueSize || 0);
  setInfo('bw-instance', t.instanceId || '—');
}

function setStatCard(id, value, sub, percent, color) {
  const card = document.getElementById(id);
  if (!card) return;
  card.querySelector('.stat-value').textContent = value;
  card.querySelector('.stat-sub').textContent = sub;
  const bar = card.querySelector('.stat-bar-fill');
  if (bar && percent > 0) {
    bar.style.width = `${Math.min(percent, 100)}%`;
    bar.className = `stat-bar-fill fill-${color}`;
  }
}

function setInfo(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(value);
}

function formatBytesJS(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)}MB`;
  return `${(bytes / 1073741824).toFixed(1)}GB`;
}

// ── Logs ───────────────────────────────────────────────────────

async function loadLogs() {
  try {
    const data = await api(`/logs?limit=300${state.logFilter !== 'all' ? `&level=${state.logFilter}` : ''}`);
    state.logs = data.logs || [];
    renderLogs();
  } catch { /* handled */ }
}

function renderLogs() {
  const viewer = document.getElementById('log-content');
  if (!viewer) return;
  viewer.textContent = '';

  if (state.logs.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Nenhum log encontrado';
    viewer.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  state.logs.forEach(log => {
    const line = document.createElement('div');
    line.className = 'log-line';

    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = new Date(log.timestamp || log.ts).toLocaleTimeString('pt-BR');

    const level = document.createElement('span');
    level.className = `log-level ${log.level}`;
    level.textContent = log.level.toUpperCase();

    const msg = document.createElement('span');
    msg.className = 'log-msg';
    msg.textContent = log.message || log.msg || JSON.stringify(log);

    line.appendChild(time);
    line.appendChild(level);
    line.appendChild(msg);
    fragment.appendChild(line);
  });

  viewer.appendChild(fragment);
  viewer.scrollTop = viewer.scrollHeight;
}

function setLogFilter(filter) {
  state.logFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });
  loadLogs();
}

async function clearLogs() {
  try {
    await api('/logs', { method: 'DELETE' });
    state.logs = [];
    renderLogs();
    toast('Logs limpos', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

// ── Conversations ──────────────────────────────────────────────

async function loadConversations() {
  try {
    const data = await api('/conversations');
    state.conversations = data.conversations || [];
    renderConversations();
  } catch { /* handled */ }
}

function renderConversations() {
  const list = document.getElementById('conv-list');
  if (!list) return;
  list.textContent = '';

  if (state.conversations.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const icon = document.createElement('div');
    icon.className = 'empty-icon';
    icon.textContent = '💬';
    const title = document.createElement('h3');
    title.textContent = 'Sem conversas';
    const desc = document.createElement('p');
    desc.textContent = 'As conversas aparecerão aqui';
    empty.appendChild(icon);
    empty.appendChild(title);
    empty.appendChild(desc);
    list.appendChild(empty);
    return;
  }

  state.conversations.forEach(conv => {
    const item = document.createElement('div');
    item.className = `conv-item${state.selectedConv === conv.id ? ' active' : ''}`;

    const user = document.createElement('div');
    user.className = 'conv-user';
    user.textContent = `User ${conv.user_id}`;

    const meta = document.createElement('div');
    meta.className = 'conv-meta';
    meta.textContent = `${conv.message_count} msgs · ${conv.provider || '—'} · ${new Date(conv.updated_at).toLocaleDateString('pt-BR')}`;

    item.appendChild(user);
    item.appendChild(meta);
    item.addEventListener('click', () => loadMessages(conv.id));
    list.appendChild(item);
  });
}

async function loadMessages(convId) {
  state.selectedConv = convId;
  renderConversations(); // re-highlight

  try {
    const data = await api(`/conversations/${encodeURIComponent(convId)}/messages`);
    state.messages = data.messages || [];
    renderMessages();
  } catch (error) {
    toast(error.message, 'error');
  }
}

function renderMessages() {
  const container = document.getElementById('conv-messages');
  if (!container) return;
  container.textContent = '';

  if (state.messages.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Selecione uma conversa';
    container.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  state.messages.forEach(msg => {
    const bubble = document.createElement('div');
    bubble.className = `msg-bubble msg-${msg.role === 'user' ? 'user' : 'assistant'}`;

    const text = document.createElement('div');
    text.textContent = msg.content?.slice(0, 2000) || '';

    const time = document.createElement('div');
    time.className = 'msg-time';
    time.textContent = new Date(msg.created_at).toLocaleString('pt-BR');

    bubble.appendChild(text);
    bubble.appendChild(time);
    fragment.appendChild(bubble);
  });

  container.appendChild(fragment);
  container.scrollTop = container.scrollHeight;
}

// ── Soul ───────────────────────────────────────────────────────

async function loadSoul() {
  try {
    const data = await api('/soul');
    state.soul = data;
    renderSoul();
  } catch { /* handled */ }
}

function renderSoul() {
  const container = document.getElementById('soul-content');
  if (!container || !state.soul) return;
  container.textContent = '';

  if (!state.soul.configured) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const icon = document.createElement('div');
    icon.className = 'empty-icon';
    icon.textContent = '🧠';
    const title = document.createElement('h3');
    title.textContent = 'Soul não configurada';
    const desc = document.createElement('p');
    desc.textContent = 'Envie uma mensagem no Telegram para iniciar o bootstrap';
    empty.appendChild(icon);
    empty.appendChild(title);
    empty.appendChild(desc);
    container.appendChild(empty);
    return;
  }

  const soul = state.soul.soul;

  // Identity card
  const idCard = document.createElement('div');
  idCard.className = 'card';
  idCard.style.marginBottom = '16px';

  const idHeader = document.createElement('div');
  idHeader.className = 'card-header';
  const idTitle = document.createElement('h3');
  idTitle.textContent = '🤖 Identidade';
  idHeader.appendChild(idTitle);
  idCard.appendChild(idHeader);

  const fields = [
    ['Nome', soul.name],
    ['Papel', soul.role],
    ['Criador', soul.creator],
    ['Dono', soul.owner?.name],
    ['Idioma', soul.owner?.language],
  ];
  fields.forEach(([label, value]) => {
    if (!value) return;
    const row = document.createElement('div');
    row.className = 'info-row';
    const l = document.createElement('span');
    l.className = 'label';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = 'value';
    v.textContent = value;
    row.appendChild(l);
    row.appendChild(v);
    idCard.appendChild(row);
  });

  container.appendChild(idCard);

  // Traits card
  if (soul.traits) {
    const traitsCard = document.createElement('div');
    traitsCard.className = 'card';
    traitsCard.style.marginBottom = '16px';

    const tHeader = document.createElement('div');
    tHeader.className = 'card-header';
    const tTitle = document.createElement('h3');
    tTitle.textContent = '🎭 Traits';
    tHeader.appendChild(tTitle);
    traitsCard.appendChild(tHeader);

    Object.entries(soul.traits).forEach(([name, val]) => {
      const row = document.createElement('div');
      row.className = 'trait-row';

      const label = document.createElement('span');
      label.className = 'trait-label';
      label.textContent = name;

      const bar = document.createElement('div');
      bar.className = 'trait-bar';
      const fill = document.createElement('div');
      fill.className = 'trait-fill';
      fill.style.width = `${val}%`;
      bar.appendChild(fill);

      const value = document.createElement('span');
      value.className = 'trait-value';
      value.textContent = val;

      row.appendChild(label);
      row.appendChild(bar);
      row.appendChild(value);
      traitsCard.appendChild(row);
    });

    container.appendChild(traitsCard);
  }

  // Values & Rules
  if (soul.values?.length || soul.rules?.length) {
    const vrCard = document.createElement('div');
    vrCard.className = 'card';

    if (soul.values?.length) {
      const vh = document.createElement('h3');
      vh.textContent = '💎 Values';
      vh.style.marginBottom = '8px';
      vrCard.appendChild(vh);
      const tags = document.createElement('div');
      tags.className = 'tags';
      tags.style.marginBottom = '16px';
      soul.values.forEach(v => {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = v;
        tags.appendChild(tag);
      });
      vrCard.appendChild(tags);
    }

    if (soul.rules?.length) {
      const rh = document.createElement('h3');
      rh.textContent = '📋 Rules';
      rh.style.marginBottom = '8px';
      vrCard.appendChild(rh);
      soul.rules.forEach(r => {
        const p = document.createElement('p');
        p.style.cssText = 'font-size:13px;color:var(--text-2);padding:4px 0;border-bottom:1px solid var(--border)';
        p.textContent = r;
        vrCard.appendChild(p);
      });
    }

    container.appendChild(vrCard);
  }
}

// ── Memory ─────────────────────────────────────────────────────

async function loadMemory() {
  try {
    state.memory = await api('/memory');
    renderMemory();
  } catch { /* handled */ }
}

function renderMemory() {
  const container = document.getElementById('memory-content');
  if (!container || !state.memory) return;
  container.textContent = '';

  const card = document.createElement('div');
  card.className = 'card';

  const header = document.createElement('div');
  header.className = 'card-header';
  const title = document.createElement('h3');
  title.textContent = '💾 Memória';
  header.appendChild(title);
  card.appendChild(header);

  const rows = [
    ['Memória Semântica', state.memory.semanticEnabled ? '✓ Ativa' : '✕ Inativa'],
    ['DB Principal', state.memory.mainDbSize],
    ['DB Semântico', state.memory.semanticDbSize],
  ];

  rows.forEach(([label, value]) => {
    const row = document.createElement('div');
    row.className = 'info-row';
    const l = document.createElement('span');
    l.className = 'label';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = 'value';
    v.textContent = value;
    row.appendChild(l);
    row.appendChild(v);
    card.appendChild(row);
  });

  container.appendChild(card);

  // Info box
  const info = document.createElement('div');
  info.className = 'card';
  info.style.marginTop = '16px';
  const infoTitle = document.createElement('h3');
  infoTitle.textContent = 'ℹ️ Como funciona';
  infoTitle.style.marginBottom = '12px';
  info.appendChild(infoTitle);

  const explanation = document.createElement('p');
  explanation.style.cssText = 'font-size:13px;color:var(--text-2);line-height:1.7';
  explanation.textContent = 'A memória semântica usa embeddings ONNX locais (bge-small-en-v1.5) para armazenar fatos, preferências e contexto de longo prazo. A busca é híbrida: 70% similaridade vetorial + 30% keywords. O sistema só busca quando heurísticas detectam necessidade, economizando tokens.';
  info.appendChild(explanation);
  container.appendChild(info);
}

// ── Settings actions ───────────────────────────────────────────

async function actionReloadSkills() {
  try {
    await api('/reload-skills', { method: 'POST' });
    toast('Skills recarregadas', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

async function actionReloadProviders() {
  try {
    await api('/reload-providers', { method: 'POST' });
    toast('Providers recarregados', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

async function actionReloadSoul() {
  try {
    await api('/reload-identity', { method: 'POST' });
    toast('Soul recarregada', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

async function actionRestart() {
  if (!confirm('Tem certeza que deseja reiniciar o BollaClaw?')) return;
  try {
    await api('/restart', { method: 'POST' });
    toast('Reiniciando...', 'info');
  } catch (e) { toast(e.message, 'error'); }
}

// ── Polling ────────────────────────────────────────────────────

function startPolling() {
  stopPolling();
  // Status every 5s
  state.pollIntervals.push(setInterval(() => {
    if (state.currentPage === 'dashboard') loadStatus();
  }, 5000));
  // Logs every 4s
  state.pollIntervals.push(setInterval(() => {
    if (state.currentPage === 'logs') loadLogs();
  }, 4000));
}

function stopPolling() {
  state.pollIntervals.forEach(clearInterval);
  state.pollIntervals = [];
}

// ── Init ───────────────────────────────────────────────────────

async function checkAuth() {
  try {
    await api('/session');
    return true;
  } catch {
    return false;
  }
}

async function startApp() {
  navigate('dashboard');
  startPolling();
}

// Boot
document.addEventListener('DOMContentLoaded', async () => {
  // Wire up login form
  document.getElementById('login-form').addEventListener('submit', handleLogin);

  // Wire up nav
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => navigate(item.dataset.page));
  });

  // Wire up password modal
  document.getElementById('pwd-form').addEventListener('submit', handleChangePassword);
  document.getElementById('pwd-cancel').addEventListener('click', hideChangePasswordModal);

  // Wire up log filters
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => setLogFilter(btn.dataset.filter));
  });

  // Wire up action cards
  document.getElementById('action-reload-skills')?.addEventListener('click', actionReloadSkills);
  document.getElementById('action-reload-providers')?.addEventListener('click', actionReloadProviders);
  document.getElementById('action-reload-soul')?.addEventListener('click', actionReloadSoul);
  document.getElementById('action-change-pwd')?.addEventListener('click', () => showChangePasswordModal());
  document.getElementById('action-restart')?.addEventListener('click', actionRestart);
  document.getElementById('btn-clear-logs')?.addEventListener('click', clearLogs);
  document.getElementById('btn-logout')?.addEventListener('click', handleLogout);

  // Check if already authenticated
  const isAuth = await checkAuth();
  if (isAuth) {
    hideLogin();
    startApp();
  } else {
    showLogin();
  }
});
