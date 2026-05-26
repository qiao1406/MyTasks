import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 8787);

const dataDir = path.join(__dirname, 'data');
const dbPath = path.join(dataDir, 'taskflow.db');
await fs.mkdir(dataDir, { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec(`
CREATE TABLE IF NOT EXISTS app_state (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);

function readState() {
  const stmt = db.prepare('SELECT payload FROM app_state WHERE id = ?');
  const row = stmt.get('singleton');
  if (!row) return null;
  try {
    return JSON.parse(row.payload);
  } catch {
    return null;
  }
}

function writeState(state) {
  const payload = JSON.stringify(state);
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO app_state (id, payload, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
  `);
  stmt.run('singleton', payload, now);
}

const contentTypeByExt = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
]);

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(body));
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

function safeResolveStatic(urlPath) {
  const cleaned = urlPath.split('?')[0].split('#')[0];
  const requested = cleaned === '/' ? '/index.html' : cleaned;
  const fullPath = path.resolve(__dirname, '.' + requested);
  if (!fullPath.startsWith(__dirname)) return null;
  return fullPath;
}

const server = createServer(async (req, res) => {
  try {
    if (!req.url) return sendJson(res, 400, { error: 'Bad request' });

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      return res.end();
    }

    if (req.url.startsWith('/api/state')) {
      if (req.method === 'GET') {
        return sendJson(res, 200, { state: readState() });
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

        writeState(state);
        return sendJson(res, 200, { ok: true });
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    const target = safeResolveStatic(req.url);
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
