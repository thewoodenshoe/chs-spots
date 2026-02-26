/**
 * Data Access Layer (DAL) for CHS Spots SQLite database.
 *
 * Provides typed query helpers for every table the ETL pipeline
 * and Next.js API routes need. Uses better-sqlite3 (synchronous,
 * WAL-mode, prepared statements).
 *
 * DB location: <project>/data/chs-spots.db (override with DB_PATH env var).
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let _db = null;

function getDbPath() {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  const dataRoot = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
  return path.join(dataRoot, 'chs-spots.db');
}

function getDb() {
  if (_db) return _db;

  const dbPath = getDbPath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  return _db;
}

function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

/**
 * Run the schema SQL to create all tables (idempotent).
 */
function ensureSchema() {
  const db = getDb();
  const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  db.exec(sql);
}

// ── Audit helper ────────────────────────────────────────────────
function logAudit(tableName, rowId, action, oldData, newData) {
  const db = getDb();
  db.prepare(
    `INSERT INTO audit_log (table_name, row_id, action, old_data, new_data)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    tableName,
    String(rowId),
    action,
    oldData ? JSON.stringify(oldData) : null,
    newData ? JSON.stringify(newData) : null
  );
}

// ── Venues ──────────────────────────────────────────────────────
const venues = {
  getAll() {
    return getDb().prepare('SELECT * FROM venues ORDER BY name').all();
  },

  getById(id) {
    return getDb().prepare('SELECT * FROM venues WHERE id = ?').get(id);
  },

  getByArea(area) {
    return getDb().prepare('SELECT * FROM venues WHERE area = ? ORDER BY name').all(area);
  },

  upsert(v) {
    const db = getDb();
    const existing = this.getById(v.id);
    db.prepare(`
      INSERT INTO venues (id, name, address, lat, lng, area, website, photo_url, types, raw_google_data, updated_at)
      VALUES (@id, @name, @address, @lat, @lng, @area, @website, @photo_url, @types, @raw_google_data, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        name=@name, address=@address, lat=@lat, lng=@lng, area=@area,
        website=@website, photo_url=@photo_url, types=@types,
        raw_google_data=@raw_google_data, updated_at=datetime('now')
    `).run({
      id: v.id,
      name: v.name,
      address: v.address || null,
      lat: v.lat,
      lng: v.lng,
      area: v.area || null,
      website: v.website || null,
      photo_url: v.photo_url || v.photoUrl || null,
      types: v.types ? (typeof v.types === 'string' ? v.types : JSON.stringify(v.types)) : null,
      raw_google_data: v.raw_google_data ? (typeof v.raw_google_data === 'string' ? v.raw_google_data : JSON.stringify(v.raw_google_data)) : null,
    });
    logAudit('venues', v.id, existing ? 'UPDATE' : 'INSERT', existing, v);
  },

  updatePhotoUrl(id, photoUrl) {
    getDb().prepare('UPDATE venues SET photo_url = ?, updated_at = datetime(?) WHERE id = ?')
      .run(photoUrl, new Date().toISOString(), id);
  },

  count() {
    return getDb().prepare('SELECT COUNT(*) as cnt FROM venues').get().cnt;
  },
};

// ── Spots ───────────────────────────────────────────────────────
const spots = {
  getAll(filters) {
    let sql = 'SELECT * FROM spots';
    const params = [];
    const clauses = [];
    if (filters) {
      if (filters.source) { clauses.push('source = ?'); params.push(filters.source); }
      if (filters.type) { clauses.push('type = ?'); params.push(filters.type); }
      if (filters.venueId) { clauses.push('venue_id = ?'); params.push(filters.venueId); }
      if (filters.status) { clauses.push('status = ?'); params.push(filters.status); }
      if (filters.visibleOnly) {
        clauses.push("(source = 'automated' OR status = 'approved' OR status IS NULL)");
      }
    }
    if (clauses.length > 0) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY id';
    return getDb().prepare(sql).all(...params);
  },

  getById(id) {
    return getDb().prepare('SELECT * FROM spots WHERE id = ?').get(id);
  },

  getByVenueAndType(venueId, type) {
    return getDb().prepare('SELECT * FROM spots WHERE venue_id = ? AND type = ?').get(venueId, type);
  },

  insert(s) {
    const db = getDb();
    const info = db.prepare(`
      INSERT INTO spots (venue_id, title, type, source, status, description,
        promotion_time, promotion_list, source_url, submitter_name,
        manual_override, photo_url, last_update_date, pending_edit,
        pending_delete, submitted_at, edited_at, lat, lng, area, updated_at)
      VALUES (@venue_id, @title, @type, @source, @status, @description,
        @promotion_time, @promotion_list, @source_url, @submitter_name,
        @manual_override, @photo_url, @last_update_date, @pending_edit,
        @pending_delete, @submitted_at, @edited_at, @lat, @lng, @area, datetime('now'))
    `).run({
      venue_id: s.venue_id || s.venueId || null,
      title: s.title,
      type: s.type || 'Happy Hour',
      source: s.source || 'automated',
      status: s.status || 'approved',
      description: s.description || null,
      promotion_time: s.promotion_time || s.promotionTime || null,
      promotion_list: s.promotion_list || (s.promotionList ? JSON.stringify(s.promotionList) : null),
      source_url: s.source_url || s.sourceUrl || null,
      submitter_name: s.submitter_name || s.submitterName || null,
      manual_override: s.manual_override || s.manualOverride ? 1 : 0,
      photo_url: s.photo_url || s.photoUrl || null,
      last_update_date: s.last_update_date || s.lastUpdateDate || null,
      pending_edit: s.pending_edit || s.pendingEdit ? (typeof (s.pending_edit || s.pendingEdit) === 'string' ? (s.pending_edit || s.pendingEdit) : JSON.stringify(s.pending_edit || s.pendingEdit)) : null,
      pending_delete: s.pending_delete || s.pendingDelete ? 1 : 0,
      submitted_at: s.submitted_at || s.submittedAt || null,
      edited_at: s.edited_at || s.editedAt || null,
      lat: s.lat ?? null,
      lng: s.lng ?? null,
      area: s.area || null,
    });
    const newId = info.lastInsertRowid;
    logAudit('spots', newId, 'INSERT', null, { ...s, id: newId });
    return Number(newId);
  },

  update(id, fields) {
    const db = getDb();
    const existing = this.getById(id);
    if (!existing) return false;

    const setClauses = [];
    const params = {};
    for (const [key, val] of Object.entries(fields)) {
      const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      setClauses.push(`${col} = @${col}`);
      if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
        params[col] = JSON.stringify(val);
      } else if (Array.isArray(val)) {
        params[col] = JSON.stringify(val);
      } else {
        params[col] = val;
      }
    }
    setClauses.push("updated_at = datetime('now')");
    params.id = id;

    db.prepare(`UPDATE spots SET ${setClauses.join(', ')} WHERE id = @id`).run(params);
    logAudit('spots', id, 'UPDATE', existing, fields);
    return true;
  },

  delete(id) {
    const db = getDb();
    const existing = this.getById(id);
    if (!existing) return false;
    db.prepare('DELETE FROM spots WHERE id = ?').run(id);
    logAudit('spots', id, 'DELETE', existing, null);
    return true;
  },

  deleteAutomated() {
    const db = getDb();
    const count = db.prepare("SELECT COUNT(*) as cnt FROM spots WHERE source = 'automated' AND manual_override = 0").get().cnt;
    db.prepare("DELETE FROM spots WHERE source = 'automated' AND manual_override = 0").run();
    return count;
  },

  maxId() {
    const row = getDb().prepare('SELECT MAX(id) as max_id FROM spots').get();
    return row.max_id || 0;
  },

  count() {
    return getDb().prepare('SELECT COUNT(*) as cnt FROM spots').get().cnt;
  },
};

// ── Gold Extractions ────────────────────────────────────────────
const gold = {
  get(venueId) {
    return getDb().prepare('SELECT * FROM gold_extractions WHERE venue_id = ?').get(venueId);
  },

  getAll() {
    return getDb().prepare('SELECT * FROM gold_extractions ORDER BY venue_id').all();
  },

  upsert(g) {
    const db = getDb();
    const existing = this.get(g.venue_id || g.venueId);
    const venueId = g.venue_id || g.venueId;
    db.prepare(`
      INSERT INTO gold_extractions (venue_id, venue_name, promotions, source_hash, normalized_source_hash, processed_at, updated_at)
      VALUES (@venue_id, @venue_name, @promotions, @source_hash, @normalized_source_hash, @processed_at, datetime('now'))
      ON CONFLICT(venue_id) DO UPDATE SET
        venue_name=@venue_name, promotions=@promotions, source_hash=@source_hash,
        normalized_source_hash=@normalized_source_hash, processed_at=@processed_at,
        updated_at=datetime('now')
    `).run({
      venue_id: venueId,
      venue_name: g.venue_name || g.venueName || null,
      promotions: typeof g.promotions === 'string' ? g.promotions : JSON.stringify(g.promotions),
      source_hash: g.source_hash || g.sourceHash || null,
      normalized_source_hash: g.normalized_source_hash || g.normalizedSourceHash || null,
      processed_at: g.processed_at || g.processedAt || null,
    });
    logAudit('gold_extractions', venueId, existing ? 'UPDATE' : 'INSERT', existing, g);
  },

  count() {
    return getDb().prepare('SELECT COUNT(*) as cnt FROM gold_extractions').get().cnt;
  },

  getWithPromotions() {
    return getDb().prepare(`
      SELECT * FROM gold_extractions
      WHERE json_extract(promotions, '$.found') = 1
      ORDER BY venue_id
    `).all();
  },
};

// ── Areas ───────────────────────────────────────────────────────
const areas = {
  getAll() {
    return getDb().prepare('SELECT * FROM areas ORDER BY name').all();
  },

  getNames() {
    return getDb().prepare('SELECT name FROM areas ORDER BY name').all().map(r => r.name);
  },

  upsert(a) {
    const db = getDb();
    db.prepare(`
      INSERT INTO areas (name, display_name, description, center_lat, center_lng, radius_meters, bounds, zip_codes)
      VALUES (@name, @display_name, @description, @center_lat, @center_lng, @radius_meters, @bounds, @zip_codes)
      ON CONFLICT(name) DO UPDATE SET
        display_name=@display_name, description=@description,
        center_lat=@center_lat, center_lng=@center_lng,
        radius_meters=@radius_meters, bounds=@bounds, zip_codes=@zip_codes
    `).run({
      name: a.name,
      display_name: a.displayName || a.display_name || null,
      description: a.description || null,
      center_lat: a.center?.lat || a.center_lat || null,
      center_lng: a.center?.lng || a.center_lng || null,
      radius_meters: a.radiusMeters || a.radius_meters || null,
      bounds: a.bounds ? (typeof a.bounds === 'string' ? a.bounds : JSON.stringify(a.bounds)) : null,
      zip_codes: a.zipCodes || a.zip_codes ? (typeof (a.zipCodes || a.zip_codes) === 'string' ? (a.zipCodes || a.zip_codes) : JSON.stringify(a.zipCodes || a.zip_codes)) : null,
    });
  },
};

// ── Activities ──────────────────────────────────────────────────
const activities = {
  getAll() {
    return getDb().prepare('SELECT * FROM activities ORDER BY name').all();
  },

  upsert(a) {
    getDb().prepare(`
      INSERT INTO activities (name, icon, emoji, color, community_driven)
      VALUES (@name, @icon, @emoji, @color, @community_driven)
      ON CONFLICT(name) DO UPDATE SET
        icon=@icon, emoji=@emoji, color=@color, community_driven=@community_driven
    `).run({
      name: a.name,
      icon: a.icon || null,
      emoji: a.emoji || null,
      color: a.color || null,
      community_driven: a.communityDriven || a.community_driven ? 1 : 0,
    });
  },
};

// ── Watchlist ───────────────────────────────────────────────────
const watchlist = {
  getAll() {
    return getDb().prepare('SELECT * FROM watchlist ORDER BY name').all();
  },

  getExcluded() {
    return getDb().prepare("SELECT * FROM watchlist WHERE status = 'excluded'").all();
  },

  getExcludedIds() {
    return new Set(
      getDb().prepare("SELECT venue_id FROM watchlist WHERE status = 'excluded'").all().map(r => r.venue_id)
    );
  },

  getFlagged() {
    return getDb().prepare("SELECT * FROM watchlist WHERE status = 'flagged'").all();
  },

  getFlaggedIds() {
    return new Set(
      getDb().prepare("SELECT venue_id FROM watchlist WHERE status = 'flagged'").all().map(r => r.venue_id)
    );
  },

  upsert(w) {
    getDb().prepare(`
      INSERT INTO watchlist (venue_id, name, area, status, reason, updated_at)
      VALUES (@venue_id, @name, @area, @status, @reason, datetime('now'))
      ON CONFLICT(venue_id) DO UPDATE SET
        name=@name, area=@area, status=@status, reason=@reason, updated_at=datetime('now')
    `).run({
      venue_id: w.venue_id || w.venueId,
      name: w.name || null,
      area: w.area || null,
      status: w.status,
      reason: w.reason || null,
    });
  },

  count() {
    return getDb().prepare('SELECT COUNT(*) as cnt FROM watchlist').get().cnt;
  },
};

// ── Pipeline State (key/value) ──────────────────────────────────
const config = {
  get(key) {
    const row = getDb().prepare('SELECT value FROM pipeline_state WHERE key = ?').get(key);
    return row ? row.value : null;
  },

  getAll() {
    const rows = getDb().prepare('SELECT key, value FROM pipeline_state').all();
    const obj = {};
    for (const r of rows) obj[r.key] = r.value;
    return obj;
  },

  set(key, value) {
    getDb().prepare(`
      INSERT INTO pipeline_state (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `).run(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  },

  loadConfig() {
    const all = this.getAll();
    const todayStr = (() => {
      const d = new Date();
      return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    })();
    return {
      run_date: all.run_date || todayStr,
      last_raw_processed_date: all.last_raw_processed_date || null,
      last_merged_processed_date: all.last_merged_processed_date || null,
      last_trimmed_processed_date: all.last_trimmed_processed_date || null,
      last_run_status: all.last_run_status || 'idle',
      pipeline: {
        maxIncrementalFiles: parseInt(all['pipeline.maxIncrementalFiles'] || '15', 10),
      },
    };
  },

  saveConfig(cfg) {
    const db = getDb();
    const txn = db.transaction(() => {
      this.set('run_date', cfg.run_date);
      if (cfg.last_raw_processed_date !== undefined) this.set('last_raw_processed_date', cfg.last_raw_processed_date || '');
      if (cfg.last_merged_processed_date !== undefined) this.set('last_merged_processed_date', cfg.last_merged_processed_date || '');
      if (cfg.last_trimmed_processed_date !== undefined) this.set('last_trimmed_processed_date', cfg.last_trimmed_processed_date || '');
      if (cfg.last_run_status !== undefined) this.set('last_run_status', cfg.last_run_status);
      if (cfg.pipeline?.maxIncrementalFiles !== undefined) this.set('pipeline.maxIncrementalFiles', String(cfg.pipeline.maxIncrementalFiles));
    });
    txn();
  },
};

// ── Pipeline Runs ───────────────────────────────────────────────
const pipelineRuns = {
  create(run) {
    const db = getDb();
    const info = db.prepare(`
      INSERT INTO pipeline_runs (started_at, finished_at, status, area_filter, run_date, steps, manifest)
      VALUES (@started_at, @finished_at, @status, @area_filter, @run_date, @steps, @manifest)
    `).run({
      started_at: run.startedAt || run.started_at || null,
      finished_at: run.finishedAt || run.finished_at || null,
      status: run.status || null,
      area_filter: run.areaFilter || run.area_filter || null,
      run_date: run.runDate || run.run_date || null,
      steps: run.steps ? (typeof run.steps === 'string' ? run.steps : JSON.stringify(run.steps)) : null,
      manifest: run.manifest ? (typeof run.manifest === 'string' ? run.manifest : JSON.stringify(run.manifest)) : null,
    });
    return Number(info.lastInsertRowid);
  },

  update(id, fields) {
    const setClauses = [];
    const params = { id };
    for (const [key, val] of Object.entries(fields)) {
      const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      setClauses.push(`${col} = @${col}`);
      params[col] = (val !== null && typeof val === 'object') ? JSON.stringify(val) : val;
    }
    if (setClauses.length === 0) return;
    getDb().prepare(`UPDATE pipeline_runs SET ${setClauses.join(', ')} WHERE id = @id`).run(params);
  },

  latest() {
    return getDb().prepare('SELECT * FROM pipeline_runs ORDER BY id DESC LIMIT 1').get();
  },

  getByDate(runDate) {
    return getDb().prepare('SELECT * FROM pipeline_runs WHERE run_date = ? ORDER BY id DESC').all(runDate);
  },
};

// ── Update Streaks ──────────────────────────────────────────────
const streaks = {
  get(venueId, type) {
    return getDb().prepare('SELECT * FROM update_streaks WHERE venue_id = ? AND type = ?').get(venueId, type);
  },

  getAll() {
    return getDb().prepare('SELECT * FROM update_streaks ORDER BY streak DESC').all();
  },

  upsert(venueId, type, name, lastDate, streak) {
    getDb().prepare(`
      INSERT INTO update_streaks (venue_id, type, name, last_date, streak)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(venue_id, type) DO UPDATE SET
        name=excluded.name, last_date=excluded.last_date, streak=excluded.streak
    `).run(venueId, type, name, lastDate, streak);
  },
};

// ── Transactions ────────────────────────────────────────────────
function transaction(fn) {
  return getDb().transaction(fn)();
}

// ── Audit ───────────────────────────────────────────────────────
const audit = {
  log: logAudit,

  recent(limit = 50) {
    return getDb().prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit);
  },

  byTable(tableName, limit = 50) {
    return getDb().prepare('SELECT * FROM audit_log WHERE table_name = ? ORDER BY id DESC LIMIT ?').all(tableName, limit);
  },
};

module.exports = {
  getDb,
  getDbPath,
  closeDb,
  ensureSchema,
  venues,
  spots,
  gold,
  areas,
  activities,
  watchlist,
  config,
  pipelineRuns,
  streaks,
  audit,
  transaction,
};
