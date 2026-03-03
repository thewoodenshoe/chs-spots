#!/usr/bin/env node
/**
 * Admin UI server for spots + venues.
 * Serves admin.html and provides query/update API.
 * Run: node scripts/serve-admin.js (or npm run admin)
 * Open: http://<host>:3456
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

process.env.DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', 'data', 'chs-spots.db');
const db = require('./utils/db');

const PORT = process.env.ADMIN_PORT || 3456;
const BIND = process.env.ADMIN_BIND || '0.0.0.0';
const HTML_PATH = path.join(__dirname, 'admin.html');

const SPOT_COLUMNS = [
  'id', 'venue_id', 'title', 'type', 'source', 'status', 'description',
  'promotion_time', 'promotion_list', 'source_url', 'submitter_name',
  'manual_override', 'photo_url', 'last_update_date', 'pending_edit',
  'pending_delete', 'submitted_at', 'edited_at', 'lat', 'lng', 'area',
  'finding_approved', 'finding_rationale',
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
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function handleQuery(body) {
  const { field, value, table } = body;
  if (!field || value === undefined || value === '') {
    return { error: 'field and value required' };
  }

  const database = db.getDb();

  if (table === 'venues') {
    const venueCols = ['id', 'name', 'address', 'lat', 'lng', 'area', 'website',
      'photo_url', 'types', 'operating_hours', 'hours_source', 'hours_updated_at',
      'phone', 'created_at', 'updated_at'];
    if (!venueCols.includes(field)) return { error: `invalid venue field: ${field}` };
    let rows;
    if (field === 'id') {
      const row = database.prepare('SELECT * FROM venues WHERE id = ?').get(value);
      rows = row ? [row] : [];
    } else {
      rows = database.prepare(`SELECT * FROM venues WHERE ${field} LIKE ? ORDER BY name`).all(`%${value}%`);
    }
    return { rows, table: 'venues' };
  }

  if (!SPOT_COLUMNS.includes(field)) return { error: `invalid field: ${field}` };
  let rows;
  if (field === 'id') {
    const row = database.prepare('SELECT * FROM spots WHERE id = ?').get(Number(value));
    rows = row ? [row] : [];
  } else {
    rows = database.prepare(`SELECT * FROM spots WHERE ${field} LIKE ? ORDER BY id`).all(`%${value}%`);
  }

  // Attach venue info for each spot
  for (const row of rows) {
    if (row.venue_id) {
      const venue = database.prepare('SELECT name, address, website, phone, operating_hours FROM venues WHERE id = ?').get(row.venue_id);
      if (venue) {
        row._venue_name = venue.name;
        row._venue_address = venue.address;
        row._venue_website = venue.website;
        row._venue_phone = venue.phone;
        row._venue_hours = venue.operating_hours;
      }
    }
  }
  return { rows, table: 'spots' };
}

function handleUpdate(body) {
  const { id, _table, ...fields } = body;

  if (_table === 'venues') {
    const venueId = id;
    if (!venueId) return { error: 'venue id required' };
    const readOnly = new Set(['id', 'created_at', 'updated_at']);
    const toUpdate = {};
    for (const [k, v] of Object.entries(fields)) {
      if (readOnly.has(k)) continue;
      toUpdate[k] = v === '' ? null : v;
    }
    if (Object.keys(toUpdate).length === 0) return { error: 'no valid fields to update' };
    const setClauses = Object.keys(toUpdate).map(k => `${k} = @${k}`);
    setClauses.push("updated_at = datetime('now')");
    const params = { ...toUpdate, id: venueId };
    const database = db.getDb();
    const result = database.prepare(`UPDATE venues SET ${setClauses.join(', ')} WHERE id = @id`).run(params);
    if (result.changes === 0) return { error: 'venue not found' };
    const updated = database.prepare('SELECT * FROM venues WHERE id = ?').get(venueId);
    return { success: true, row: updated, table: 'venues' };
  }

  const spotId = typeof id === 'string' ? parseInt(id, 10) : id;
  if (!spotId || isNaN(spotId)) return { error: 'id (number) required' };

  const readOnly = new Set(['id', 'created_at', 'updated_at']);
  const toUpdate = {};
  for (const [k, v] of Object.entries(fields)) {
    const col = k.replace(/([A-Z])/g, '_$1').toLowerCase();
    if (readOnly.has(k) || readOnly.has(col)) continue;
    if (k.startsWith('_')) continue;
    if (!SPOT_COLUMNS.includes(k) && !SPOT_COLUMNS.includes(col)) continue;
    toUpdate[k] = v === '' ? null : (typeof v === 'number' ? v : String(v));
  }
  if (Object.keys(toUpdate).length === 0) return { error: 'no valid fields to update' };

  // Auto-set last_update_date on any manual edit
  if (!toUpdate.last_update_date) {
    toUpdate.last_update_date = new Date().toISOString().split('T')[0];
  }

  const ok = db.spots.update(spotId, toUpdate);
  if (!ok) return { error: 'spot not found' };
  const updated = db.spots.getById(spotId);
  return { success: true, row: updated, table: 'spots' };
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const pathname = (req.url || '/').split('?')[0];

  if (pathname === '/' && req.method === 'GET') {
    try { sendHtml(res, fs.readFileSync(HTML_PATH, 'utf8')); }
    catch { sendJson(res, { error: 'admin.html not found' }, 500); }
    return;
  }

  if (pathname === '/api/query' && req.method === 'POST') {
    const body = await parseBody(req);
    const result = handleQuery(body);
    sendJson(res, result, result.error ? 400 : 200);
    return;
  }

  if (pathname === '/api/update' && req.method === 'PUT') {
    const body = await parseBody(req);
    const result = handleUpdate(body);
    sendJson(res, result, result.error ? 400 : 200);
    return;
  }

  sendJson(res, { error: 'Not found' }, 404);
});

server.listen(PORT, BIND, () => {
  console.log(`Admin UI: http://${BIND === '0.0.0.0' ? 'localhost' : BIND}:${PORT}`);
});
