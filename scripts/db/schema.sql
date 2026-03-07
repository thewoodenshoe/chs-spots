-- CHS Spots SQLite Schema
-- Version: 002
-- Master-detail: venues own geo/contact data; spots are activity-specific details.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS venues (
  id TEXT PRIMARY KEY,
  google_place_id TEXT,
  name TEXT NOT NULL,
  address TEXT,
  lat REAL NOT NULL CHECK(lat BETWEEN -90 AND 90),
  lng REAL NOT NULL CHECK(lng BETWEEN -180 AND 180),
  area TEXT,
  website TEXT,
  photo_url TEXT,
  types TEXT,
  raw_google_data TEXT,
  operating_hours TEXT,
  hours_source TEXT,
  hours_updated_at TEXT,
  phone TEXT,
  description TEXT,
  submitter_name TEXT,
  venue_added_at TEXT DEFAULT '2001-01-01',
  venue_status TEXT NOT NULL DEFAULT 'active' CHECK(venue_status IN ('active','coming_soon','recently_opened')),
  expected_open_date TEXT,
  is_happy_hour INTEGER DEFAULT 0,
  is_brunch INTEGER DEFAULT 0,
  is_live_music INTEGER DEFAULT 0,
  is_rooftop_bar INTEGER DEFAULT 0,
  is_coffee_shop INTEGER DEFAULT 0,
  is_landmark INTEGER DEFAULT 0,
  is_dog_friendly INTEGER DEFAULT 0,
  is_waterfront INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Spots: activity-specific details linked to a venue (master-detail).
-- Geo data (lat, lng, area) lives on venues; spots carry activity-specific data only.
CREATE TABLE IF NOT EXISTS spots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venue_id TEXT NOT NULL REFERENCES venues(id),
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'Happy Hour',
  source TEXT NOT NULL CHECK(source IN ('automated','manual')),
  status TEXT NOT NULL DEFAULT 'approved',
  description TEXT,
  promotion_time TEXT,
  promotion_list TEXT,
  time_start TEXT,
  time_end TEXT,
  days TEXT,
  specific_date TEXT,
  source_url TEXT,
  submitter_name TEXT,
  manual_override INTEGER DEFAULT 0,
  photo_url TEXT,
  last_update_date TEXT,
  pending_edit TEXT,
  pending_delete INTEGER DEFAULT 0,
  submitted_at TEXT,
  edited_at TEXT,
  finding_approved INTEGER DEFAULT 0,
  finding_rationale TEXT,
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
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activities (
  name TEXT PRIMARY KEY,
  icon TEXT,
  emoji TEXT,
  color TEXT,
  community_driven INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS watchlist (
  venue_id TEXT PRIMARY KEY REFERENCES venues(id),
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
  venue_id TEXT NOT NULL REFERENCES venues(id),
  type TEXT NOT NULL,
  name TEXT,
  last_date TEXT,
  streak INTEGER DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (venue_id, type)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  row_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('INSERT','UPDATE','DELETE')),
  change_source TEXT NOT NULL DEFAULT 'unknown',
  script_name TEXT,
  old_data TEXT,
  new_data TEXT,
  timestamp TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS confidence_reviews (
  venue_id TEXT NOT NULL REFERENCES venues(id),
  activity_type TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('approved','rejected')),
  reason TEXT,
  reviewed_source_hash TEXT,
  effective_confidence INTEGER,
  flags TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','llm','auto')),
  llm_confidence INTEGER,
  reviewed_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (venue_id, activity_type)
);

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT DEFAULT (datetime('now')),
  description TEXT
);

-- Change audit log (tracks all spot edit submissions and approvals)
CREATE TABLE IF NOT EXISTS change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  spot_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  changes_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (spot_id) REFERENCES spots(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_spots_venue ON spots(venue_id);
CREATE INDEX IF NOT EXISTS idx_spots_type ON spots(type);
CREATE INDEX IF NOT EXISTS idx_spots_source ON spots(source);
CREATE INDEX IF NOT EXISTS idx_spots_status ON spots(status);
CREATE INDEX IF NOT EXISTS idx_spots_venue_type ON spots(venue_id, type);
CREATE INDEX IF NOT EXISTS idx_venues_area ON venues(area);
CREATE INDEX IF NOT EXISTS idx_venues_status ON venues(venue_status);
CREATE INDEX IF NOT EXISTS idx_venues_added_at ON venues(venue_added_at);
CREATE INDEX IF NOT EXISTS idx_venues_google_place ON venues(google_place_id);
CREATE INDEX IF NOT EXISTS idx_gold_venue ON gold_extractions(venue_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_status ON watchlist(status);
CREATE INDEX IF NOT EXISTS idx_audit_table ON audit_log(table_name, timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_source ON audit_log(change_source);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_date ON pipeline_runs(run_date);
CREATE INDEX IF NOT EXISTS idx_confidence_reviews_decision ON confidence_reviews(decision);
CREATE INDEX IF NOT EXISTS idx_change_log_spot ON change_log(spot_id);
CREATE INDEX IF NOT EXISTS idx_change_log_action ON change_log(action);
