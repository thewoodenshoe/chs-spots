#!/usr/bin/env node
/**
 * Local admin UI server for spots.
 * Serves admin.html and provides query/update API.
 * Run: node scripts/serve-admin.js (or npm run admin)
 * Open: http://localhost:3456
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

// Set DB path before requiring db (works from any cwd)
process.env.DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', 'data', 'chs-spots.db');
const db = require('./utils/db');

const PORT = 3456;
const HTML_PATH = path.join(__dirname, 'admin.html');

const SPOT_COLUMNS = [
  'id', 'venue_id', 'title', 'type', 'source', 'status', 'description',
  'promotion_time', 'promotion_list', 'source_url', 'submitter_name',
  'manual_override', 'photo_url', 'last_update_date', 'pending_edit',
  'pending_delete', 'submitted_at', 'edited_at', 'lat', 'lng', 'area',
  'created_at', 'updated_at',
];

function sendJson(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function sendHtml(res, html, status = 200) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function handleQuery(body) {
  const { field, value } = body;
  if (!field || value === undefined || value === '') {
    return { error: 'field and value required' };
  }
  if (!SPOT_COLUMNS.includes(field)) {
    return { error: `invalid field: ${field}` };
  }
  const database = db.getDb();
  const col = field.replace(/([A-Z])/g, '_$1').toLowerCase();
  let rows;
  if (field === 'id') {
    const row = database.prepare(`SELECT * FROM spots WHERE id = ?`).get(Number(value));
    rows = row ? [row] : [];
  } else {
    rows = database.prepare(`SELECT * FROM spots WHERE ${col} LIKE ? ORDER BY id`).all(`%${value}%`);
  }
  return { rows };
}

function handleUpdate(body) {
  const { id, ...fields } = body;
  const spotId = typeof id === 'string' ? parseInt(id, 10) : id;
  if (!spotId || isNaN(spotId)) {
    return { error: 'id (number) required' };
  }
  const readOnly = new Set(['id', 'created_at', 'updated_at']);
  const toUpdate = {};
  for (const [k, v] of Object.entries(fields)) {
    const col = k.replace(/([A-Z])/g, '_$1').toLowerCase();
    if (readOnly.has(k) || readOnly.has(col)) continue;
    if (!SPOT_COLUMNS.includes(k) && !SPOT_COLUMNS.includes(col)) continue;
    toUpdate[k] = v === '' ? null : (typeof v === 'number' ? v : String(v));
  }
  if (Object.keys(toUpdate).length === 0) {
    return { error: 'no valid fields to update' };
  }
  const ok = db.spots.update(spotId, toUpdate);
  if (!ok) return { error: 'spot not found' };
  const updated = db.spots.getById(spotId);
  return { success: true, row: updated };
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url || '/';
  const pathname = url.split('?')[0];

  if (pathname === '/' && req.method === 'GET') {
    try {
      const html = fs.readFileSync(HTML_PATH, 'utf8');
      sendHtml(res, html);
    } catch (err) {
      sendJson(res, { error: 'admin.html not found' }, 500);
    }
    return;
  }

  if (pathname === '/api/query' && req.method === 'POST') {
    const body = await parseBody(req);
    const result = handleQuery(body);
    if (result.error) {
      sendJson(res, result, 400);
    } else {
      sendJson(res, result);
    }
    return;
  }

  if (pathname === '/api/update' && req.method === 'PUT') {
    const body = await parseBody(req);
    const result = handleUpdate(body);
    if (result.error) {
      sendJson(res, result, 400);
    } else {
      sendJson(res, result);
    }
    return;
  }

  sendJson(res, { error: 'Not found' }, 404);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Admin UI: http://localhost:${PORT}`);
});
