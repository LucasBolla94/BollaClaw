/**
 * Returns the full dashboard HTML as a string.
 * Single-file dashboard with embedded CSS/JS — no build step needed.
 */
export function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BollaWatch - Telemetry Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #0f1117; --bg2: #1a1d27; --bg3: #242836;
      --text: #e1e4eb; --text2: #8b8fa3; --text3: #5c6078;
      --accent: #6366f1; --accent2: #818cf8;
      --green: #22c55e; --red: #ef4444; --yellow: #eab308; --blue: #3b82f6;
      --border: #2d3148;
    }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }
    a { color: var(--accent2); text-decoration: none; }

    /* Layout */
    .header { background: var(--bg2); border-bottom: 1px solid var(--border); padding: 16px 24px; display: flex; justify-content: space-between; align-items: center; }
    .header h1 { font-size: 20px; font-weight: 600; }
    .header h1 span { color: var(--accent2); }
    .header-right { display: flex; gap: 12px; align-items: center; }
    .refresh-btn { background: var(--bg3); border: 1px solid var(--border); color: var(--text); padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 13px; }
    .refresh-btn:hover { background: var(--accent); }
    .auto-refresh { font-size: 12px; color: var(--text2); }

    .container { max-width: 1400px; margin: 0 auto; padding: 20px; }

    /* Stats cards */
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .stat-card { background: var(--bg2); border: 1px solid var(--border); border-radius: 10px; padding: 18px; }
    .stat-card .label { font-size: 12px; color: var(--text2); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
    .stat-card .value { font-size: 28px; font-weight: 700; }
    .stat-card .sub { font-size: 12px; color: var(--text3); margin-top: 4px; }
    .stat-card.error .value { color: var(--red); }
    .stat-card.success .value { color: var(--green); }
    .stat-card.info .value { color: var(--blue); }

    /* Instances */
    .instances-bar { display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }
    .instance-chip { background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 10px 16px; display: flex; align-items: center; gap: 8px; cursor: pointer; transition: all .15s; }
    .instance-chip:hover { border-color: var(--accent); }
    .instance-chip.active { border-color: var(--accent); background: rgba(99,102,241,0.1); }
    .instance-chip .dot { width: 8px; height: 8px; border-radius: 50%; }
    .instance-chip .dot.online { background: var(--green); }
    .instance-chip .dot.offline { background: var(--red); }
    .instance-chip .name { font-size: 13px; font-weight: 500; }
    .instance-chip .meta { font-size: 11px; color: var(--text2); }

    /* Tabs */
    .tabs { display: flex; gap: 4px; margin-bottom: 20px; background: var(--bg2); padding: 4px; border-radius: 8px; width: fit-content; }
    .tab { padding: 8px 18px; border-radius: 6px; cursor: pointer; font-size: 13px; color: var(--text2); transition: all .15s; }
    .tab:hover { color: var(--text); }
    .tab.active { background: var(--accent); color: white; }

    /* Table */
    .events-table { width: 100%; border-collapse: collapse; }
    .events-table th { text-align: left; padding: 10px 14px; font-size: 11px; color: var(--text2); text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--border); background: var(--bg2); position: sticky; top: 0; }
    .events-table td { padding: 10px 14px; font-size: 13px; border-bottom: 1px solid var(--border); vertical-align: top; max-width: 400px; }
    .events-table tr:hover { background: rgba(99,102,241,0.05); }

    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 500; }
    .badge.error, .badge.fatal { background: rgba(239,68,68,0.15); color: var(--red); }
    .badge.warn { background: rgba(234,179,8,0.15); color: var(--yellow); }
    .badge.info { background: rgba(59,130,246,0.15); color: var(--blue); }
    .badge.debug { background: rgba(99,102,241,0.15); color: var(--accent2); }
    .badge-type { background: var(--bg3); color: var(--text2); }

    .message-cell { word-break: break-word; }
    .data-preview { font-size: 11px; color: var(--text3); margin-top: 4px; font-family: monospace; max-height: 60px; overflow: hidden; cursor: pointer; }
    .data-preview.expanded { max-height: none; }
    .stack-trace { font-size: 11px; color: var(--red); font-family: monospace; white-space: pre-wrap; max-height: 80px; overflow: auto; margin-top: 4px; padding: 6px; background: rgba(239,68,68,0.05); border-radius: 4px; }

    .time-cell { white-space: nowrap; font-size: 12px; color: var(--text2); }
    .duration { font-size: 11px; color: var(--text3); }

    /* Filters */
    .filters { display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; align-items: center; }
    .filter-input { background: var(--bg2); border: 1px solid var(--border); color: var(--text); padding: 7px 12px; border-radius: 6px; font-size: 13px; }
    .filter-input:focus { outline: none; border-color: var(--accent); }
    .filter-select { background: var(--bg2); border: 1px solid var(--border); color: var(--text); padding: 7px 12px; border-radius: 6px; font-size: 13px; }

    /* Error patterns */
    .patterns { display: grid; gap: 12px; }
    .pattern-card { background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 14px; }
    .pattern-card .count { font-size: 24px; font-weight: 700; color: var(--red); float: right; }
    .pattern-card .msg { font-family: monospace; font-size: 13px; margin-bottom: 6px; }
    .pattern-card .instances-list { font-size: 11px; color: var(--text2); }

    .empty-state { text-align: center; padding: 60px 20px; color: var(--text3); }
    .empty-state .icon { font-size: 48px; margin-bottom: 12px; }

    /* Pagination */
    .pagination { display: flex; justify-content: center; gap: 8px; margin-top: 20px; align-items: center; }
    .pagination button { background: var(--bg2); border: 1px solid var(--border); color: var(--text); padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 13px; }
    .pagination button:hover { border-color: var(--accent); }
    .pagination button:disabled { opacity: 0.4; cursor: default; }
    .pagination .page-info { font-size: 13px; color: var(--text2); }

    @media (max-width: 768px) {
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
      .container { padding: 12px; }
      .events-table td, .events-table th { padding: 8px; font-size: 12px; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>👁️ <span>Bolla</span>Watch</h1>
    <div class="header-right">
      <span class="auto-refresh" id="lastUpdate"></span>
      <button class="refresh-btn" onclick="refreshAll()">↻ Atualizar</button>
    </div>
  </div>

  <div class="container">
    <!-- Stats Cards -->
    <div class="stats-grid" id="statsGrid"></div>

    <!-- Instances -->
    <div class="instances-bar" id="instancesBar"></div>

    <!-- Tabs -->
    <div class="tabs">
      <div class="tab active" data-tab="events" onclick="switchTab('events')">Todos Eventos</div>
      <div class="tab" data-tab="errors" onclick="switchTab('errors')">Erros</div>
      <div class="tab" data-tab="messages" onclick="switchTab('messages')">Mensagens</div>
      <div class="tab" data-tab="tools" onclick="switchTab('tools')">Tool Calls</div>
      <div class="tab" data-tab="patterns" onclick="switchTab('patterns')">Padrões</div>
    </div>

    <!-- Filters -->
    <div class="filters">
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
    </div>

    <!-- Content -->
    <div id="content"></div>
    <div class="pagination" id="pagination"></div>
  </div>

  <script>
    const API = window.location.origin;
    let currentTab = 'events';
    let currentPage = 0;
    let selectedInstance = null;
    let debounceTimer = null;
    const PAGE_SIZE = 50;

    // ── Init ─────────────────────────────────────────────
    async function init() {
      await refreshAll();
      // Auto-refresh every 30s
      setInterval(refreshAll, 30000);
    }

    async function refreshAll() {
      await Promise.all([refreshStats(), refreshInstances(), refreshEvents()]);
      document.getElementById('lastUpdate').textContent = 'Atualizado: ' + new Date().toLocaleTimeString('pt-BR');
    }

    // ── Stats ────────────────────────────────────────────
    async function refreshStats() {
      try {
        const res = await fetch(API + '/api/v1/stats');
        const stats = await res.json();
        document.getElementById('statsGrid').innerHTML = \`
          <div class="stat-card success">
            <div class="label">Instâncias Online</div>
            <div class="value">\${stats.online_instances || 0}</div>
            <div class="sub">de \${stats.total_instances || 0} total</div>
          </div>
          <div class="stat-card info">
            <div class="label">Eventos (24h)</div>
            <div class="value">\${(stats.events_24h || 0).toLocaleString()}</div>
            <div class="sub">\${(stats.total_events || 0).toLocaleString()} total</div>
          </div>
          <div class="stat-card error">
            <div class="label">Erros (24h)</div>
            <div class="value">\${stats.errors_24h || 0}</div>
          </div>
          <div class="stat-card info">
            <div class="label">Mensagens (24h)</div>
            <div class="value">\${stats.messages_24h || 0}</div>
          </div>
          <div class="stat-card">
            <div class="label">Tool Calls (24h)</div>
            <div class="value">\${stats.tool_calls_24h || 0}</div>
          </div>
        \`;
      } catch (err) {
        console.error('Stats error:', err);
      }
    }

    // ── Instances ────────────────────────────────────────
    async function refreshInstances() {
      try {
        const res = await fetch(API + '/api/v1/instances');
        const data = await res.json();
        const bar = document.getElementById('instancesBar');

        if (!data.instances || data.instances.length === 0) {
          bar.innerHTML = '<div style="color:var(--text3);font-size:13px;">Nenhuma instância registrada ainda.</div>';
          return;
        }

        bar.innerHTML = \`
          <div class="instance-chip \${!selectedInstance ? 'active' : ''}" onclick="selectInstance(null)">
            <div class="name">Todas</div>
          </div>
          \${data.instances.map(i => \`
            <div class="instance-chip \${selectedInstance === i.id ? 'active' : ''}" onclick="selectInstance('\${i.id}')">
              <div class="dot \${i.status}"></div>
              <div>
                <div class="name">\${i.name || 'BollaClaw'}</div>
                <div class="meta">\${i.provider || ''} · \${i.errors_24h || 0} erros · \${i.events_24h || 0} eventos</div>
              </div>
            </div>
          \`).join('')}
        \`;
      } catch (err) {
        console.error('Instances error:', err);
      }
    }

    function selectInstance(id) {
      selectedInstance = id;
      currentPage = 0;
      refreshInstances();
      refreshEvents();
    }

    // ── Tabs ─────────────────────────────────────────────
    function switchTab(tab) {
      currentTab = tab;
      currentPage = 0;
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelector(\`.tab[data-tab="\${tab}"]\`).classList.add('active');
      refreshEvents();
    }

    // ── Events ───────────────────────────────────────────
    async function refreshEvents() {
      if (currentTab === 'patterns') return refreshPatterns();

      const search = document.getElementById('searchInput').value;
      const severity = document.getElementById('severityFilter').value;
      const hours = document.getElementById('timeFilter').value;

      let typeFilter = '';
      if (currentTab === 'errors') typeFilter = '&severity=error';
      if (currentTab === 'messages') typeFilter = '&type=message';
      if (currentTab === 'tools') typeFilter = '&type=tool_call';

      let url = \`\${API}/api/v1/events?limit=\${PAGE_SIZE}&offset=\${currentPage * PAGE_SIZE}\`;
      if (selectedInstance) url += \`&instance_id=\${selectedInstance}\`;
      if (search) url += \`&search=\${encodeURIComponent(search)}\`;
      if (severity) url += \`&severity=\${severity}\`;
      if (hours) {
        const from = new Date(Date.now() - parseInt(hours) * 3600000).toISOString();
        url += \`&from=\${from}\`;
      }
      url += typeFilter;

      try {
        const res = await fetch(url);
        const data = await res.json();

        if (!data.events || data.events.length === 0) {
          document.getElementById('content').innerHTML = \`
            <div class="empty-state">
              <div class="icon">📭</div>
              <div>Nenhum evento encontrado</div>
            </div>\`;
          document.getElementById('pagination').innerHTML = '';
          return;
        }

        document.getElementById('content').innerHTML = \`
          <div style="overflow-x:auto;">
          <table class="events-table">
            <thead>
              <tr>
                <th>Horário</th>
                <th>Instância</th>
                <th>Tipo</th>
                <th>Severidade</th>
                <th>Mensagem</th>
                <th>Duração</th>
              </tr>
            </thead>
            <tbody>
              \${data.events.map(e => \`
                <tr>
                  <td class="time-cell">\${formatTime(e.created_at)}</td>
                  <td><span style="font-size:12px">\${e.instance_name || e.instance_id.substring(0,8)}</span></td>
                  <td><span class="badge badge-type">\${e.type}</span></td>
                  <td><span class="badge \${e.severity}">\${e.severity}</span></td>
                  <td class="message-cell">
                    \${escapeHtml(e.message || '')}
                    \${e.data && Object.keys(e.data).length > 0 ? \`<div class="data-preview" onclick="this.classList.toggle('expanded')">\${JSON.stringify(e.data, null, 2)}</div>\` : ''}
                    \${e.stack_trace ? \`<div class="stack-trace">\${escapeHtml(e.stack_trace)}</div>\` : ''}
                  </td>
                  <td class="duration">\${e.duration_ms ? e.duration_ms + 'ms' : ''}</td>
                </tr>
              \`).join('')}
            </tbody>
          </table>
          </div>
        \`;

        // Pagination
        const totalPages = Math.ceil(data.total / PAGE_SIZE);
        document.getElementById('pagination').innerHTML = \`
          <button \${currentPage === 0 ? 'disabled' : ''} onclick="goPage(\${currentPage - 1})">← Anterior</button>
          <span class="page-info">Página \${currentPage + 1} de \${totalPages} (\${data.total} eventos)</span>
          <button \${currentPage >= totalPages - 1 ? 'disabled' : ''} onclick="goPage(\${currentPage + 1})">Próxima →</button>
        \`;
      } catch (err) {
        console.error('Events error:', err);
        document.getElementById('content').innerHTML = '<div class="empty-state"><div class="icon">⚠️</div><div>Erro ao carregar eventos</div></div>';
      }
    }

    // ── Error Patterns ───────────────────────────────────
    async function refreshPatterns() {
      const hours = document.getElementById('timeFilter').value || '24';
      let url = \`\${API}/api/v1/errors?hours=\${hours}&limit=200\`;
      if (selectedInstance) url += \`&instance_id=\${selectedInstance}\`;

      try {
        const res = await fetch(url);
        const data = await res.json();

        if (!data.patterns || data.patterns.length === 0) {
          document.getElementById('content').innerHTML = '<div class="empty-state"><div class="icon">✅</div><div>Nenhum padrão de erro encontrado. Tudo limpo!</div></div>';
          document.getElementById('pagination').innerHTML = '';
          return;
        }

        document.getElementById('content').innerHTML = \`
          <div class="patterns">
            \${data.patterns.map(p => \`
              <div class="pattern-card">
                <div class="count">\${p.count}x</div>
                <div class="msg">\${escapeHtml(p.message)}</div>
                <div class="instances-list">Instâncias: \${p.instances.join(', ')} · Último: \${formatTime(p.last_seen)}</div>
              </div>
            \`).join('')}
          </div>
        \`;
        document.getElementById('pagination').innerHTML = '';
      } catch (err) {
        console.error('Patterns error:', err);
      }
    }

    // ── Helpers ──────────────────────────────────────────
    function goPage(page) { currentPage = page; refreshEvents(); window.scrollTo(0, 300); }

    function debounceRefresh() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(refreshEvents, 300);
    }

    function formatTime(iso) {
      if (!iso) return '';
      const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
      return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    function escapeHtml(str) {
      if (!str) return '';
      return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    init();
  </script>
</body>
</html>`;
}
