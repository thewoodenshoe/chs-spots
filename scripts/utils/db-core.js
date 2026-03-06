/**
 * Database core — shared connection, schema bootstrap, audit, and cross-cutting helpers.
 * All other db-*.js modules import from this file to avoid circular deps.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let _db = null;
let _auditContext = { changeSource: 'unknown', scriptName: null };

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
  if (_db) { _db.close(); _db = null; }
}

function ensureSchema() {
  const db = getDb();
  const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  db.exec(sql);
}

/**
 * Set the audit context for all subsequent logAudit calls in this process.
 * Call once at script startup: setAuditContext('pipeline', 'create-spots')
 */
function setAuditContext(changeSource, scriptName) {
  _auditContext = { changeSource: changeSource || 'unknown', scriptName: scriptName || null };
}

function logAudit(tableName, rowId, action, oldData, newData) {
  try {
    getDb().prepare(
      `INSERT INTO audit_log (table_name, row_id, action, change_source, script_name, old_data, new_data)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      tableName, String(rowId), action,
      _auditContext.changeSource, _auditContext.scriptName,
      oldData ? JSON.stringify(oldData) : null,
      newData ? JSON.stringify(newData) : null,
    );
  } catch (_err) {
    // Fallback for pre-migration DBs missing change_source/script_name columns
    getDb().prepare(
      `INSERT INTO audit_log (table_name, row_id, action, old_data, new_data)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      tableName, String(rowId), action,
      oldData ? JSON.stringify(oldData) : null,
      newData ? JSON.stringify(newData) : null,
    );
  }
}

const ACTIVITY_FLAG_MAP = {
  'Happy Hour': 'is_happy_hour',
  'Brunch': 'is_brunch',
  'Live Music': 'is_live_music',
  'Rooftop Bar': 'is_rooftop_bar',
  'Coffee Shop': 'is_coffee_shop',
  'Landmarks & Attractions': 'is_landmark',
  'Dog Friendly': 'is_dog_friendly',
  'Waterfront Dining': 'is_waterfront',
};

let _flagSyncWarned = false;

function syncActivityFlags(venueId) {
  if (!venueId) return;
  try {
    const setClauses = Object.entries(ACTIVITY_FLAG_MAP).map(
      ([type, col]) =>
        `${col} = (SELECT COUNT(*) > 0 FROM spots WHERE venue_id = @vid AND type = '${type}' AND status = 'approved')`,
    );
    getDb().prepare(`
      UPDATE venues SET ${setClauses.join(', ')}, updated_at = datetime('now')
      WHERE id = @vid
    `).run({ vid: venueId });
  } catch (err) {
    if (!_flagSyncWarned) {
      console.warn(`[db-core] syncActivityFlags failed for ${venueId}: ${err.message}`);
      _flagSyncWarned = true;
    }
  }
}

function transaction(fn) {
  return getDb().transaction(fn)();
}

/**
 * Generate a sequential venue ID in the format ven_NNNN.
 * Google Place IDs (ChIJ...) should be stored in google_place_id column instead.
 */
function generateVenueId() {
  const row = getDb().prepare(
    "SELECT MAX(CAST(SUBSTR(id, 5) AS INTEGER)) as m FROM venues WHERE id LIKE 'ven_%'",
  ).get();
  const next = (row?.m || 0) + 1;
  return `ven_${next}`;
}

module.exports = {
  getDb, getDbPath, closeDb, ensureSchema,
  logAudit, setAuditContext, syncActivityFlags, ACTIVITY_FLAG_MAP,
  transaction, generateVenueId,
};
