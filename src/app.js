const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const {
  getUserByEmail,
  getUserById,
  getAllUsers,
  listWorkItems,
  getWorkItemDetails,
  createWorkItem,
  addComment,
  updateWorkItem,
  queueAsyncTask
} = require('./db');

function createApp() {
  const app = express();
  const sessions = new Map();

  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  function sanitizeUser(user) {
    if (!user) return null;
    const { password, ...safeUser } = user;
    return safeUser;
  }

  function requireAuth(req, res, next) {
    const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (!token || !sessions.has(token)) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    const user = getUserById(sessions.get(token));
    if (!user) {
      return res.status(401).json({ error: 'Session expired.' });
    }
    req.user = user;
    next();
  }

  function requireRole(...allowedRoles) {
    return (req, res, next) => {
      if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({ error: 'You do not have permission to perform this action.' });
      }
      next();
    };
  }

  function canEditWorkItem(user, item) {
    if (!item) return false;
    if (user.role === 'admin') return true;
    if (user.role === 'team_lead' && user.team === item.team) return true;
    if (user.role === 'analyst' && (user.id === item.owner_id || user.id === item.requester_id)) return true;
    return false;
  }

  function normalizeInteger(value, fallback) {
    const result = Number(value ?? fallback);
    return Number.isFinite(result) ? result : fallback;
  }

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.post('/api/login', (req, res) => {
    const { email, password } = req.body || {};
    const user = getUserByEmail(email);
    if (!user || user.password !== password) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = crypto.randomBytes(20).toString('hex');
    sessions.set(token, user.id);
    res.json({ token, user: sanitizeUser(user) });
  });

  app.get('/api/me', requireAuth, (req, res) => {
    res.json({ user: sanitizeUser(req.user) });
  });

  app.get('/api/users', requireAuth, (req, res) => {
    res.json({ users: getAllUsers().map(sanitizeUser) });
  });

  app.get('/api/work-items', requireAuth, (req, res) => {
    const filters = {
      team: req.query.team || '',
      status: req.query.status || '',
      priority: req.query.priority || '',
      assigneeId: req.query.assigneeId || '',
      search: req.query.search || '',
      limit: normalizeInteger(req.query.limit, 50),
      offset: normalizeInteger(req.query.offset, 0)
    };

    const result = listWorkItems(filters);
    res.json(result);
  });

  app.get('/api/work-items/:id', requireAuth, (req, res) => {
    const item = getWorkItemDetails(req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Work item not found.' });
    }
    res.json({ item });
  });

  app.post('/api/work-items', requireAuth, (req, res) => {
    if (req.user.role === 'viewer') {
      return res.status(403).json({ error: 'Viewers cannot create work items.' });
    }

    const { title, description, team, priority, ownerId, dueAt, source } = req.body || {};

    if (!title || !description || !team) {
      return res.status(400).json({ error: 'Title, description and team are required.' });
    }

    const item = createWorkItem({
      title: String(title).trim(),
      description: String(description).trim(),
      team: String(team).trim(),
      requesterId: req.user.id,
      ownerId: ownerId || req.user.id,
      priority: priority || 'medium',
      dueAt: dueAt || null,
      source: source || 'manual'
    });

    queueAsyncTask(item.id, 'new_work_item', { team, ownerId: item.owner_id });
    res.status(201).json({ item });
  });

  app.patch('/api/work-items/:id', requireAuth, (req, res) => {
    const { version, ...updates } = req.body || {};
    const item = getWorkItemDetails(req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Work item not found.' });
    }

    if (!canEditWorkItem(req.user, item)) {
      return res.status(403).json({ error: 'You cannot edit this work item.' });
    }

    try {
      const updated = updateWorkItem(req.params.id, req.user.id, updates, version);
      const result = updated;
      if (updates.status || updates.priority || updates.owner_id) {
        queueAsyncTask(req.params.id, 'work_item_update', { updatedBy: req.user.id, status: result.status, priority: result.priority });
      }
      res.json({ item: result });
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message || 'Unable to update work item.' });
    }
  });

  app.post('/api/work-items/:id/comments', requireAuth, (req, res) => {
    const { message } = req.body || {};
    const item = getWorkItemDetails(req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Work item not found.' });
    }
    if (!canEditWorkItem(req.user, item) && req.user.id !== item.owner_id) {
      return res.status(403).json({ error: 'You cannot comment on this item.' });
    }
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: 'Comment message is required.' });
    }

    const comments = addComment(req.params.id, req.user.id, String(message).trim());
    const refreshed = getWorkItemDetails(req.params.id);
    res.status(201).json({ comments, item: refreshed });
  });

  app.post('/api/work-items/:id/assign', requireAuth, (req, res) => {
    const { assigneeId, version } = req.body || {};
    const item = getWorkItemDetails(req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Work item not found.' });
    }

    if (req.user.role !== 'admin' && req.user.role !== 'team_lead' && req.user.id !== item.owner_id) {
      return res.status(403).json({ error: 'Only admins, team leads, or the owner can reassign work.' });
    }

    const targetUser = getUserById(assigneeId);
    if (!targetUser) {
      return res.status(400).json({ error: 'Assignee must be a valid user.' });
    }

    if (item.owner_id === assigneeId) {
      return res.json({ item, message: 'Assignment already matches the current owner.' });
    }

    try {
      const updated = updateWorkItem(req.params.id, req.user.id, { owner_id: assigneeId }, version ?? item.version);
      queueAsyncTask(req.params.id, 'assignment', { from: item.owner_id, to: assigneeId });
      res.json({ item: updated, message: `Assigned to ${targetUser.name}.` });
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message || 'Unable to assign owner.' });
    }
  });

  app.get('/api/dashboard', requireAuth, (req, res) => {
    const stats = listWorkItems({ limit: 1000 });
    const counts = {
      total: stats.total,
      critical: listWorkItems({ priority: 'critical', limit: 1000 }).total,
      new: listWorkItems({ status: 'new', limit: 1000 }).total,
      waiting_approval: listWorkItems({ status: 'waiting_approval', limit: 1000 }).total,
      my_items: listWorkItems({ assigneeId: req.user.id, limit: 1000 }).total
    };

    res.json({ counts, items: stats.items.slice(0, 10) });
  });

  app.use((req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });

  return app;
}

module.exports = createApp;
