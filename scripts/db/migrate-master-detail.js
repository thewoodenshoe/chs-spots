#!/usr/bin/env node
/**
 * Master-Detail Migration — adds venue-level columns, backfills data,
 * creates venues for orphan spots, migrates Coming Soon / Recently Opened
 * from spot types to venue_status, and computes activity flags.
 *
 * Safe to run multiple times (idempotent).
 * Usage: node scripts/db/migrate-master-detail.js
 */

const { createLogger } = require('../utils/logger');
const { getDb, syncActivityFlags, ACTIVITY_FLAG_MAP } = require('../utils/db-core');

const log = createLogger('migrate-master-detail');

const VENUE_COLUMNS = [
  { name: 'venue_added_at', def: "TEXT DEFAULT '2001-01-01'" },
  { name: 'venue_status', def: "TEXT DEFAULT 'active'" },
  { name: 'expected_open_date', def: 'TEXT' },
  { name: 'submitter_name', def: 'TEXT' },
  ...Object.values(ACTIVITY_FLAG_MAP).map(col => ({ name: col, def: 'INTEGER DEFAULT 0' })),
];

const DOWNTOWN_LAT = 32.7765;
const DOWNTOWN_LNG = -79.9311;

function addVenueColumns(db) {
  const existing = new Set(
    db.prepare('PRAGMA table_info(venues)').all().map(c => c.name),
  );
  let added = 0;
  for (const col of VENUE_COLUMNS) {
    if (!existing.has(col.name)) {
      db.prepare(`ALTER TABLE venues ADD COLUMN ${col.name} ${col.def}`).run();
      log.log(`  Added venues.${col.name}`);
      added++;
    }
  }
  db.prepare('CREATE INDEX IF NOT EXISTS idx_venues_status ON venues(venue_status)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_venues_added_at ON venues(venue_added_at)').run();
  log.log(`Step 1 complete: ${added} columns added`);
}

function backfillVenueAddedAt(db) {
  const result = db.prepare(
    "UPDATE venues SET venue_added_at = '2001-01-01' WHERE venue_added_at IS NULL",
  ).run();
  log.log(`Step 2 complete: backfilled venue_added_at for ${result.changes} venues`);
}

function createVenuesForOrphans(db) {
  const orphans = db.prepare(
    "SELECT * FROM spots WHERE venue_id IS NULL AND status != 'expired'",
  ).all();
  if (orphans.length === 0) {
    log.log('Step 3 complete: no orphan spots found');
    return;
  }
  const venuesByTitle = {};
  let created = 0;
  let linked = 0;
  for (const spot of orphans) {
    const key = (spot.title || '').toLowerCase().trim();
    if (!venuesByTitle[key]) {
      const venueId = `manual_${spot.id}_${Date.now()}`;
      const lat = spot.lat || DOWNTOWN_LAT;
      const lng = spot.lng || DOWNTOWN_LNG;
      const area = spot.area || 'Downtown Charleston';
      db.prepare(`
        INSERT OR IGNORE INTO venues (id, name, lat, lng, area, venue_added_at, venue_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, '2001-01-01', 'active', datetime('now'), datetime('now'))
      `).run(venueId, spot.title, lat, lng, area);
      venuesByTitle[key] = venueId;
      created++;
    }
    db.prepare('UPDATE spots SET venue_id = ? WHERE id = ?').run(venuesByTitle[key], spot.id);
    linked++;
  }
  log.log(`Step 3 complete: created ${created} venues, linked ${linked} orphan spots`);
}

function migrateCSRO(db) {
  const csSpots = db.prepare(
    "SELECT DISTINCT venue_id FROM spots WHERE type = 'Coming Soon' AND status = 'approved' AND venue_id IS NOT NULL",
  ).all();
  for (const row of csSpots) {
    db.prepare(
      "UPDATE venues SET venue_status = 'coming_soon', updated_at = datetime('now') WHERE id = ? AND venue_status = 'active'",
    ).run(row.venue_id);
  }
  const roSpots = db.prepare(
    "SELECT DISTINCT venue_id FROM spots WHERE type = 'Recently Opened' AND status = 'approved' AND venue_id IS NOT NULL",
  ).all();
  for (const row of roSpots) {
    db.prepare(
      "UPDATE venues SET venue_status = 'recently_opened', updated_at = datetime('now') WHERE id = ? AND venue_status = 'active'",
    ).run(row.venue_id);
  }
  log.log(`Step 4 complete: migrated ${csSpots.length} CS + ${roSpots.length} RO venues`);
}

function computeActivityFlags(db) {
  const allVenues = db.prepare('SELECT id FROM venues').all();
  for (const v of allVenues) {
    syncActivityFlags(v.id);
  }
  log.log(`Step 5 complete: computed activity flags for ${allVenues.length} venues`);
}

function expireCSROSpots(db) {
  const result = db.prepare(`
    UPDATE spots SET status = 'expired', updated_at = datetime('now')
    WHERE type IN ('Coming Soon', 'Recently Opened') AND status = 'approved'
  `).run();
  log.log(`Step 6 complete: expired ${result.changes} CS/RO spot rows`);
}

async function main() {
  const db = getDb();
  log.log('=== Master-Detail Migration ===');
  log.log(`Database: ${require('../utils/db-core').getDbPath()}`);

  const venueCount = db.prepare('SELECT COUNT(*) as cnt FROM venues').get().cnt;
  const spotCount = db.prepare('SELECT COUNT(*) as cnt FROM spots').get().cnt;
  const orphanCount = db.prepare(
    "SELECT COUNT(*) as cnt FROM spots WHERE venue_id IS NULL AND status != 'expired'",
  ).get().cnt;
  log.log(`Before: ${venueCount} venues, ${spotCount} spots, ${orphanCount} orphans`);

  db.transaction(() => {
    addVenueColumns(db);
    backfillVenueAddedAt(db);
    createVenuesForOrphans(db);
    migrateCSRO(db);
    computeActivityFlags(db);
    expireCSROSpots(db);
  })();

  const finalOrphans = db.prepare(
    "SELECT COUNT(*) as cnt FROM spots WHERE venue_id IS NULL AND status != 'expired'",
  ).get().cnt;
  log.log(`After: ${finalOrphans} remaining orphan spots`);
  log.log('=== Migration Complete ===');
}

main().catch(err => {
  log.error(`Migration failed: ${err.message}`);
  process.exit(1);
});
