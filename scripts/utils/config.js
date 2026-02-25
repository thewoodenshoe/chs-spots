/**
 * Config Utility - Load and Save Pipeline Configuration
 *
 * Reads/writes pipeline state via the SQLite DAL (db.js).
 */

const db = require('./db');

let _schemaReady = false;

function ensureReady() {
  if (!_schemaReady) {
    db.ensureSchema();
    _schemaReady = true;
  }
}

// Backward-compat exports (no longer used for I/O)
const CONFIG_PATH = '';
const WATCHLIST_PATH = '';

/**
 * Get today's date in YYYYMMDD format
 */
function getTodayDateString() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Load config from pipeline_state table.
 * Returns the same shape as the old JSON config.
 */
function loadConfig() {
  ensureReady();
  return db.config.loadConfig();
}

/**
 * Save config to pipeline_state table.
 */
function saveConfig(config) {
  ensureReady();
  try {
    db.config.saveConfig(config);
    return true;
  } catch (error) {
    console.error(`❌ Error saving config: ${error.message}`);
    return false;
  }
}

/**
 * Update a specific field in config.
 * Dot-notation keys like 'pipeline.maxIncrementalFiles' are stored as-is.
 */
function updateConfigField(field, value) {
  ensureReady();
  db.config.set(field, value);

  return loadConfig();
}

/**
 * Get run date from config or parameter
 */
function getRunDate(runDateParam = null) {
  if (runDateParam) {
    if (!/^\d{8}$/.test(runDateParam)) {
      throw new Error(`Invalid run_date format: ${runDateParam}. Expected YYYYMMDD`);
    }
    return runDateParam;
  }
  return getTodayDateString();
}

// ── Venue Watchlist ─────────────────────────────────────────────

let _watchlistCache = null;

/**
 * Load venue watchlist (excluded/flagged venues).
 * Returns { excluded: Set<venueId>, flagged: Set<venueId>, all: Map<venueId, entry> }
 * Caches result for the duration of the process.
 */
function loadWatchlist() {
  if (_watchlistCache) return _watchlistCache;

  ensureReady();

  const result = { excluded: new Set(), flagged: new Set(), all: new Map() };

  try {
    const rows = db.watchlist.getAll();
    for (const row of rows) {
      const id = row.venue_id;
      result.all.set(id, row);
      if (row.status === 'excluded') result.excluded.add(id);
      else if (row.status === 'flagged') result.flagged.add(id);
    }
  } catch (err) {
    console.warn(`⚠️  Could not load watchlist: ${err.message}`);
  }

  _watchlistCache = result;
  return result;
}

module.exports = {
  loadConfig,
  saveConfig,
  updateConfigField,
  getRunDate,
  getTodayDateString,
  loadWatchlist,
  CONFIG_PATH,
  WATCHLIST_PATH
};
