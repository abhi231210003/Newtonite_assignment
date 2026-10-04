const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'newtonite.sqlite'));
db.pragma('journal_mode = WAL');

db.prepare(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    team TEXT NOT NULL,
    role TEXT NOT NULL,
    password TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS work_items (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    priority TEXT NOT NULL DEFAULT 'medium',
    team TEXT NOT NULL,
    requester_id TEXT NOT NULL,
    owner_id TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    due_at TEXT,
    source TEXT
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS item_history (
    id TEXT PRIMARY KEY,
    work_item_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(work_item_id) REFERENCES work_items(id)
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    work_item_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(work_item_id) REFERENCES work_items(id)
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS async_tasks (
    id TEXT PRIMARY KEY,
    work_item_id TEXT NOT NULL,
    task_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    payload TEXT,
    created_at TEXT NOT NULL,
    processed_at TEXT,
    error TEXT,
    FOREIGN KEY(work_item_id) REFERENCES work_items(id)
  )
`).run();

function seed() {
  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (userCount > 0) return;

  const now = new Date().toISOString();
  const users = [
    { id: 'u-ops-lead', email: 'alice@newtonite.com', name: 'Alice Johnson', team: 'Operations', role: 'team_lead', password: 'secret123' },
    { id: 'u-admin', email: 'brad@newtonite.com', name: 'Brad Chen', team: 'Engineering', role: 'admin', password: 'secret123' },
    { id: 'u-finance-analyst', email: 'chloe@newtonite.com', name: 'Chloe Singh', team: 'Finance', role: 'analyst', password: 'secret123' },
    { id: 'u-ops-viewer', email: 'derek@newtonite.com', name: 'Derek Ortiz', team: 'Operations', role: 'viewer', password: 'secret123' }
  ];

  const insertUser = db.prepare(`INSERT INTO users (id, email, name, team, role, password, created_at) VALUES (@id, @email, @name, @team, @role, @password, @created_at)`);
  for (const user of users) {
    insertUser.run({ ...user, created_at: now });
  }

  const workItems = [
    {
      id: 'w-1',
      title: 'Payment reconciliation backlog',
      description: 'Review duplicate charge reports for the last 90 minutes and confirm whether settlements were blocked.',
      status: 'investigating',
      priority: 'high',
      team: 'Finance',
      requester_id: 'u-admin',
      owner_id: 'u-finance-analyst',
      due_at: new Date(Date.now() + 1000 * 60 * 60 * 3).toISOString(),
      source: 'customer-support'
    },
    {
      id: 'w-2',
      title: 'API gateway latency spike',
      description: 'Customer-facing traffic is experiencing elevated latency after the latest deploy; confirm whether the issue is isolated to the payments API.',
      status: 'new',
      priority: 'critical',
      team: 'Engineering',
      requester_id: 'u-ops-lead',
      owner_id: 'u-admin',
      due_at: new Date(Date.now() + 1000 * 60 * 45).toISOString(),
      source: 'pagerduty'
    },
    {
      id: 'w-3',
      title: 'Compliance approval for contractor access',
      description: 'Pending review to ensure controlled access is valid before the staff member starts on Monday.',
      status: 'waiting_approval',
      priority: 'medium',
      team: 'Operations',
      requester_id: 'u-ops-viewer',
      owner_id: 'u-ops-lead',
      due_at: new Date(Date.now() + 1000 * 60 * 60 * 10).toISOString(),
      source: 'compliance-review'
    }
  ];

  const insertWork = db.prepare(`INSERT INTO work_items (id, title, description, status, priority, team, requester_id, owner_id, version, created_at, updated_at, due_at, source) VALUES (@id, @title, @description, @status, @priority, @team, @requester_id, @owner_id, @version, @created_at, @updated_at, @due_at, @source)`);
  for (const item of workItems) {
    insertWork.run({
      ...item,
      version: 1,
      created_at: now,
      updated_at: now
    });

    const historyInsert = db.prepare(`INSERT INTO item_history (id, work_item_id, actor_id, action, details, created_at) VALUES (@id, @work_item_id, @actor_id, @action, @details, @created_at)`);
    historyInsert.run({
      id: uuidv4(),
      work_item_id: item.id,
      actor_id: item.requester_id,
      action: 'created',
      details: `Work item created for ${item.team} operations.`,
      created_at: now
    });
  }
}

function resetData() {
  db.prepare('DELETE FROM async_tasks').run();
  db.prepare('DELETE FROM comments').run();
  db.prepare('DELETE FROM item_history').run();
  db.prepare('DELETE FROM work_items').run();
  db.prepare('DELETE FROM users').run();
  seed();
}

function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function getAllUsers() {
  return db.prepare('SELECT * FROM users ORDER BY team, name').all();
}

function listWorkItems(filters = {}) {
  const { team, status, priority, assigneeId, search, limit = 50, offset = 0 } = filters;
  const clauses = [];
  const params = [];

  if (team) {
    clauses.push('team = ?');
    params.push(team);
  }
  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }
  if (priority) {
    clauses.push('priority = ?');
    params.push(priority);
  }
  if (assigneeId) {
    clauses.push('owner_id = ?');
    params.push(assigneeId);
  }
  if (search) {
    clauses.push('(title LIKE ? OR description LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS total FROM work_items ${whereSql}`).get(...params);
  const items = db.prepare(`SELECT * FROM work_items ${whereSql} ORDER BY CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, updated_at DESC LIMIT ? OFFSET ?`).all(...params, Number(limit), Number(offset));

  return {
    total: total.total,
    items
  };
}

function getWorkItemById(id) {
  return db.prepare('SELECT * FROM work_items WHERE id = ?').get(id);
}

function getWorkItemDetails(id) {
  const item = getWorkItemById(id);
  if (!item) {
    return null;
  }

  const comments = db.prepare('SELECT * FROM comments WHERE work_item_id = ? ORDER BY created_at DESC').all(id);
  const history = db.prepare('SELECT * FROM item_history WHERE work_item_id = ? ORDER BY created_at DESC').all(id);
  const tasks = db.prepare('SELECT * FROM async_tasks WHERE work_item_id = ? ORDER BY created_at DESC').all(id);

  return { ...item, comments, history, tasks };
}

function createWorkItem({ title, description, team, requesterId, ownerId, priority, dueAt, source }) {
  const id = uuidv4();
  const now = new Date().toISOString();
  const record = {
    id,
    title,
    description,
    team,
    requester_id: requesterId,
    owner_id: ownerId || requesterId,
    priority: priority || 'medium',
    status: 'new',
    version: 1,
    created_at: now,
    updated_at: now,
    due_at: dueAt || null,
    source: source || 'manual'
  };

  db.prepare(`INSERT INTO work_items (id, title, description, status, priority, team, requester_id, owner_id, version, created_at, updated_at, due_at, source) VALUES (@id, @title, @description, @status, @priority, @team, @requester_id, @owner_id, @version, @created_at, @updated_at, @due_at, @source)`).run(record);

  db.prepare(`INSERT INTO item_history (id, work_item_id, actor_id, action, details, created_at) VALUES (@id, @work_item_id, @actor_id, @action, @details, @created_at)`).run({
    id: uuidv4(),
    work_item_id: id,
    actor_id: requesterId,
    action: 'created',
    details: `Created work item with priority ${record.priority}.`,
    created_at: now
  });

  return getWorkItemDetails(id);
}

function addComment(workItemId, userId, message) {
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO comments (id, work_item_id, user_id, message, created_at) VALUES (?, ?, ?, ?, ?)`).run(id, workItemId, userId, message, now);
  db.prepare(`INSERT INTO item_history (id, work_item_id, actor_id, action, details, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
    uuidv4(),
    workItemId,
    userId,
    'comment_added',
    `Comment posted: ${message.slice(0, 120)}`,
    now
  );
  return db.prepare('SELECT * FROM comments WHERE work_item_id = ? ORDER BY created_at DESC').all(workItemId);
}

function updateWorkItem(workItemId, actorId, updates, expectedVersion) {
  const current = getWorkItemById(workItemId);
  if (!current) {
    const err = new Error('Work item not found');
    err.status = 404;
    throw err;
  }
  if (expectedVersion !== undefined && Number(current.version) !== Number(expectedVersion)) {
    const err = new Error('This item has changed since you loaded it. Please refresh and retry.');
    err.status = 409;
    throw err;
  }

  const nextVersion = Number(current.version) + 1;
  const updatePayload = {
    ...current,
    ...updates,
    version: nextVersion,
    updated_at: new Date().toISOString(),
    status: updates.status || current.status,
    priority: updates.priority || current.priority,
    team: updates.team || current.team,
    owner_id: updates.owner_id !== undefined ? updates.owner_id : current.owner_id,
    title: updates.title !== undefined ? updates.title : current.title,
    description: updates.description !== undefined ? updates.description : current.description,
    due_at: updates.due_at !== undefined ? updates.due_at : current.due_at,
    source: updates.source !== undefined ? updates.source : current.source
  };

  db.prepare(`UPDATE work_items SET title = ?, description = ?, status = ?, priority = ?, team = ?, owner_id = ?, version = ?, updated_at = ?, due_at = ?, source = ? WHERE id = ?`).run(
    updatePayload.title,
    updatePayload.description,
    updatePayload.status,
    updatePayload.priority,
    updatePayload.team,
    updatePayload.owner_id,
    nextVersion,
    updatePayload.updated_at,
    updatePayload.due_at,
    updatePayload.source,
    workItemId
  );

  const changes = Object.entries(updates).map(([key, value]) => `${key}: ${value}`).join('; ');
  if (changes) {
    db.prepare(`INSERT INTO item_history (id, work_item_id, actor_id, action, details, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
      uuidv4(),
      workItemId,
      actorId,
      'updated',
      changes || 'Updated work item.',
      updatePayload.updated_at
    );
  }

  return getWorkItemDetails(workItemId);
}

function queueAsyncTask(workItemId, taskType, payload = {}) {
  const record = {
    id: uuidv4(),
    work_item_id: workItemId,
    task_type: taskType,
    status: 'queued',
    payload: JSON.stringify(payload),
    created_at: new Date().toISOString(),
    processed_at: null,
    error: null
  };

  db.prepare(`INSERT INTO async_tasks (id, work_item_id, task_type, status, payload, created_at, processed_at, error) VALUES (@id, @work_item_id, @task_type, @status, @payload, @created_at, @processed_at, @error)`).run(record);

  setTimeout(() => {
    try {
      const task = db.prepare('SELECT * FROM async_tasks WHERE id = ?').get(record.id);
      if (!task) return;
      db.prepare(`UPDATE async_tasks SET status = 'completed', processed_at = ? WHERE id = ?`).run(new Date().toISOString(), record.id);
      db.prepare(`INSERT INTO item_history (id, work_item_id, actor_id, action, details, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
        uuidv4(),
        workItemId,
        'system',
        'notification_processed',
        `Asynchronous ${taskType} task completed successfully.`,
        new Date().toISOString()
      );
    } catch (error) {
      db.prepare(`UPDATE async_tasks SET status = 'failed', processed_at = ?, error = ? WHERE id = ?`).run(new Date().toISOString(), String(error.message), record.id);
    }
  }, 1200);

  return record;
}

module.exports = {
  db,
  seed,
  getUserByEmail,
  getUserById,
  getAllUsers,
  listWorkItems,
  getWorkItemById,
  getWorkItemDetails,
  createWorkItem,
  addComment,
  updateWorkItem,
  queueAsyncTask,
  resetData
};
