import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 8787);
const SESSION_TTL_DAYS = 30;

const dataDir = path.join(__dirname, 'data');
const dbPath = path.join(dataDir, 'taskflow.db');
await fs.mkdir(dataDir, { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON;');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

CREATE TABLE IF NOT EXISTS user_state (
  user_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS shared_projects (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  share_token TEXT,
  share_code TEXT UNIQUE,
  share_code_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_user_id, project_id),
  FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_shared_projects_owner ON shared_projects(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_shared_projects_project ON shared_projects(project_id);
CREATE INDEX IF NOT EXISTS idx_shared_projects_code ON shared_projects(share_code);

CREATE TABLE IF NOT EXISTS shared_project_members (
  shared_project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  PRIMARY KEY(shared_project_id, user_id),
  FOREIGN KEY(shared_project_id) REFERENCES shared_projects(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_shared_project_members_user ON shared_project_members(user_id);
`);

for (const statement of [
  'ALTER TABLE shared_projects ADD COLUMN share_token TEXT',
  'ALTER TABLE shared_projects ADD COLUMN share_code TEXT',
  'ALTER TABLE shared_projects ADD COLUMN share_code_expires_at TEXT',
  'ALTER TABLE shared_projects ADD COLUMN updated_at TEXT',
]) {
  try {
    db.exec(statement);
  } catch {
    // Existing databases may already have these columns.
  }
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_shared_projects_code ON shared_projects(share_code);');

const getUserByUsernameStmt = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?');
const createUserStmt = db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)');
const createSessionStmt = db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)');
const deleteSessionStmt = db.prepare('DELETE FROM sessions WHERE token = ?');
const findSessionUserStmt = db.prepare(`
  SELECT u.id, u.username, s.expires_at
  FROM sessions s
  JOIN users u ON u.id = s.user_id
  WHERE s.token = ?
`);
const cleanupExpiredSessionsStmt = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');
const readUserStateStmt = db.prepare('SELECT payload FROM user_state WHERE user_id = ?');
const writeUserStateStmt = db.prepare(`
  INSERT INTO user_state (user_id, payload, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET
    payload = excluded.payload,
    updated_at = excluded.updated_at
`);
const getSharedProjectByOwnerProjectStmt = db.prepare(`
  SELECT sp.id, sp.owner_user_id, sp.project_id, sp.share_code, sp.share_code_expires_at, sp.created_at, u.username AS owner_username
  FROM shared_projects sp
  JOIN users u ON u.id = sp.owner_user_id
  WHERE sp.owner_user_id = ? AND sp.project_id = ?
`);
const getSharedProjectByCodeStmt = db.prepare(`
  SELECT sp.id, sp.owner_user_id, sp.project_id, sp.share_code, sp.share_code_expires_at, sp.created_at, u.username AS owner_username
  FROM shared_projects sp
  JOIN users u ON u.id = sp.owner_user_id
  WHERE sp.share_code = ?
`);
const getMembershipForUserProjectStmt = db.prepare(`
  SELECT sp.id, sp.owner_user_id, sp.project_id, sp.share_code, sp.share_code_expires_at, sp.created_at, u.username AS owner_username
  FROM shared_project_members m
  JOIN shared_projects sp ON sp.id = m.shared_project_id
  JOIN users u ON u.id = sp.owner_user_id
  WHERE m.user_id = ? AND sp.project_id = ?
`);
const listOwnedSharedProjectsStmt = db.prepare(`
  SELECT sp.id, sp.owner_user_id, sp.project_id, sp.share_code, sp.share_code_expires_at, sp.created_at, u.username AS owner_username
  FROM shared_projects sp
  JOIN users u ON u.id = sp.owner_user_id
  WHERE sp.owner_user_id = ?
`);
const listMembershipsForUserStmt = db.prepare(`
  SELECT sp.id, sp.owner_user_id, sp.project_id, sp.share_code, sp.share_code_expires_at, sp.created_at, m.joined_at, u.username AS owner_username
  FROM shared_project_members m
  JOIN shared_projects sp ON sp.id = m.shared_project_id
  JOIN users u ON u.id = sp.owner_user_id
  WHERE m.user_id = ?
`);
const createSharedProjectStmt = db.prepare(`
  INSERT INTO shared_projects (id, owner_user_id, project_id, share_token, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const updateSharedProjectCodeStmt = db.prepare(`
  UPDATE shared_projects
  SET share_code = ?, share_code_expires_at = ?, updated_at = ?
  WHERE id = ?
`);
const createSharedProjectMemberStmt = db.prepare(`
  INSERT OR IGNORE INTO shared_project_members (shared_project_id, user_id, joined_at)
  VALUES (?, ?, ?)
`);
const deleteSharedProjectStmt = db.prepare('DELETE FROM shared_projects WHERE id = ?');
const deleteSharedProjectMemberStmt = db.prepare('DELETE FROM shared_project_members WHERE shared_project_id = ? AND user_id = ?');

const contentTypeByExt = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.png', 'image/png'],
]);

function nowISO() {
  return new Date().toISOString();
}

function addDaysISO(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function addHoursISO(hours) {
  const d = new Date();
  d.setHours(d.getHours() + hours);
  return d.toISOString();
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(body));
}

function safeResolveStatic(urlPath) {
  const cleaned = urlPath.split('?')[0].split('#')[0];
  const requested = cleaned === '/' ? '/index.html' : cleaned;
  const fullPath = path.resolve(__dirname, '.' + requested);
  if (!fullPath.startsWith(__dirname)) return null;
  return fullPath;
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, storedHash) {
  const parts = String(storedHash || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = parts[1];
  const stored = Buffer.from(parts[2], 'hex');
  const derived = scryptSync(password, salt, 64);
  if (stored.length !== derived.length) return false;
  return timingSafeEqual(stored, derived);
}

function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  const createdAt = nowISO();
  const expiresAt = addDaysISO(SESSION_TTL_DAYS);
  createSessionStmt.run(token, userId, createdAt, expiresAt);
  return token;
}

function parseAuthToken(req) {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token || null;
}

function getAuthedUser(req) {
  cleanupExpiredSessionsStmt.run(nowISO());
  const token = parseAuthToken(req);
  if (!token) return null;
  const row = findSessionUserStmt.get(token);
  if (!row) return null;
  if (row.expires_at <= nowISO()) {
    deleteSessionStmt.run(token);
    return null;
  }
  return {
    token,
    id: row.id,
    username: row.username,
  };
}

function readStateByUserId(userId) {
  const row = readUserStateStmt.get(userId);
  if (!row) return null;
  try {
    return JSON.parse(row.payload);
  } catch {
    return null;
  }
}

function writeStateByUserId(userId, state) {
  const payload = JSON.stringify(state);
  const result = writeUserStateStmt.run(userId, payload, nowISO());
  if (!result || result.changes < 1) {
    throw new Error('写入数据库失败');
  }
}

function stripProjectRuntimeFields(project) {
  const { _share, ...cleanProject } = project || {};
  return cleanProject;
}

function stripStateRuntimeFields(state) {
  return {
    ...(state || {}),
    projects: Array.isArray(state?.projects) ? state.projects.map(stripProjectRuntimeFields) : [],
    tasks: Array.isArray(state?.tasks) ? state.tasks.map((task) => ({ ...task })) : [],
    settings: state?.settings && typeof state.settings === 'object' ? { ...state.settings } : {},
  };
}

function projectSliceFromState(state, projectId) {
  const project = state?.projects?.find((item) => item.id === projectId);
  if (!project) return null;
  return {
    project: stripProjectRuntimeFields(project),
    tasks: (state.tasks || [])
      .filter((task) => task.projectId === projectId)
      .map((task) => ({ ...task, projectId })),
  };
}

function replaceProjectSlice(state, projectId, project, tasks) {
  const cleanProject = { ...stripProjectRuntimeFields(project), id: projectId };
  const cleanTasks = tasks.map((task) => ({ ...task, projectId }));

  return {
    ...(state || {}),
    projects: [...(state.projects || []).filter((item) => item.id !== projectId), cleanProject],
    tasks: [...(state.tasks || []).filter((task) => task.projectId !== projectId), ...cleanTasks],
    settings: state?.settings && typeof state.settings === 'object' ? { ...state.settings } : {},
  };
}

function stateWithValidActiveProject(state) {
  const projectIds = new Set((state.projects || []).map((project) => project.id));
  if (state.settings?.activeProjectId && projectIds.has(state.settings.activeProjectId)) return state;
  return {
    ...state,
    settings: {
      ...(state.settings || {}),
      activeProjectId: state.projects?.[0]?.id || null,
    },
  };
}

function normalizeShareCode(input) {
  return String(input || '').trim().toUpperCase();
}

function isValidShareCode(code) {
  return /^[A-Z0-9]{6}$/.test(code);
}

function generateShareCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += alphabet[randomBytes(1)[0] % alphabet.length];
  }
  return code;
}

function assignFreshShareCode(sharedProjectId) {
  const expiresAt = addHoursISO(24);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = generateShareCode();
    try {
      updateSharedProjectCodeStmt.run(code, expiresAt, nowISO(), sharedProjectId);
      return { code, expiresAt };
    } catch {
      // Retry on rare code collisions.
    }
  }
  throw new Error('生成分享码失败，请重试');
}

function buildShareCodeResponse(row, codeInfo) {
  return {
    projectId: row.project_id,
    ownerUsername: row.owner_username,
    code: codeInfo.code,
    expiresAt: codeInfo.expiresAt,
  };
}

function composeStateForUser(user) {
  const baseState = readStateByUserId(user.id);
  const memberships = listMembershipsForUserStmt.all(user.id);
  if (!baseState && !memberships.length) return null;

  const ownedShares = listOwnedSharedProjectsStmt.all(user.id);
  const membershipProjectIds = new Set(memberships.map((row) => row.project_id));
  const state = stripStateRuntimeFields(baseState || { projects: [], tasks: [], settings: {} });

  state.projects = state.projects
    .filter((project) => !membershipProjectIds.has(project.id))
    .map((project) => {
      const share = ownedShares.find((row) => row.project_id === project.id);
      if (!share) return project;
      return {
        ...project,
        _share: {
          role: 'owner',
          ownerUsername: user.username,
          codeExpiresAt: share.share_code_expires_at,
        },
      };
    });
  state.tasks = state.tasks.filter((task) => !membershipProjectIds.has(task.projectId));

  memberships.forEach((membership) => {
    const ownerState = readStateByUserId(membership.owner_user_id);
    const slice = projectSliceFromState(ownerState, membership.project_id);
    if (!slice) return;
    state.projects.push({
      ...slice.project,
      _share: {
        role: 'member',
        ownerUsername: membership.owner_username,
        joinedAt: membership.joined_at,
      },
    });
    state.tasks.push(...slice.tasks);
  });

  return stateWithValidActiveProject(state);
}

function updateSharedProjectAsMember(membership, incomingState) {
  const ownerState = readStateByUserId(membership.owner_user_id);
  const incomingSlice = projectSliceFromState(incomingState, membership.project_id);
  const ownerSlice = projectSliceFromState(ownerState, membership.project_id);
  if (!incomingSlice || !ownerSlice) return;

  writeStateByUserId(
    membership.owner_user_id,
    replaceProjectSlice(ownerState, membership.project_id, incomingSlice.project, incomingSlice.tasks)
  );
}

function saveStateForUser(userId, incomingState) {
  const cleanState = stripStateRuntimeFields(incomingState);
  const memberships = listMembershipsForUserStmt.all(userId);
  const membershipProjectIds = new Set(memberships.map((row) => row.project_id));

  memberships.forEach((membership) => updateSharedProjectAsMember(membership, cleanState));

  const personalState = {
    ...cleanState,
    projects: cleanState.projects.filter((project) => !membershipProjectIds.has(project.id)),
    tasks: cleanState.tasks.filter((task) => !membershipProjectIds.has(task.projectId)),
  };

  listOwnedSharedProjectsStmt.all(userId).forEach((share) => {
    if (!personalState.projects.some((project) => project.id === share.project_id)) {
      deleteSharedProjectStmt.run(share.id);
    }
  });

  writeStateByUserId(userId, personalState);
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

function normalizeUsername(input) {
  return String(input || '').trim();
}

function isValidUsername(username) {
  return /^[a-zA-Z0-9_]{3,32}$/.test(username);
}

function isValidPassword(password) {
  return typeof password === 'string' && password.length >= 6 && password.length <= 128;
}

const server = createServer(async (req, res) => {
  try {
    if (!req.url) return sendJson(res, 400, { error: 'Bad request' });

    const pathname = new URL(req.url, 'http://localhost').pathname;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      });
      return res.end();
    }

    if (pathname === '/api/auth/register' && req.method === 'POST') {
      const raw = await readRequestBody(req);
      let body;
      try {
        body = JSON.parse(raw || '{}');
      } catch {
        return sendJson(res, 400, { error: 'Invalid JSON body' });
      }

      const username = normalizeUsername(body?.username);
      const password = body?.password;
      if (!isValidUsername(username)) {
        return sendJson(res, 400, { error: '用户名需为3-32位字母/数字/下划线' });
      }
      if (!isValidPassword(password)) {
        return sendJson(res, 400, { error: '密码长度需为6-128位' });
      }

      const exists = getUserByUsernameStmt.get(username);
      if (exists) {
        return sendJson(res, 409, { error: '用户名已存在' });
      }

      const userId = randomUUID();
      createUserStmt.run(userId, username, hashPassword(password), nowISO());
      const token = createSession(userId);
      return sendJson(res, 201, {
        token,
        user: { id: userId, username },
      });
    }

    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const raw = await readRequestBody(req);
      let body;
      try {
        body = JSON.parse(raw || '{}');
      } catch {
        return sendJson(res, 400, { error: 'Invalid JSON body' });
      }

      const username = normalizeUsername(body?.username);
      const password = body?.password;
      if (!isValidUsername(username) || typeof password !== 'string') {
        return sendJson(res, 400, { error: '账号或密码格式错误' });
      }

      const user = getUserByUsernameStmt.get(username);
      if (!user || !verifyPassword(password, user.password_hash)) {
        return sendJson(res, 401, { error: '用户名或密码错误' });
      }

      const token = createSession(user.id);
      return sendJson(res, 200, {
        token,
        user: { id: user.id, username: user.username },
      });
    }

    if (pathname === '/api/auth/me' && req.method === 'GET') {
      const authed = getAuthedUser(req);
      if (!authed) return sendJson(res, 401, { error: '未登录' });
      return sendJson(res, 200, { user: { id: authed.id, username: authed.username } });
    }

    if (pathname === '/api/auth/logout' && req.method === 'POST') {
      const token = parseAuthToken(req);
      if (token) deleteSessionStmt.run(token);
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/share/join-code' && req.method === 'POST') {
      const authed = getAuthedUser(req);
      if (!authed) return sendJson(res, 401, { error: '未登录或会话已过期' });

      const raw = await readRequestBody(req);
      let body;
      try {
        body = JSON.parse(raw || '{}');
      } catch {
        return sendJson(res, 400, { error: 'Invalid JSON body' });
      }

      const code = normalizeShareCode(body?.code);
      if (!isValidShareCode(code)) return sendJson(res, 400, { error: '分享码需为6位字母或数字' });

      const share = getSharedProjectByCodeStmt.get(code);
      if (!share) return sendJson(res, 404, { error: '分享码不存在' });
      if (!share.share_code_expires_at || share.share_code_expires_at <= nowISO()) {
        return sendJson(res, 410, { error: '分享码已过期，请让创建者重新生成' });
      }

      const ownerState = readStateByUserId(share.owner_user_id);
      const slice = projectSliceFromState(ownerState, share.project_id);
      if (!slice) {
        deleteSharedProjectStmt.run(share.id);
        return sendJson(res, 404, { error: '项目已不存在' });
      }

      if (share.owner_user_id !== authed.id) {
        createSharedProjectMemberStmt.run(share.id, authed.id, nowISO());
      }

      return sendJson(res, 200, {
        ok: true,
        project: {
          id: slice.project.id,
          name: slice.project.name,
        },
        role: share.owner_user_id === authed.id ? 'owner' : 'member',
        share: {
          ownerUsername: share.owner_username,
          expiresAt: share.share_code_expires_at,
        },
      });
    }

    const projectShareCodeMatch = pathname.match(/^\/api\/projects\/([^/]+)\/share-code$/);
    if (projectShareCodeMatch && req.method === 'POST') {
      const authed = getAuthedUser(req);
      if (!authed) return sendJson(res, 401, { error: '未登录或会话已过期' });

      const projectId = decodeURIComponent(projectShareCodeMatch[1]);
      const state = readStateByUserId(authed.id);
      const slice = projectSliceFromState(state, projectId);
      if (!slice) return sendJson(res, 404, { error: '只有项目创建者可以生成分享码' });

      let share = getSharedProjectByOwnerProjectStmt.get(authed.id, projectId);
      if (!share) {
        const timestamp = nowISO();
        createSharedProjectStmt.run(randomUUID(), authed.id, projectId, randomBytes(24).toString('hex'), timestamp, timestamp);
        share = getSharedProjectByOwnerProjectStmt.get(authed.id, projectId);
      }

      const codeInfo = assignFreshShareCode(share.id);
      return sendJson(res, 200, { share: buildShareCodeResponse(share, codeInfo) });
    }

    const projectMembershipMatch = pathname.match(/^\/api\/projects\/([^/]+)\/membership$/);
    if (projectMembershipMatch && req.method === 'DELETE') {
      const authed = getAuthedUser(req);
      if (!authed) return sendJson(res, 401, { error: '未登录或会话已过期' });

      const projectId = decodeURIComponent(projectMembershipMatch[1]);
      const membership = getMembershipForUserProjectStmt.get(authed.id, projectId);
      if (!membership) return sendJson(res, 404, { error: '你不是该共享项目的成员' });

      deleteSharedProjectMemberStmt.run(membership.id, authed.id);
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/state') {
      const authed = getAuthedUser(req);
      if (!authed) return sendJson(res, 401, { error: '未登录或会话已过期' });

      if (req.method === 'GET') {
        return sendJson(res, 200, { state: composeStateForUser(authed) });
      }

      if (req.method === 'PUT') {
        const raw = await readRequestBody(req);
        let body;
        try {
          body = JSON.parse(raw || '{}');
        } catch {
          return sendJson(res, 400, { error: 'Invalid JSON body' });
        }

        const state = body?.state;
        if (!state || !Array.isArray(state.projects) || !Array.isArray(state.tasks)) {
          return sendJson(res, 400, { error: 'Invalid state payload' });
        }

        saveStateForUser(authed.id, state);
        return sendJson(res, 200, { ok: true });
      }

      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    const target = safeResolveStatic(pathname);
    if (!target) return sendJson(res, 403, { error: 'Forbidden' });

    const ext = path.extname(target).toLowerCase();
    const ctype = contentTypeByExt.get(ext) || 'application/octet-stream';

    try {
      const data = await fs.readFile(target);
      const headers = { 'Content-Type': ctype };
      if (pathname === '/favicon.ico') {
        headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
      }
      res.writeHead(200, headers);
      return res.end(data);
    } catch {
      return sendJson(res, 404, { error: 'Not found' });
    }
  } catch (err) {
    return sendJson(res, 500, { error: err?.message || 'Internal server error' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`TaskFlow server running at http://0.0.0.0:${PORT}`);
  console.log(`Database file: ${dbPath}`);
});
