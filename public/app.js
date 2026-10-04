const state = {
  token: localStorage.getItem('newtonite-token') || '',
  user: null,
  workItems: [],
  users: [],
  selectedId: null,
  filters: { team: '', status: '', priority: '', search: '', assigneeId: '' },
  dashboard: null
};

const app = document.getElementById('app');

function qs(selector, parent = document) {
  return parent.querySelector(selector);
}

function safeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function render() {
  if (!state.token) {
    app.innerHTML = `
      <div class="container">
        <div class="topbar">
          <div class="brand">Newtonite Operations Console</div>
        </div>
        <div class="login-shell">
          <h2>Sign in</h2>
          <p>Use one of the seeded challenge accounts to explore the operations board.</p>
          <div class="login-form">
            <div class="field">
              <label for="email">Email</label>
              <input id="email" type="email" value="alice@newtonite.com" />
            </div>
            <div class="field">
              <label for="password">Password</label>
              <input id="password" type="password" value="secret123" />
            </div>
            <button id="login-btn" class="primary-btn">Log in</button>
            <div id="login-message" class="error"></div>
          </div>
        </div>
      </div>
    `;
    qs('#login-btn').addEventListener('click', submitLogin);
    return;
  }

  app.innerHTML = `
    <div class="container">
      <div class="topbar">
        <div>
          <div class="brand">Newtonite Operations Console</div>
          <div class="subtitle">Keep urgent work visible, owned, and moving.</div>
        </div>
        <div class="topbar-actions">
          ${state.user?.role !== 'viewer' ? '<button id="new-item-btn" class="primary-btn">+ New work item</button>' : ''}
          <div class="user-chip">${safeHtml(state.user?.name || 'User')} · ${safeHtml(state.user?.role || '')}</div>
        </div>
      </div>

      <div class="dashboard-shell">
        <div class="section-heading">
          <div>
            <div class="eyebrow">Operations desk</div>
            <h1>Work requiring attention</h1>
          </div>
          <button id="refresh-btn" class="ghost-btn">Refresh board</button>
        </div>
        <div class="view-switcher" role="tablist" aria-label="Work views">
          <button class="view-tab active" data-view="all">All work</button>
          <button class="view-tab" data-view="mine">My queue</button>
          <button class="view-tab" data-view="approval">Needs approval</button>
        </div>
        <div class="toolbar">
          <div class="field">
            <label>Search</label>
            <input id="search" type="text" placeholder="Search work items" value="${safeHtml(state.filters.search)}" />
          </div>
          <div class="field">
            <label>Status</label>
            <select id="status-filter">
              <option value="">All statuses</option>
              <option value="new">New</option>
              <option value="investigating">Investigating</option>
              <option value="waiting_approval">Waiting approval</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          <div class="field">
            <label>Priority</label>
            <select id="priority-filter">
              <option value="">All priorities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <button id="logout-btn" class="ghost-btn">Log out</button>
        </div>

        <div class="grid" id="metrics"></div>
        <div class="layout">
          <div>
            <div class="list-heading"><strong id="list-count">Work items</strong><small>Sorted by urgency and recent activity</small></div>
            <div id="list"></div>
          </div>
          <div id="detail"></div>
        </div>
      </div>
    </div>
    <div id="modal-root"></div>
  `;

  qs('#search').addEventListener('input', (event) => {
    state.filters.search = event.target.value;
    loadWorkItems();
  });
  qs('#status-filter').value = state.filters.status;
  qs('#priority-filter').value = state.filters.priority;
  qs('#status-filter').addEventListener('change', (event) => {
    state.filters.status = event.target.value;
    loadWorkItems();
  });
  qs('#priority-filter').addEventListener('change', (event) => {
    state.filters.priority = event.target.value;
    loadWorkItems();
  });
  qs('#logout-btn').addEventListener('click', () => {
    localStorage.removeItem('newtonite-token');
    state.token = '';
    state.user = null;
    render();
  });
  qs('#refresh-btn').addEventListener('click', refreshBoard);
  qs('#new-item-btn')?.addEventListener('click', openCreateModal);
  qs('.view-switcher').querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => switchView(button.dataset.view));
  });

  loadDashboard();
  loadWorkItems();
}

async function submitLogin() {
  const email = qs('#email').value;
  const password = qs('#password').value;
  const message = qs('#login-message');
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Login failed');
    }
    localStorage.setItem('newtonite-token', data.token);
    state.token = data.token;
    state.user = data.user;
    await loadUsers();
    render();
  } catch (error) {
    message.textContent = error.message;
  }
}

async function loadUsers() {
  if (!state.token) return;
  const response = await fetch('/api/users', { headers: { Authorization: `Bearer ${state.token}` } });
  if (!response.ok) return;
  const payload = await response.json();
  state.users = payload.users || [];
}

async function refreshBoard() {
  const button = qs('#refresh-btn');
  if (button) button.textContent = 'Refreshing...';
  await Promise.all([loadDashboard(), loadWorkItems()]);
  if (button) button.textContent = 'Refresh board';
}

function switchView(view) {
  state.filters.assigneeId = view === 'mine' ? state.user.id : '';
  state.filters.status = view === 'approval' ? 'waiting_approval' : '';
  qs('.view-switcher').querySelectorAll('[data-view]').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view);
  });
  qs('#status-filter').value = state.filters.status;
  loadWorkItems();
}

async function loadUser() {
  if (!state.token) return;

  const response = await fetch('/api/me', {
    headers: { Authorization: `Bearer ${state.token}` }
  });
  if (!response.ok) {
    localStorage.removeItem('newtonite-token');
    state.token = '';
    state.user = null;
    render();
    return;
  }
  const data = await response.json();
  state.user = data.user;
}

async function loadDashboard() {
  const response = await fetch('/api/dashboard', { headers: { Authorization: `Bearer ${state.token}` } });
  if (!response.ok) return;
  const data = await response.json();
  state.dashboard = data;
  const metrics = qs('#metrics');
  metrics.innerHTML = `
    <div class="card">
      <div class="metric-label">Open work</div>
      <div class="metric-value">${data.counts.total}</div>
    </div>
    <div class="card">
      <div class="metric-label">Critical</div>
      <div class="metric-value">${data.counts.critical}</div>
    </div>
    <div class="card">
      <div class="metric-label">Requires approval</div>
      <div class="metric-value">${data.counts.waiting_approval}</div>
    </div>
    <div class="card">
      <div class="metric-label">My items</div>
      <div class="metric-value">${data.counts.my_items}</div>
    </div>
  `;
}

async function loadWorkItems() {
  const query = new URLSearchParams({
    status: state.filters.status,
    priority: state.filters.priority,
    search: state.filters.search,
    assigneeId: state.filters.assigneeId,
    limit: '50'
  });

  const response = await fetch(`/api/work-items?${query.toString()}`, { headers: { Authorization: `Bearer ${state.token}` } });
  if (!response.ok) return;
  const payload = await response.json();
  state.workItems = payload.items || [];
  const count = qs('#list-count');
  if (count) count.textContent = `${payload.total} work item${payload.total === 1 ? '' : 's'}`;
  if (!state.selectedId && state.workItems.length) state.selectedId = state.workItems[0].id;
  renderWorkItems();
  if (state.selectedId) {
    const item = state.workItems.find((entry) => entry.id === state.selectedId) || state.workItems[0];
    renderDetail(item);
  }
}

function renderWorkItems() {
  const list = qs('#list');
  if (!list) return;
  if (!state.workItems.length) {
    list.innerHTML = '<div class="card">No work items match the current filter.</div>';
    return;
  }

  const rows = state.workItems.map((item) => `
    <div class="card" data-id="${item.id}" style="cursor:pointer; margin-bottom:12px; ${item.id === state.selectedId ? 'border-color: var(--primary);' : ''}">
      <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start;">
        <div>
          <strong>${safeHtml(item.title)}</strong>
          <div><small>${safeHtml(item.team)} · ${safeHtml(userName(item.owner_id))}</small></div>
        </div>
        <span class="priority-badge priority-${safeHtml(item.priority)}">${safeHtml(item.priority)}</span>
      </div>
      <div class="meta-row">
        <span class="status-badge status-${safeHtml(item.status)}">${safeHtml(item.status.replace(/_/g, ' '))}</span>
        <span class="meta-chip">Version ${safeHtml(item.version)}</span>
      </div>
      <div>${safeHtml((item.description || '').slice(0, 120))}${(item.description || '').length > 120 ? '…' : ''}</div>
    </div>
  `).join('');

  list.innerHTML = rows;
  list.querySelectorAll('[data-id]').forEach((node) => {
    node.addEventListener('click', () => {
      state.selectedId = node.dataset.id;
      const item = state.workItems.find((entry) => entry.id === state.selectedId);
      renderWorkItems();
      renderDetail(item);
    });
  });
}

async function renderDetail(item) {
  const panel = qs('#detail');
  if (!panel || !item) return;

  const response = await fetch(`/api/work-items/${item.id}`, {
    headers: { Authorization: `Bearer ${state.token}` }
  });
  if (!response.ok) return;
  const payload = await response.json();
  const data = payload.item;
  const ownerName = data.owner_id || 'unassigned';

  panel.innerHTML = `
    <div class="detail-panel">
      <h3>${safeHtml(data.title)}</h3>
      <div class="meta-row">
        <span class="status-badge status-${safeHtml(data.status)}">${safeHtml(data.status.replace(/_/g, ' '))}</span>
        <span class="priority-badge priority-${safeHtml(data.priority)}">${safeHtml(data.priority)}</span>
      </div>
      <p>${safeHtml(data.description)}</p>
      <div class="meta-row">
        <span class="meta-chip">Team: ${safeHtml(data.team)}</span>
        <span class="meta-chip">Owner: ${safeHtml(userName(ownerName))}</span>
        <span class="meta-chip">Version: ${safeHtml(data.version)}</span>
      </div>
      <div class="toolbar">
        <button class="ghost-btn" data-action="status" data-value="investigating">Investigating</button>
        <button class="ghost-btn" data-action="status" data-value="waiting_approval">Waiting approval</button>
        <button class="ghost-btn" data-action="status" data-value="closed">Close</button>
      </div>
      <div class="field">
        <label>Comment</label>
        <textarea id="new-comment"></textarea>
      </div>
      <button id="comment-btn" class="primary-btn">Add comment</button>
      <div id="detail-message"></div>
      <h4>History</h4>
      <div class="log-list">
        ${(data.history || []).slice(0, 8).map((entry) => `
          <div class="log-item">
            <div><strong>${safeHtml(entry.action)}</strong> · ${safeHtml(entry.created_at.slice(0, 19).replace('T', ' '))}</div>
            <div>${safeHtml(entry.details)}</div>
          </div>
        `).join('') || '<div class="log-item">No history yet.</div>'}
      </div>
    </div>
  `;

  panel.querySelectorAll('[data-action="status"]').forEach((button) => {
    button.addEventListener('click', () => updateStatus(data.id, button.dataset.value, data.version));
  });
  panel.querySelector('#comment-btn').addEventListener('click', () => addCommentToItem(data.id));
}

function userName(id) {
  return state.users.find((user) => user.id === id)?.name || id || 'Unassigned';
}

function openCreateModal() {
  const teamOptions = [...new Set(state.users.map((user) => user.team))].map((team) => `<option value="${safeHtml(team)}">${safeHtml(team)}</option>`).join('');
  const ownerOptions = state.users.map((user) => `<option value="${safeHtml(user.id)}">${safeHtml(user.name)} · ${safeHtml(user.team)}</option>`).join('');
  qs('#modal-root').innerHTML = `
    <div class="modal-backdrop" id="create-modal">
      <form class="modal" id="create-form">
        <div class="modal-heading"><div><div class="eyebrow">New request</div><h2>Create work item</h2></div><button type="button" class="icon-btn" id="close-modal" aria-label="Close">×</button></div>
        <div class="field"><label for="create-title">Title</label><input id="create-title" required placeholder="What needs attention?" /></div>
        <div class="field"><label for="create-description">Context</label><textarea id="create-description" required placeholder="Capture the situation, impact, and next step."></textarea></div>
        <div class="form-grid">
          <div class="field"><label for="create-team">Team</label><select id="create-team" required>${teamOptions}</select></div>
          <div class="field"><label for="create-priority">Priority</label><select id="create-priority"><option value="critical">Critical</option><option value="high">High</option><option value="medium" selected>Medium</option><option value="low">Low</option></select></div>
        </div>
        <div class="field"><label for="create-owner">Owner</label><select id="create-owner">${ownerOptions}</select></div>
        <div id="create-message"></div>
        <div class="modal-actions"><button type="button" class="ghost-btn" id="cancel-modal">Cancel</button><button class="primary-btn" type="submit">Create item</button></div>
      </form>
    </div>
  `;
  qs('#close-modal').addEventListener('click', closeCreateModal);
  qs('#cancel-modal').addEventListener('click', closeCreateModal);
  qs('#create-form').addEventListener('submit', submitCreateItem);
  qs('#create-title').focus();
}

function closeCreateModal() {
  qs('#modal-root').innerHTML = '';
}

async function submitCreateItem(event) {
  event.preventDefault();
  const message = qs('#create-message');
  const response = await fetch('/api/work-items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
    body: JSON.stringify({
      title: qs('#create-title').value.trim(),
      description: qs('#create-description').value.trim(),
      team: qs('#create-team').value,
      priority: qs('#create-priority').value,
      ownerId: qs('#create-owner').value
    })
  });
  const payload = await response.json();
  if (!response.ok) {
    message.textContent = payload.error || 'Unable to create work item.';
    message.className = 'error';
    return;
  }
  state.selectedId = payload.item.id;
  closeCreateModal();
  await refreshBoard();
}

async function updateStatus(id, status, version) {
  const response = await fetch(`/api/work-items/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${state.token}`
    },
    body: JSON.stringify({ status, version })
  });
  const payload = await response.json();
  const msg = qs('#detail-message');
  if (!response.ok) {
    msg.textContent = payload.error || 'Unable to update item.';
    msg.className = 'error';
    return;
  }
  msg.textContent = 'Status updated successfully.';
  msg.className = 'success';
  await loadDashboard();
  await loadWorkItems();
}

async function addCommentToItem(id) {
  const message = qs('#new-comment').value;
  const msg = qs('#detail-message');
  if (!message.trim()) {
    msg.textContent = 'Comment is required';
    msg.className = 'error';
    return;
  }

  const response = await fetch(`/api/work-items/${id}/comments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${state.token}`
    },
    body: JSON.stringify({ message })
  });
  const payload = await response.json();
  if (!response.ok) {
    msg.textContent = payload.error || 'Unable to add comment.';
    msg.className = 'error';
    return;
  }
  msg.textContent = 'Comment recorded successfully.';
  msg.className = 'success';
  qs('#new-comment').value = '';
  await loadDashboard();
  await loadWorkItems();
}

(async function init() {
  if (state.token) {
    await loadUser();
    await loadUsers();
  }
  render();
})().catch(() => render());
