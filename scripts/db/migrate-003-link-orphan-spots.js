#!/usr/bin/env node
/**
 * Migration 003: Link all orphan spots to venues.
 *
 * Enforces master-detail: every spot must have a venue_id.
 * For orphan spots (venue_id IS NULL), this script:
 *   1. Tries to match an existing venue by name
 *   2. If no match, creates a new venue from the spot's lat/lng/area
 *   3. Sets venue_status for Coming Soon / Recently Opened spots
 *
 * Usage: node scripts/db/migrate-003-link-orphan-spots.js [--dry-run]
 */

const db = require('../utils/db');
const { createLogger } = require('../utils/logger');

const { log } = createLogger('migrate-003');
const DRY_RUN = process.argv.includes('--dry-run');

const STATUS_MAP = {
  'Coming Soon': 'coming_soon',
  'Recently Opened': 'recently_opened',
};

function findMatchingVenue(database, name, lat, lng) {
  const byName = database.prepare(
    'SELECT id, name FROM venues WHERE LOWER(name) = LOWER(?)',
  ).get(name);
  if (byName) return byName;

  if (lat && lng) {
    const nearby = database.prepare(`
      SELECT id, name,
        ABS(lat - ?) + ABS(lng - ?) as dist
      FROM venues
      WHERE ABS(lat - ?) < 0.002 AND ABS(lng - ?) < 0.002
      ORDER BY dist LIMIT 1
    `).get(lat, lng, lat, lng);
    if (nearby && nearby.dist < 0.001) return nearby;
  }

  return null;
}

function main() {
  db.setAuditContext('migration', 'migrate-003');
  const database = db.getDb();

  const orphans = database.prepare(`
    SELECT id, title, type, lat, lng, area, source, submitter_name
    FROM spots WHERE venue_id IS NULL
    ORDER BY id
  `).all();

  log(`Found ${orphans.length} orphan spots (venue_id IS NULL)`);
  if (orphans.length === 0) {
    log('Nothing to migrate');
    return;
  }

  let matched = 0;
  let created = 0;
  let statusSet = 0;

  const run = database.transaction(() => {
    for (const spot of orphans) {
      const existing = findMatchingVenue(database, spot.title, spot.lat, spot.lng);

      let venueId;
      if (existing) {
        venueId = existing.id;
        log(`  #${spot.id} "${spot.title}" -> matched venue ${venueId} "${existing.name}"`);
        matched++;
      } else {
        venueId = db.generateVenueId();
        if (!DRY_RUN) {
          db.venues.upsert({
            id: venueId,
            name: spot.title,
            lat: spot.lat || 0,
            lng: spot.lng || 0,
            area: spot.area || null,
            submitter_name: spot.submitter_name || 'migration-003',
          });
        }
        log(`  #${spot.id} "${spot.title}" -> created venue ${venueId}`);
        created++;
      }

      if (!DRY_RUN) {
        database.prepare('UPDATE spots SET venue_id = ? WHERE id = ?').run(venueId, spot.id);
        db.logAudit('spots', spot.id, 'UPDATE', { venue_id: null }, { venue_id: venueId });
      }

      const venueStatus = STATUS_MAP[spot.type];
      if (venueStatus) {
        if (!DRY_RUN) {
          db.venues.update(venueId, { venue_status: venueStatus });
        }
        log(`  -> set venue_status="${venueStatus}" on ${venueId}`);
        statusSet++;
      }
    }
  });

  if (DRY_RUN) {
    log('[DRY RUN] No changes made');
    for (const spot of orphans) {
      const existing = findMatchingVenue(database, spot.title, spot.lat, spot.lng);
      const action = existing ? `match ${existing.id}` : 'create new venue';
      log(`  #${spot.id} "${spot.title}" (${spot.type}) -> ${action}`);
    }
  } else {
    run();
  }

  const remaining = database.prepare(
    'SELECT COUNT(*) as c FROM spots WHERE venue_id IS NULL',
  ).get();

  log(`\nResults: matched=${matched}, created=${created}, statusSet=${statusSet}`);
  log(`Remaining orphans: ${remaining.c}`);

  if (!DRY_RUN && remaining.c > 0) {
    log('WARNING: Some spots still have venue_id IS NULL');
    process.exit(1);
  }

  log('Migration 003 complete');
}

main();
