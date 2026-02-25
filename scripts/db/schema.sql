-- CHS Spots SQLite Schema
-- Version: 001
-- Migrated from file-based JSON storage

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS venues (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  area TEXT,
  website TEXT,
  photo_url TEXT,
  types TEXT,
  raw_google_data TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS spots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venue_id TEXT REFERENCES venues(id),
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'Happy Hour',
  source TEXT NOT NULL CHECK(source IN ('automated','manual')),
  status TEXT DEFAULT 'approved',
  description TEXT,
  promotion_time TEXT,
  promotion_list TEXT,
  source_url TEXT,
  submitter_name TEXT,
  manual_override INTEGER DEFAULT 0,
  photo_url TEXT,
  last_update_date TEXT,
  pending_edit TEXT,
  pending_delete INTEGER DEFAULT 0,
  submitted_at TEXT,
  edited_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gold_extractions (
  venue_id TEXT PRIMARY KEY REFERENCES venues(id),
  venue_name TEXT,
  promotions TEXT NOT NULL,
  source_hash TEXT,
  normalized_source_hash TEXT,
  processed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS areas (
  name TEXT PRIMARY KEY,
  display_name TEXT,
  description TEXT,
  center_lat REAL,
  center_lng REAL,
  radius_meters REAL,
  bounds TEXT,
  zip_codes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activities (
  name TEXT PRIMARY KEY,
  icon TEXT,
  emoji TEXT,
  color TEXT,
  community_driven INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS watchlist (
  venue_id TEXT PRIMARY KEY,
  name TEXT,
  area TEXT,
  status TEXT NOT NULL CHECK(status IN ('excluded','flagged')),
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pipeline_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT,
  finished_at TEXT,
  status TEXT,
  area_filter TEXT,
  run_date TEXT,
  steps TEXT,
  manifest TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS update_streaks (
  venue_id TEXT NOT NULL,
  type TEXT NOT NULL,
  name TEXT,
  last_date TEXT,
  streak INTEGER DEFAULT 1,
  PRIMARY KEY (venue_id, type)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  row_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('INSERT','UPDATE','DELETE')),
  old_data TEXT,
  new_data TEXT,
  timestamp TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT DEFAULT (datetime('now')),
  description TEXT
);

CREATE INDEX IF NOT EXISTS idx_spots_venue ON spots(venue_id);
CREATE INDEX IF NOT EXISTS idx_spots_type ON spots(type);
CREATE INDEX IF NOT EXISTS idx_spots_source ON spots(source);
CREATE INDEX IF NOT EXISTS idx_venues_area ON venues(area);
CREATE INDEX IF NOT EXISTS idx_gold_venue ON gold_extractions(venue_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_status ON watchlist(status);
CREATE INDEX IF NOT EXISTS idx_audit_table ON audit_log(table_name, timestamp);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_date ON pipeline_runs(run_date);
