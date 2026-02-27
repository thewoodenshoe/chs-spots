#!/usr/bin/env node
/**
 * One-shot backfill: scan existing "Recently Opened" and "Coming Soon" spots
 * for secondary activity-type signals and create cross-tagged spots.
 *
 * Usage: node scripts/backfill-cross-tags.js [--dry-run]
 */

const db = require('./utils/db');
const { detectSecondaryTypes } = require('./utils/activity-tagger');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const spots = db.getDb().prepare(
    "SELECT * FROM spots WHERE type IN ('Recently Opened', 'Coming Soon') AND source = 'automated'",
  ).all();

  console.log(`Scanning ${spots.length} spots for cross-tagging…`);

  let created = 0;
  let skipped = 0;

  for (const spot of spots) {
    const text = `${spot.title} ${spot.description || ''}`;
    const secondaryTypes = detectSecondaryTypes(text, spot.type);

    for (const secType of secondaryTypes) {
      const exists = db.getDb().prepare(
        'SELECT id FROM spots WHERE venue_id = ? AND type = ? AND title = ?',
      ).get(spot.venue_id, secType, spot.title);

      if (exists) {
        skipped++;
        console.log(`  ⏭️  ${spot.title} already has [${secType}] (#${exists.id})`);
        continue;
      }

      if (DRY_RUN) {
        console.log(`  🏷️  [DRY] Would create: ${spot.title} [${secType}]`);
        created++;
        continue;
      }

      const newId = db.spots.insert({
        venue_id: spot.venue_id,
        title: spot.title,
        type: secType,
        source: 'automated',
        status: 'approved',
        description: spot.description,
        source_url: spot.source_url,
        lat: spot.lat,
        lng: spot.lng,
        area: spot.area,
        last_update_date: spot.last_update_date,
      });
      created++;
      console.log(`  🏷️  #${newId}: ${spot.title} [${secType}]`);
    }
  }

  console.log(`\nDone. Created: ${created}, Skipped (already exists): ${skipped}`);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
