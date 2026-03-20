/**
 * BollaWatch v2 Dashboard — Single-file embedded HTML
 * Complete rewrite with modular architecture, event management,
 * instance management, archive/rotation, API docs, and metrics charts.
 */
export function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BollaWatch v2 - Telemetry Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #0b0d14; --bg2: #141722; --bg3: #1c2030; --bg4: #252a3a;
      --text: #e4e7f0; --text2: #8b90a8; --text3: #5a5f78;
      --accent: #6366f1; --accent2: #818cf8; --accent-glow: rgba(99,102,241,0.15);
      --green: #22c55e; --green-bg: rgba(34,197,94,0.12);
      --red: #ef4444; --red-bg: rgba(239,68,68,0.12);
      --yellow: #eab308; --yellow-bg: rgba(234,179,8,0.12);
      --blue: #3b82f6; --blue-bg: rgba(59,130,246,0.12);
      --border: #252a3a; --border2: #2d3348;
      --radius: 10px; --radius-sm: 6px;
    }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; font-size: 14px; }
    a { color: var(--accent2); text-decoration: none; }
    button { cursor: pointer; font-family: inherit; }
    input, select { font-family: inherit; }

    /* ── Header ─────────────────────── */
    .header { background: var(--bg2); border-bottom: 1px solid var(--border); padding: 14px 24px; display: flex; justify-content: space-between; align-items: center; }
    .header h1 { font-size: 18px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
    .header h1 .logo { font-size: 22px; }
    .header h1 .brand { color: var(--accent2); }
    .header h1 .ver { font-size: 11px; color: var(--text3); font-weight: 400; margin-left: 4px; }
    .header-right { display: flex; gap: 10px; align-items: center; }
    .status-badge { font-size: 11px; padding: 3px 10px; border-radius: 20px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; }
    .status-badge.healthy { background: var(--green-bg); color: var(--green); }
    .status-badge.degraded { background: var(--yellow-bg); color: var(--yellow); }
    .status-badge.critical { background: var(--red-bg); color: var(--red); }
    .last-update { font-size: 11px; color: var(--text3); }
    .btn { background: var(--bg3); border: 1px solid var(--border2); color: var(--text); padding: 6px 14px; border-radius: var(--radius-sm); font-size: 12px; transition: all .15s; }
    .btn:hover { background: var(--bg4); border-color: var(--accent); }
    .btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
    .btn-primary:hover { background: #5558e6; }
    .btn-danger { background: transparent; border-color: var(--red); color: var(--red); }
    .btn-danger:hover { background: var(--red-bg); }
    .btn-success { background: transparent; border-color: var(--green); color: var(--green); }
    .btn-success:hover { background: var(--green-bg); }
    .btn-sm { padding: 3px 8px; font-size: 11px; }

    /* ── Layout ─────────────────────── */
    .container { max-width: 1440px; margin: 0 auto; padding: 20px; }

    /* ── Stats Grid ─────────────────── */
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 20px; }
    .stat-card { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; position: relative; overflow: hidden; }
    .stat-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px; }
    .stat-card.green::before { background: var(--green); }
    .stat-card.red::before { background: var(--red); }
    .stat-card.blue::before { background: var(--blue); }
    .stat-card.yellow::before { background: var(--yellow); }
    .stat-card.purple::before { background: var(--accent); }
    .stat-card .label { font-size: 11px; color: var(--text2); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
    .stat-card .value { font-size: 26px; font-weight: 800; line-height: 1; }
    .stat-card .sub { font-size: 11px; color: var(--text3); margin-top: 4px; }
    .stat-card.green .value { color: var(--green); }
    .stat-card.red .value { color: var(--red); }
    .stat-card.blue .value { color: var(--blue); }
    .stat-card.purple .value { color: var(--accent2); }

    /* ── Instances Bar ──────────────── */
    .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .section-title { font-size: 12px; font-weight: 600; color: var(--text2); text-transform: uppercase; letter-spacing: 0.5px; }
    .instances-bar { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; }
    .instance-chip { background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 8px 14px; display: flex; align-items: center; gap: 8px; cursor: pointer; transition: all .15s; position: relative; }
    .instance-chip:hover { border-color: var(--accent); }
    .instance-chip.active { border-color: var(--accent); background: var(--accent-glow); }
    .instance-chip .dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
    .instance-chip .dot.online { background: var(--green); box-shadow: 0 0 6px var(--green); }
    .instance-chip .dot.offline { background: var(--red); }
    .instance-chip .name { font-size: 12px; font-weight: 500; }
    .instance-chip .meta { font-size: 10px; color: var(--text3); }
    .instance-chip .delete-btn { position: absolute; top: -6px; right: -6px; width: 18px; height: 18px; border-radius: 50%; background: var(--red); color: #fff; border: 2px solid var(--bg); font-size: 10px; display: none; align-items: center; justify-content: center; line-height: 1; }
    .instance-chip:hover .delete-btn { display: flex; }

    /* ── Tabs ────────────────────────── */
    .tabs { display: flex; gap: 2px; margin-bottom: 16px; background: var(--bg2); padding: 3px; border-radius: 8px; width: fit-content; border: 1px solid var(--border); }
    .tab { padding: 7px 16px; border-radius: 6px; cursor: pointer; font-size: 12px; color: var(--text2); transition: all .15s; font-weight: 500; white-space: nowrap; }
    .tab:hover { color: var(--text); }
    .tab.active { background: var(--accent); color: white; }

    /* ── Filters ─────────────────────── */
    .filters { display: flex; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; align-items: center; }
    .filter-input { background: var(--bg2); border: 1px solid var(--border); color: var(--text); padding: 6px 12px; border-radius: var(--radius-sm); font-size: 12px; width: 200px; }
    .filter-input:focus { outline: none; border-color: var(--accent); }
    .filter-select { background: var(--bg2); border: 1px solid var(--border); color: var(--text); padding: 6px 12px; border-radius: var(--radius-sm); font-size: 12px; }
    .filter-select:focus { outline: none; border-color: var(--accent); }
    .actions-bar { display: flex; gap: 8px; margin-left: auto; }

    /* ── Table ────────────────────────── */
    .table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg2); }
    .events-table { width: 100%; border-collapse: collapse; }
    .events-table th { text-align: left; padding: 10px 12px; font-size: 10px; color: var(--text3); text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--border); background: var(--bg3); position: sticky; top: 0; font-weight: 600; }
    .events-table td { padding: 8px 12px; font-size: 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
    .events-table tr:hover { background: rgba(99,102,241,0.04); }
    .events-table tr.resolved { opacity: 0.45; }
    .events-table tr.resolved td.msg-cell { text-decoration: line-through; }
    .events-table th:first-child, .events-table td:first-child { width: 30px; text-align: center; }
    .events-table input[type=checkbox] { accent-color: var(--accent); cursor: pointer; }

    .badge { display: inline-block; padding: 2px 7px; border-radius: 4px; font-size: 10px; font-weight: 600; }
    .badge.error, .badge.fatal { background: var(--red-bg); color: var(--red); }
    .badge.warn { background: var(--yellow-bg); color: var(--yellow); }
    .badge.info { background: var(--blue-bg); color: var(--blue); }
    .badge.debug { background: var(--accent-glow); color: var(--accent2); }
    .badge-type { background: var(--bg4); color: var(--text2); }
    .badge-resolved { background: var(--green-bg); color: var(--green); font-size: 9px; margin-left: 6px; }

    .msg-cell { max-width: 400px; word-break: break-word; }
    .data-preview { font-size: 10px; color: var(--text3); margin-top: 3px; font-family: 'SF Mono', 'Fira Code', monospace; max-height: 50px; overflow: hidden; cursor: pointer; padding: 4px 6px; background: var(--bg); border-radius: 4px; }
    .data-preview.expanded { max-height: none; }
    .stack-trace { font-size: 10px; color: var(--red); font-family: monospace; white-space: pre-wrap; max-height: 80px; overflow: auto; margin-top: 3px; padding: 6px; background: var(--red-bg); border-radius: 4px; }
    .time-cell { white-space: nowrap; font-size: 11px; color: var(--text2); }
    .duration { font-size: 11px; color: var(--text3); }
    .resolve-btn { cursor: pointer; background: none; border: 1px solid var(--green); color: var(--green); border-radius: 4px; padding: 2px 6px; font-size: 10px; transition: all .15s; }
    .resolve-btn:hover { background: var(--green-bg); }

    /* ── Patterns ─────────────────────── */
    .patterns { display: grid; gap: 10px; }
    .pattern-card { background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px; display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
    .pattern-card .count { font-size: 22px; font-weight: 800; color: var(--red); flex-shrink: 0; }
    .pattern-card .msg { font-family: monospace; font-size: 12px; margin-bottom: 4px; word-break: break-all; }
    .pattern-card .meta-info { font-size: 10px; color: var(--text3); }
    .pattern-actions { display: flex; gap: 6px; flex-shrink: 0; }

    /* ── Management Tab ──────────────── */
    .mgmt-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
    .mgmt-card { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; }
    .mgmt-card h3 { font-size: 14px; font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
    .mgmt-card .mgmt-value { font-size: 24px; font-weight: 800; margin-bottom: 8px; }
    .mgmt-card .mgmt-sub { font-size: 12px; color: var(--text2); margin-bottom: 14px; }
    .mgmt-card .btn { width: 100%; text-align: center; padding: 8px 16px; }
    .archive-list { margin-top: 12px; max-height: 200px; overflow-y: auto; }
    .archive-item { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 11px; }
    .archive-item .name { color: var(--text2); }
    .archive-item .size { color: var(--text3); }

    /* ── API Docs Tab ────────────────── */
    .api-docs { display: grid; gap: 10px; }
    .api-endpoint { background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px; }
    .api-method { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; margin-right: 8px; font-family: monospace; }
    .api-method.get { background: var(--green-bg); color: var(--green); }
    .api-method.post { background: var(--blue-bg); color: var(--blue); }
    .api-method.put { background: var(--yellow-bg); color: var(--yellow); }
    .api-method.delete { background: var(--red-bg); color: var(--red); }
    .api-path { font-family: monospace; font-size: 13px; font-weight: 500; }
    .api-desc { font-size: 11px; color: var(--text2); margin-top: 4px; }

    /* ── Misc ─────────────────────────── */
    .empty-state { text-align: center; padding: 50px 20px; color: var(--text3); }
    .empty-state .icon { font-size: 40px; margin-bottom: 8px; }
    .pagination { display: flex; justify-content: center; gap: 8px; margin-top: 16px; align-items: center; }
    .pagination button { background: var(--bg2); border: 1px solid var(--border); color: var(--text); padding: 5px 12px; border-radius: var(--radius-sm); cursor: pointer; font-size: 12px; }
    .pagination button:hover:not(:disabled) { border-color: var(--accent); }
    .pagination button:disabled { opacity: 0.3; cursor: default; }
    .pagination .page-info { font-size: 11px; color: var(--text2); }

    /* ── Modal ────────────────────────── */
    .modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 1000; align-items: center; justify-content: center; backdrop-filter: blur(4px); }
    .modal-overlay.open { display: flex; }
    .modal { background: var(--bg2); border: 1px solid var(--border2); border-radius: 12px; padding: 24px; width: 90%; max-width: 440px; }
    .modal h3 { margin-bottom: 14px; font-size: 16px; }
    .modal textarea { width: 100%; background: var(--bg); border: 1px solid var(--border); color: var(--text); padding: 10px; border-radius: var(--radius-sm); font-size: 13px; resize: vertical; min-height: 80px; font-family: inherit; }
    .modal textarea:focus { outline: none; border-color: var(--accent); }
    .modal-actions { display: flex; gap: 8px; margin-top: 14px; justify-content: flex-end; }

    /* ── Toast ────────────────────────── */
    .toast-container { position: fixed; bottom: 20px; right: 20px; z-index: 2000; display: flex; flex-direction: column; gap: 8px; }
    .toast { background: var(--bg3); border: 1px solid var(--border2); color: var(--text); padding: 10px 16px; border-radius: 8px; font-size: 12px; animation: slideIn 0.3s ease; box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
    .toast.success { border-left: 3px solid var(--green); }
    .toast.error { border-left: 3px solid var(--red); }
    @keyframes slideIn { from { transform: translateX(100px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }

    @media (max-width: 768px) {
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
      .container { padding: 12px; }
      .mgmt-grid { grid-template-columns: 1fr; }
      .filters { flex-direction: column; }
      .filter-input { width: 100%; }
      .actions-bar { margin-left: 0; width: 100%; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1><span class="logo">👁️</span> <span class="brand">Bolla</span>Watch <span class="ver">v2</span></h1>
    <div class="header-right">
      <span class="last-update" id="lastUpdate"></span>
      <span class="status-badge" id="statusBadge">...</span>
      <button class="btn" onclick="refreshAll()">↻ Atualizar</button>
    </div>
  </div>

  <div class="container">
    <div class="stats-grid" id="statsGrid"></div>

    <div class="section-header">
      <span class="section-title" id="instancesTitle">Instâncias</span>
      <button class="btn btn-danger btn-sm" onclick="cleanupStale()">🗑 Limpar Stale</button>
    </div>
    <div class="instances-bar" id="instancesBar"></div>

    <div class="tabs" id="tabsBar">
      <div class="tab active" data-tab="events" onclick="switchTab('events')">Todos Eventos</div>
      <div class="tab" data-tab="errors" onclick="switchTab('errors')">Erros</div>
      <div class="tab" data-tab="messages" onclick="switchTab('messages')">Mensagens</div>
      <div class="tab" data-tab="tools" onclick="switchTab('tools')">Tool Calls</div>
      <div class="tab" data-tab="patterns" onclick="switchTab('patterns')">Padrões</div>
      <div class="tab" data-tab="management" onclick="switchTab('management')">⚙️ Gestão</div>
      <div class="tab" data-tab="api" onclick="switchTab('api')">📡 API</div>
    </div>

    <div class="filters" id="filtersBar">
      <input type="text" class="filter-input" id="searchInput" placeholder="Buscar..." oninput="debounceRefresh()">
      <select class="filter-select" id="severityFilter" onchange="refreshEvents()">
        <option value="">Todas severidades</option>
        <option value="fatal">Fatal</option>
        <option value="error">Error</option>
        <option value="warn">Warn</option>
        <option value="info">Info</option>
        <option value="debug">Debug</option>
      </select>
      <select class="filter-select" id="timeFilter" onchange="refreshEvents()">
        <option value="1">Última hora</option>
        <option value="6">6 horas</option>
        <option value="24" selected>24 horas</option>
        <option value="72">3 dias</option>
        <option value="168">7 dias</option>
        <option value="">Tudo</option>
      </select>
      <label style="font-size:11px;color:var(--text2);display:flex;align-items:center;gap:4px;">
        <input type="checkbox" id="showResolved" onchange="refreshEvents()"> Resolvidos
      </label>
      <div class="actions-bar" id="actionsBar">
        <button class="btn btn-success btn-sm" onclick="resolveSelected()">✅ Resolver Selecionados</button>
      </div>
    </div>

    <div id="content"></div>
    <div class="pagination" id="pagination"></div>
  </div>

  <!-- Resolve Modal -->
  <div class="modal-overlay" id="resolveModal">
    <div class="modal">
      <h3>✅ Marcar como Resolvido</h3>
      <textarea id="resolveNote" placeholder="Nota opcional (ex: Corrigido no commit abc123)..."></textarea>
      <div class="modal-actions">
        <button class="btn" onclick="closeResolveModal()">Cancelar</button>
        <button class="btn btn-success" onclick="confirmResolve()">Resolver</button>
      </div>
    </div>
  </div>

  <div class="toast-container" id="toastContainer"></div>

  <script>
    'use strict';
    const API = window.location.origin;
    let currentTab = 'events';
    let currentPage = 0;
    let selectedInstance = null;
    let debounceTimer = null;
    let pendingResolveIds = [];
    let systemStatus = 'healthy';
    const PAGE_SIZE = 50;

    // ── Init ──────────────────────────────────────────

    async function init() {
      await refreshAll();
      setInterval(refreshAll, 30000);
    }

    async function refreshAll() {
      await Promise.all([refreshStats(), refreshInstances(), refreshContent()]);
      document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString('pt-BR');
      // Update system status
      try {
        const h = await fetchJSON('/api/v1/health/full');
        systemStatus = h.status || 'healthy';
        const badge = document.getElementById('statusBadge');
        badge.textContent = systemStatus.charAt(0).toUpperCase() + systemStatus.slice(1);
        badge.className = 'status-badge ' + systemStatus;
      } catch {}
    }

    // ── Fetch Helper ──────────────────────────────────

    async function fetchJSON(path, opts) {
      const res = await fetch(API + path, opts);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }

    // ── Stats ─────────────────────────────────────────

    async function refreshStats() {
      try {
        const s = await fetchJSON('/api/v1/stats');
        document.getElementById('statsGrid').innerHTML =
          card('green', 'Instâncias Online', s.online_instances || 0, 'de ' + (s.total_instances || 0) + ' total') +
          card('blue', 'Eventos (24h)', fmt(s.events_24h), fmt(s.total_events) + ' total') +
          card('red', 'Erros (24h)', s.errors_24h || 0, (s.unresolved_errors_total || 0) + ' não resolvidos') +
          card('blue', 'Mensagens (24h)', s.messages_24h || 0) +
          card('purple', 'Tool Calls (24h)', s.tool_calls_24h || 0) +
          card('green', 'Resolvidos (24h)', s.resolved_24h || 0);
      } catch (err) { console.error('Stats error:', err); }
    }

    function card(color, label, value, sub) {
      return '<div class="stat-card ' + color + '"><div class="label">' + label + '</div><div class="value">' + value + '</div>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>';
    }

    function fmt(n) { return (n || 0).toLocaleString('pt-BR'); }

    // ── Instances ─────────────────────────────────────

    async function refreshInstances() {
      try {
        const data = await fetchJSON('/api/v1/instances');
        const bar = document.getElementById('instancesBar');

        if (!data.instances || data.instances.length === 0) {
          bar.innerHTML = '<div style="color:var(--text3);font-size:12px;">Nenhuma instância registrada.</div>';
          document.getElementById('instancesTitle').textContent = 'Instâncias (0)';
          return;
        }

        document.getElementById('instancesTitle').textContent = 'Instâncias (' + data.instances.length + ')';

        bar.innerHTML = '<div class="instance-chip ' + (!selectedInstance ? 'active' : '') + '" onclick="selectInstance(null)"><div class="name">Todas</div></div>' +
          data.instances.map(function(i) {
            return '<div class="instance-chip ' + (selectedInstance === i.id ? 'active' : '') + '" onclick="selectInstance(\\'' + i.id + '\\')">' +
              '<div class="dot ' + i.status + '"></div>' +
              '<div><div class="name">' + esc(i.name || 'BollaClaw') + '</div>' +
              '<div class="meta">' + esc(i.provider || '') + ' · ' + (i.errors_24h || 0) + ' erros · ' + (i.events_24h || 0) + ' ev</div></div>' +
              '<div class="delete-btn" onclick="event.stopPropagation();deleteInstance(\\'' + i.id + '\\')">×</div>' +
              '</div>';
          }).join('');
      } catch (err) { console.error('Instances error:', err); }
    }

    function selectInstance(id) {
      selectedInstance = id;
      currentPage = 0;
      refreshInstances();
      refreshContent();
    }

    async function deleteInstance(id) {
      if (!confirm('Deletar instância e todos os seus eventos?')) return;
      try {
        const r = await fetchJSON('/api/v1/instances/' + id, { method: 'DELETE' });
        toast('Instância deletada (' + r.events_deleted + ' eventos removidos)', 'success');
        if (selectedInstance === id) selectedInstance = null;
        refreshAll();
      } catch (err) { toast('Erro ao deletar instância', 'error'); }
    }

    async function cleanupStale() {
      if (!confirm('Deletar instâncias offline há mais de 48h?')) return;
      try {
        const r = await fetchJSON('/api/v1/instances/cleanup-stale', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hours: 48 })
        });
        toast((r.instances_deleted || 0) + ' instâncias removidas', 'success');
        refreshAll();
      } catch (err) { toast('Erro ao limpar instâncias', 'error'); }
    }

    // ── Tabs ──────────────────────────────────────────

    function switchTab(tab) {
      currentTab = tab;
      currentPage = 0;
      document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
      document.querySelector('.tab[data-tab="' + tab + '"]').classList.add('active');

      // Show/hide filters based on tab
      const filtersBar = document.getElementById('filtersBar');
      filtersBar.style.display = (tab === 'management' || tab === 'api') ? 'none' : 'flex';

      refreshContent();
    }

    function refreshContent() {
      if (currentTab === 'patterns') return refreshPatterns();
      if (currentTab === 'management') return refreshManagement();
      if (currentTab === 'api') return showApiDocs();
      refreshEvents();
    }

    // ── Events ────────────────────────────────────────

    async function refreshEvents() {
      const search = document.getElementById('searchInput').value;
      const severity = document.getElementById('severityFilter').value;
      const hours = document.getElementById('timeFilter').value;
      const showRes = document.getElementById('showResolved').checked;

      let typeFilter = '';
      if (currentTab === 'errors') typeFilter = '&severity=error';
      if (currentTab === 'messages') typeFilter = '&type=message';
      if (currentTab === 'tools') typeFilter = '&type=tool_call';

      let url = '/api/v1/events?limit=' + PAGE_SIZE + '&offset=' + (currentPage * PAGE_SIZE);
      if (selectedInstance) url += '&instance_id=' + selectedInstance;
      if (search) url += '&search=' + encodeURIComponent(search);
      if (severity) url += '&severity=' + severity;
      if (!showRes) url += '&resolved=0';
      if (hours) {
        var from = new Date(Date.now() - parseInt(hours) * 3600000).toISOString();
        url += '&from=' + from;
      }
      url += typeFilter;

      try {
        const data = await fetchJSON(url);

        if (!data.events || data.events.length === 0) {
          document.getElementById('content').innerHTML = '<div class="empty-state"><div class="icon">📭</div><div>Nenhum evento encontrado</div></div>';
          document.getElementById('pagination').innerHTML = '';
          return;
        }

        document.getElementById('content').innerHTML =
          '<div class="table-wrap"><table class="events-table"><thead><tr>' +
          '<th><input type="checkbox" onchange="toggleAllCheckboxes(this)"></th>' +
          '<th>Horário</th><th>Instância</th><th>Tipo</th><th>Severidade</th><th>Mensagem</th><th>Duração</th><th></th>' +
          '</tr></thead><tbody>' +
          data.events.map(function(e) {
            var isResolved = e.resolved === 1;
            return '<tr class="' + (isResolved ? 'resolved' : '') + '">' +
              '<td><input type="checkbox" value="' + e.id + '" class="evt-cb" ' + (isResolved ? 'disabled' : '') + '></td>' +
              '<td class="time-cell">' + fmtTime(e.created_at) + '</td>' +
              '<td><span style="font-size:11px">' + esc(e.instance_name || (e.instance_id||'').substring(0,8)) + '</span></td>' +
              '<td><span class="badge badge-type">' + esc(e.type) + '</span></td>' +
              '<td><span class="badge ' + e.severity + '">' + e.severity + '</span></td>' +
              '<td class="msg-cell">' + esc(e.message || '') +
                (isResolved ? '<span class="badge-resolved">✅ Resolvido</span>' : '') +
                (isResolved && e.resolved_note ? '<div style="font-size:10px;color:var(--green);margin-top:2px;">' + esc(e.resolved_note) + '</div>' : '') +
                (e.data && typeof e.data === "object" && Object.keys(e.data).length > 0 ? '<div class="data-preview" onclick="this.classList.toggle(\\'expanded\\')">' + JSON.stringify(e.data, null, 2) + '</div>' : '') +
                (e.stack_trace ? '<div class="stack-trace">' + esc(e.stack_trace) + '</div>' : '') +
              '</td>' +
              '<td class="duration">' + (e.duration_ms ? e.duration_ms + 'ms' : '') + '</td>' +
              '<td>' + (isResolved ? '' : '<button class="resolve-btn" onclick="resolveSingle(' + e.id + ')">✓</button>') + '</td>' +
              '</tr>';
          }).join('') +
          '</tbody></table></div>';

        var totalPages = Math.ceil(data.total / PAGE_SIZE);
        document.getElementById('pagination').innerHTML =
          '<button ' + (currentPage === 0 ? 'disabled' : '') + ' onclick="goPage(' + (currentPage - 1) + ')">← Anterior</button>' +
          '<span class="page-info">Página ' + (currentPage + 1) + ' de ' + totalPages + ' (' + data.total + ' eventos)</span>' +
          '<button ' + (currentPage >= totalPages - 1 ? 'disabled' : '') + ' onclick="goPage(' + (currentPage + 1) + ')">Próxima →</button>';
      } catch (err) {
        console.error('Events error:', err);
        document.getElementById('content').innerHTML = '<div class="empty-state"><div class="icon">⚠️</div><div>Erro ao carregar eventos</div></div>';
      }
    }

    // ── Patterns ──────────────────────────────────────

    async function refreshPatterns() {
      var hours = document.getElementById('timeFilter').value || '24';
      var url = '/api/v1/errors?hours=' + hours + '&limit=200';
      if (selectedInstance) url += '&instance_id=' + selectedInstance;

      try {
        const data = await fetchJSON(url);

        if (!data.patterns || data.patterns.length === 0) {
          document.getElementById('content').innerHTML = '<div class="empty-state"><div class="icon">✅</div><div>Nenhum padrão de erro encontrado. Tudo limpo!</div></div>';
          document.getElementById('pagination').innerHTML = '';
          return;
        }

        document.getElementById('content').innerHTML = '<div class="patterns">' +
          data.patterns.map(function(p) {
            return '<div class="pattern-card"><div style="flex:1"><div class="msg">' + esc(p.message) + '</div>' +
              '<div class="meta-info">' + p.count + 'x · Último: ' + fmtTime(p.last_seen) + '</div></div>' +
              '<div class="pattern-actions"><div class="count">' + p.count + 'x</div>' +
              '<button class="btn btn-success btn-sm" onclick="resolvePattern(\\'' + esc(p.message).replace(/'/g, "\\\\'") + '\\')">✅ Resolver</button></div></div>';
          }).join('') +
          '</div>';
        document.getElementById('pagination').innerHTML = '';
      } catch (err) { console.error('Patterns error:', err); }
    }

    // ── Management Tab ────────────────────────────────

    async function refreshManagement() {
      document.getElementById('pagination').innerHTML = '';
      try {
        const [health, archives] = await Promise.all([
          fetchJSON('/api/v1/health/full'),
          fetchJSON('/api/v1/archives')
        ]);

        document.getElementById('content').innerHTML = '<div class="mgmt-grid">' +
          // DB Card
          '<div class="mgmt-card"><h3>💾 Base de Dados</h3>' +
          '<div class="mgmt-value">' + health.sizeMB + ' MB</div>' +
          '<div class="mgmt-sub">' + fmt(health.totalEvents) + ' eventos · ' + health.unresolvedErrors + ' erros não resolvidos</div>' +
          '<button class="btn btn-primary" onclick="archiveDB()">📦 Arquivar e Compactar</button></div>' +

          // Stale Instances
          '<div class="mgmt-card"><h3>🖥️ Instâncias Stale</h3>' +
          '<div class="mgmt-value">' + health.staleInstances + '</div>' +
          '<div class="mgmt-sub">' + health.totalInstances + ' total · ' + health.onlineInstances + ' online</div>' +
          '<button class="btn btn-danger" onclick="cleanupStale()">🧹 Limpar Instâncias Stale</button></div>' +

          // Recommendations
          '<div class="mgmt-card"><h3>📋 Recomendações</h3>' +
          (health.recommendations && health.recommendations.length > 0
            ? health.recommendations.map(function(r) { return '<div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;color:var(--text2);">• ' + esc(r) + '</div>'; }).join('')
            : '<div style="color:var(--green);font-size:13px;">✅ Tudo ok — nenhuma recomendação</div>') +
          '</div>' +

          // Archives
          '<div class="mgmt-card"><h3>📦 Archives (' + (archives.count || 0) + ')</h3>' +
          (archives.archives && archives.archives.length > 0
            ? '<div class="archive-list">' + archives.archives.map(function(a) {
                return '<div class="archive-item"><span class="name">' + esc(a.name) + '</span><span class="size">' + a.sizeMB + ' MB</span></div>';
              }).join('') + '</div>'
            : '<div class="mgmt-sub">Nenhum archive criado ainda</div>') +
          '</div>' +

          '</div>';
      } catch (err) {
        console.error('Management error:', err);
        document.getElementById('content').innerHTML = '<div class="empty-state"><div class="icon">⚠️</div><div>Erro ao carregar gestão</div></div>';
      }
    }

    async function archiveDB() {
      if (!confirm('Arquivar eventos resolvidos e compactar DB?')) return;
      try {
        const r = await fetchJSON('/api/v1/archive', { method: 'POST' });
        toast('Arquivo criado: ' + r.archivedTo + ' (' + r.dbSizeBefore + 'MB → ' + r.dbSizeAfter + 'MB)', 'success');
        refreshManagement();
      } catch (err) { toast('Erro ao arquivar', 'error'); }
    }

    // ── API Docs Tab ──────────────────────────────────

    function showApiDocs() {
      document.getElementById('pagination').innerHTML = '';
      var endpoints = [
        { m: 'POST', p: '/api/v1/register', d: 'Registrar/atualizar instância BollaClaw' },
        { m: 'POST', p: '/api/v1/events', d: 'Enviar batch de eventos de telemetria' },
        { m: 'POST', p: '/api/v1/metrics', d: 'Enviar snapshot de métricas' },
        { m: 'GET', p: '/api/v1/events', d: 'Consultar eventos (filtros: instance_id, type, severity, search, from, to, resolved)' },
        { m: 'GET', p: '/api/v1/errors', d: 'Erros agrupados por padrão (filtros: hours, instance_id, include_resolved)' },
        { m: 'GET', p: '/api/v1/instances', d: 'Listar todas as instâncias com contagens' },
        { m: 'GET', p: '/api/v1/metrics', d: 'Consultar métricas (filtros: hours, instance_id)' },
        { m: 'GET', p: '/api/v1/stats', d: 'Stats rápidas (24h)' },
        { m: 'GET', p: '/api/v1/health/full', d: 'Saúde completa (status, recomendações, DB size)' },
        { m: 'GET', p: '/api/v1/archives', d: 'Listar arquivos de backup' },
        { m: 'PUT', p: '/api/v1/events/:id/resolve', d: 'Marcar evento como resolvido (body: { note })' },
        { m: 'PUT', p: '/api/v1/events/resolve-batch', d: 'Resolver vários eventos (body: { event_ids, note })' },
        { m: 'PUT', p: '/api/v1/events/resolve-pattern', d: 'Resolver por padrão de mensagem (body: { message_pattern, note })' },
        { m: 'PUT', p: '/api/v1/instances/:id/rename', d: 'Renomear instância (body: { name })' },
        { m: 'DELETE', p: '/api/v1/events', d: 'Deletar eventos (filtros: instance_id, before, type)' },
        { m: 'DELETE', p: '/api/v1/instances/:id', d: 'Deletar instância + cascade (eventos, métricas)' },
        { m: 'DELETE', p: '/api/v1/instances/cleanup-stale', d: 'Limpar instâncias offline > Xh (body: { hours, name_pattern })' },
        { m: 'POST', p: '/api/v1/archive', d: 'Arquivar DB e compactar' },
        { m: 'POST', p: '/api/v1/cleanup', d: 'Cleanup manual (age + count)' },
      ];

      document.getElementById('content').innerHTML = '<div class="api-docs">' +
        endpoints.map(function(e) {
          return '<div class="api-endpoint"><span class="api-method ' + e.m.toLowerCase() + '">' + e.m + '</span>' +
            '<span class="api-path">' + e.p + '</span><div class="api-desc">' + e.d + '</div></div>';
        }).join('') +
        '</div>';
    }

    // ── Resolve Actions ───────────────────────────────

    function toggleAllCheckboxes(master) {
      document.querySelectorAll('.evt-cb:not(:disabled)').forEach(function(cb) { cb.checked = master.checked; });
    }

    function getSelectedIds() {
      return Array.from(document.querySelectorAll('.evt-cb:checked')).map(function(cb) { return parseInt(cb.value); });
    }

    function resolveSelected() {
      var ids = getSelectedIds();
      if (ids.length === 0) return toast('Selecione pelo menos um evento', 'error');
      pendingResolveIds = ids;
      document.getElementById('resolveModal').classList.add('open');
      document.getElementById('resolveNote').focus();
    }

    function resolveSingle(id) {
      pendingResolveIds = [id];
      document.getElementById('resolveModal').classList.add('open');
      document.getElementById('resolveNote').focus();
    }

    function closeResolveModal() {
      document.getElementById('resolveModal').classList.remove('open');
      document.getElementById('resolveNote').value = '';
      pendingResolveIds = [];
    }

    async function confirmResolve() {
      var note = document.getElementById('resolveNote').value.trim();
      try {
        var r = await fetchJSON('/api/v1/events/resolve-batch', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event_ids: pendingResolveIds, note: note || null })
        });
        toast(r.resolved + ' evento(s) resolvido(s)', 'success');
        closeResolveModal();
        refreshAll();
      } catch (err) { toast('Erro ao resolver', 'error'); }
    }

    async function resolvePattern(pattern) {
      var note = prompt('Nota de resolução (opcional):');
      if (note === null) return;
      try {
        var r = await fetchJSON('/api/v1/events/resolve-pattern', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message_pattern: pattern, note: note || null })
        });
        toast(r.resolved + ' eventos resolvidos por padrão', 'success');
        refreshAll();
      } catch (err) { toast('Erro ao resolver por padrão', 'error'); }
    }

    // ── Helpers ────────────────────────────────────────

    function goPage(page) { currentPage = page; refreshEvents(); window.scrollTo(0, 300); }
    function debounceRefresh() { clearTimeout(debounceTimer); debounceTimer = setTimeout(refreshEvents, 300); }

    function fmtTime(iso) {
      if (!iso) return '';
      var d = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
      return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    function esc(str) {
      if (!str) return '';
      return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function toast(msg, type) {
      var el = document.createElement('div');
      el.className = 'toast ' + (type || '');
      el.textContent = msg;
      document.getElementById('toastContainer').appendChild(el);
      setTimeout(function() { el.remove(); }, 4000);
    }

    init();
  </script>
</body>
</html>`;
}
