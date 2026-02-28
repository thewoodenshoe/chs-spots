#!/usr/bin/env node
/**
 * backfill-venue-links.js — One-time script to link orphaned manual spots
 * to their matching venues using proximity + name similarity.
 *
 * Usage: node scripts/backfill-venue-links.js [--dry-run]
 */

const path = require('path');

// dotenv is optional — env vars may already be set by the shell or PM2
try {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local') });
} catch { /* dotenv not installed in production; env vars set by PM2 */ }

const db = require('./utils/db');
const { findMatchingVenue } = require('./utils/venue-match');

const DRY_RUN = process.argv.includes('--dry-run');

function main() {
  const database = db.getDb();

  const orphans = database.prepare(
    "SELECT id, title, lat, lng, area, type FROM spots WHERE source = 'manual' AND venue_id IS NULL AND lat IS NOT NULL AND lng IS NOT NULL"
  ).all();

  console.log(`Found ${orphans.length} orphaned manual spots`);
  if (DRY_RUN) console.log('(DRY RUN — no changes will be made)\n');

  let linked = 0;
  let skipped = 0;

  for (const spot of orphans) {
    const match = findMatchingVenue(spot.title, spot.lat, spot.lng);
    if (!match) {
      skipped++;
      continue;
    }

    const venue = database.prepare('SELECT area FROM venues WHERE id = ?').get(match.venueId);
    const venueArea = venue?.area || spot.area;

    if (DRY_RUN) {
      console.log(`  LINK #${spot.id} "${spot.title}" → "${match.venueName}" (${match.distance}m, score=${match.score.toFixed(2)})`);
    } else {
      database.prepare(
        "UPDATE spots SET venue_id = ?, area = COALESCE(?, area), updated_at = datetime('now') WHERE id = ?"
      ).run(match.venueId, venueArea, spot.id);
      console.log(`  LINKED #${spot.id} "${spot.title}" → "${match.venueName}" (${match.distance}m)`);
    }
    linked++;
  }

  console.log(`\nDone: ${linked} linked, ${skipped} skipped (no match)`);
  if (DRY_RUN) console.log('Run without --dry-run to apply changes');

  db.closeDb();
}

main();
