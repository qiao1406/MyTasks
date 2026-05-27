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
`);

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

const contentTypeByExt = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
]);

function nowISO() {
  return new Date().toISOString();
}

function addDaysISO(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
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
  writeUserStateStmt.run(userId, payload, nowISO());
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
        'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
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

    if (pathname === '/api/state') {
      const authed = getAuthedUser(req);
      if (!authed) return sendJson(res, 401, { error: '未登录或会话已过期' });

      if (req.method === 'GET') {
        return sendJson(res, 200, { state: readStateByUserId(authed.id) });
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

        writeStateByUserId(authed.id, state);
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
      res.writeHead(200, { 'Content-Type': ctype });
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
