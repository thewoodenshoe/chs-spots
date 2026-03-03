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

const { reportingPath } = require('./utils/data-dir');

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

function handleNeedsReview() {
  const database = db.getDb();
  const items = [];

  // 1. Discovery Review — Recently Opened / Coming Soon spots missing data
  const discoverySpots = database.prepare(
    "SELECT * FROM spots WHERE type IN ('Recently Opened', 'Coming Soon') AND status = 'approved' AND (finding_approved IS NULL OR finding_approved = 0) ORDER BY id DESC"
  ).all();
  for (const s of discoverySpots) {
    const issues = [];
    if (!s.lat || !s.lng) issues.push('no coordinates');
    if (!s.area || s.area === 'Unknown') issues.push('no area assigned');
    if (issues.length === 0) continue;
    const venue = s.venue_id ? database.prepare('SELECT name, address, website, phone, operating_hours FROM venues WHERE id = ?').get(s.venue_id) : null;
    if (venue) { s._venue_name = venue.name; s._venue_address = venue.address; s._venue_website = venue.website; s._venue_phone = venue.phone; s._venue_hours = venue.operating_hours; }
    items.push({
      category: 'Discovery Review',
      severity: issues.includes('no coordinates') ? 'high' : 'medium',
      reason: `Missing: ${issues.join(', ')}. Verify on Google Maps and fill in location data.`,
      spotId: s.id,
      title: s.title,
      type: s.type,
      area: s.area || 'Unknown',
      spot: s,
      table: 'spots',
    });
  }

  // 2. Data Quality — approved spots with no area
  const noAreaSpots = database.prepare(
    "SELECT * FROM spots WHERE (area IS NULL OR area = '' OR area = 'Unknown') AND status = 'approved' AND source = 'llm' AND type IN ('Happy Hour', 'Brunch', 'Live Music') AND (finding_approved IS NULL OR finding_approved = 0) ORDER BY id DESC LIMIT 20"
  ).all();
  for (const s of noAreaSpots) {
    const venue = s.venue_id ? database.prepare('SELECT name, address, website, phone, operating_hours FROM venues WHERE id = ?').get(s.venue_id) : null;
    if (venue) { s._venue_name = venue.name; s._venue_address = venue.address; s._venue_website = venue.website; s._venue_phone = venue.phone; s._venue_hours = venue.operating_hours; }
    items.push({
      category: 'Data Quality',
      severity: 'low',
      reason: `No area assigned. This spot won't appear in area filters. Assign the correct Charleston neighborhood.`,
      spotId: s.id,
      title: s.title,
      type: s.type,
      area: 'Unknown',
      spot: s,
      table: 'spots',
    });
  }

  // 3. Confidence Review — from confidence-review.json
  try {
    const reviewPath = reportingPath('confidence-review.json');
    if (fs.existsSync(reviewPath)) {
      const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
      const flagged = review.flagged || [];
      for (const f of flagged) {
        let matchingSpot = null;
        if (f.venueId) {
          matchingSpot = database.prepare(
            "SELECT * FROM spots WHERE venue_id = ? AND type = ? ORDER BY id DESC LIMIT 1"
          ).get(f.venueId, f.type);
          if (matchingSpot?.finding_approved) continue;
        }
        if (matchingSpot) {
          const venue = matchingSpot.venue_id ? database.prepare('SELECT name, address, website, phone, operating_hours FROM venues WHERE id = ?').get(matchingSpot.venue_id) : null;
          if (venue) { matchingSpot._venue_name = venue.name; matchingSpot._venue_address = venue.address; matchingSpot._venue_website = venue.website; matchingSpot._venue_phone = venue.phone; matchingSpot._venue_hours = venue.operating_hours; }
        }
        const llmNote = f.llmReasoning ? ` LLM says: "${f.llmReasoning}" (confidence: ${f.llmReviewConfidence})` : '';
        items.push({
          category: 'Confidence Review',
          severity: 'medium',
          reason: `Low confidence score (${f.effectiveConfidence}/${f.llmConfidence}). Flags: ${f.flags.join(', ')}. Times: ${f.times || 'N/A'}, Days: ${f.days || 'N/A'}.${llmNote}\nIs this ${f.type} genuine? Approve to keep, delete to remove.`,
          spotId: matchingSpot?.id || null,
          title: f.venue,
          type: f.type,
          area: matchingSpot?.area || '',
          spot: matchingSpot || null,
          table: 'spots',
        });
      }
    }
  } catch (e) { /* confidence-review.json may not exist yet */ }

  // 4. Venues with incomplete data (no website, address, or phone)
  const incompleteVenues = database.prepare(`
    SELECT v.* FROM venues v
    INNER JOIN spots s ON s.venue_id = v.id AND s.status = 'approved'
    WHERE (v.website IS NULL OR v.website = '') OR (v.address IS NULL OR v.address = '') OR (v.phone IS NULL OR v.phone = '')
    GROUP BY v.id
    ORDER BY COUNT(s.id) DESC
    LIMIT 20
  `).all();
  for (const v of incompleteVenues) {
    const missing = [];
    if (!v.website) missing.push('website');
    if (!v.address) missing.push('address');
    if (!v.phone) missing.push('phone');
    items.push({
      category: 'Venue Data',
      severity: 'low',
      reason: `Missing: ${missing.join(', ')}. This venue has approved spots but incomplete info.`,
      spotId: null,
      venueId: v.id,
      title: v.name,
      type: 'venue',
      area: v.area || '',
      spot: null,
      venue: v,
      table: 'venues',
    });
  }

  return { items, counts: { total: items.length, high: items.filter(i => i.severity === 'high').length, medium: items.filter(i => i.severity === 'medium').length, low: items.filter(i => i.severity === 'low').length } };
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const raw = (req.url || '/').split('?')[0];
  const pathname = raw.replace(/^\/admin/, '') || '/';

  if ((pathname === '/' || pathname === '/admin/') && req.method === 'GET') {
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

  if (pathname === '/api/needs-review' && req.method === 'GET') {
    const result = handleNeedsReview();
    sendJson(res, result);
    return;
  }

  sendJson(res, { error: 'Not found' }, 404);
});

server.listen(PORT, BIND, () => {
  console.log(`Admin UI: http://${BIND === '0.0.0.0' ? 'localhost' : BIND}:${PORT}`);
});
