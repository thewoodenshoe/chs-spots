#!/usr/bin/env node
/**
 * Migration 002: Schema hardening
 * - Add google_place_id, change_source, script_name columns
 * - Add missing indexes, updated_at columns
 * - Backfill google_place_id from existing venue IDs that look like Place IDs
 */

const { getDb, closeDb } = require('../utils/db-core');
const { createLogger } = require('../utils/logger');

const { log, close: closeLog } = createLogger('migrate-002');

function addColumnIfMissing(db, table, column, definition) {
  const cols = db.pragma(`table_info(${table})`);
  if (cols.some(c => c.name === column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  log(`Added ${table}.${column}`);
  return true;
}

function main() {
  const db = getDb();

  log('Migration 002: Schema hardening');

  // venues.google_place_id
  addColumnIfMissing(db, 'venues', 'google_place_id', 'TEXT');

  // audit_log.change_source and script_name
  addColumnIfMissing(db, 'audit_log', 'change_source', "TEXT NOT NULL DEFAULT 'unknown'");
  addColumnIfMissing(db, 'audit_log', 'script_name', 'TEXT');

  // activities timestamps (SQLite ALTER TABLE requires constant defaults)
  addColumnIfMissing(db, 'activities', 'created_at', 'TEXT');
  addColumnIfMissing(db, 'activities', 'updated_at', 'TEXT');

  // areas.updated_at
  addColumnIfMissing(db, 'areas', 'updated_at', 'TEXT');

  // update_streaks.updated_at
  addColumnIfMissing(db, 'update_streaks', 'updated_at', 'TEXT');

  // New indexes
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_spots_status ON spots(status)',
    'CREATE INDEX IF NOT EXISTS idx_spots_venue_type ON spots(venue_id, type)',
    'CREATE INDEX IF NOT EXISTS idx_venues_google_place ON venues(google_place_id)',
    'CREATE INDEX IF NOT EXISTS idx_audit_source ON audit_log(change_source)',
  ];
  for (const sql of indexes) {
    db.exec(sql);
  }
  log('Indexes created');

  // Backfill google_place_id from venue IDs that look like Google Place IDs (ChIJ...)
  const placeIdVenues = db.prepare(
    "SELECT id FROM venues WHERE id LIKE 'ChIJ%' AND (google_place_id IS NULL OR google_place_id = '')",
  ).all();
  if (placeIdVenues.length > 0) {
    const stmt = db.prepare("UPDATE venues SET google_place_id = id WHERE id = ?");
    for (const v of placeIdVenues) stmt.run(v.id);
    log(`Backfilled google_place_id for ${placeIdVenues.length} venue(s)`);
  }

  // Record migration
  db.prepare(
    "INSERT OR IGNORE INTO schema_version (version, description) VALUES (2, 'Schema hardening: constraints, indexes, audit columns')",
  ).run();

  log('Migration 002 complete');
  closeLog();
  closeDb();
}

main();
