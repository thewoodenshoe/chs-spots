#!/usr/bin/env node
/**
 * Migration 004: Add description column to venues table.
 *
 * Status spots (Recently Opened / Coming Soon) are synthesized from venues,
 * so venue-level descriptions are needed to show meaningful info in the UI.
 *
 * Usage: node scripts/db/migrate-004-venue-description.js
 */

const { getDb, closeDb } = require('../utils/db-core');

function migrate() {
  const db = getDb();
  const cols = db.prepare("PRAGMA table_info('venues')").all();
  if (cols.some(c => c.name === 'description')) {
    console.log('[migrate-004] description column already exists — skipping');
    return;
  }

  db.prepare('ALTER TABLE venues ADD COLUMN description TEXT').run();
  db.prepare(
    "INSERT OR REPLACE INTO schema_version (version, description) VALUES (4, 'Add venue description column')",
  ).run();
  console.log('[migrate-004] Added description column to venues');
}

migrate();
closeDb();
