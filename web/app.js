const $ = (selector) => document.querySelector(selector);

const elements = {
  total: $('#totalExecutions'),
  today: $('#executionsToday'),
  active: $('#activeSessions'),
  body: $('#recentBody'),
  status: $('#connectionStatus'),
  updated: $('#lastUpdated'),
  refresh: $('#refreshButton')
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds) || 0);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return payload.data;
}

function setOnline(online) {
  elements.status.classList.toggle('online', online);
  elements.status.querySelector('span:last-child').textContent = online ? 'Online' : 'Offline';
}

function renderRecent(rows) {
  if (!rows.length) {
    elements.body.innerHTML = '<tr><td colspan="6" class="empty">No active sessions.</td></tr>';
    return;
  }

  elements.body.innerHTML = rows.map((row) => {
    const badge = '<span class="badge active">● Active</span>';

    return `
      <tr>
        <td>${badge}</td>
        <td>${escapeHtml(row.executor)}</td>
        <td>${escapeHtml(row.script_version)}</td>
        <td>${escapeHtml(row.place_id)}</td>
        <td>${escapeHtml(formatDate(row.started_at))}</td>
        <td>${escapeHtml(formatDuration(row.liveDurationSeconds))}</td>
      </tr>
    `;
  }).join('');
}

async function refresh() {
  try {
    const [stats, recent] = await Promise.all([
      fetchJson('/api/v1/stats'),
      fetchJson('/api/v1/recent')
    ]);

    elements.total.textContent = Number(stats.totalExecutions).toLocaleString();
    elements.today.textContent = Number(stats.executionsToday).toLocaleString();
    elements.active.textContent = Number(stats.activeSessions).toLocaleString();
    renderRecent(recent);
    elements.updated.textContent = `Updated ${new Date().toLocaleTimeString()}`;
    setOnline(true);
  } catch (error) {
    console.error(error);
    setOnline(false);
    elements.updated.textContent = 'Unable to load analytics';
  }
}

elements.refresh.addEventListener('click', refresh);
refresh();
setInterval(refresh, 15000);
