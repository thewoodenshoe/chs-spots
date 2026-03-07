#!/usr/bin/env node
/**
 * Migration 005: Add change_log table for audit trail of spot/venue edits.
 */
const db = require('../utils/db');

function run() {
  const raw = db.getDb();
  const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='change_log'").all();
  if (tables.length > 0) {
    console.log('[migrate-005] change_log table already exists — skipping');
    db.closeDb();
    return;
  }
  raw.exec(`
    CREATE TABLE change_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spot_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      changes_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (spot_id) REFERENCES spots(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_change_log_spot ON change_log(spot_id);
    CREATE INDEX idx_change_log_action ON change_log(action);
  `);
  raw.prepare(
    "INSERT OR REPLACE INTO schema_version (version, description) VALUES (5, 'Add change_log audit table')",
  ).run();
  console.log('[migrate-005] Created change_log table');
  db.closeDb();
}

run();
