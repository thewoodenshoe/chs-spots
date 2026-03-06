#!/usr/bin/env node
/**
 * One-shot backfill: scan venues with venue_status='recently_opened'
 * for secondary activity-type signals and create cross-tagged spots.
 *
 * Usage: node scripts/backfill-cross-tags.js [--dry-run]
 */

const db = require('./utils/db');
const { detectSecondaryTypes } = require('./utils/activity-tagger');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const venues = db.venues.getByStatus('recently_opened');
  console.log(`Scanning ${venues.length} recently_opened venue(s) for cross-tagging…`);

  let created = 0;
  let skipped = 0;

  for (const venue of venues) {
    const text = `${venue.name} ${venue.types || ''}`;
    const secondaryTypes = detectSecondaryTypes(text, 'Recently Opened');

    for (const secType of secondaryTypes) {
      const exists = db.getDb().prepare(
        'SELECT id FROM spots WHERE venue_id = ? AND type = ?',
      ).get(venue.id, secType);

      if (exists) {
        skipped++;
        console.log(`  ⏭️  ${venue.name} already has [${secType}] (#${exists.id})`);
        continue;
      }

      if (DRY_RUN) {
        console.log(`  🏷️  [DRY] Would create: ${venue.name} [${secType}]`);
        created++;
        continue;
      }

      const newId = db.spots.insert({
        venue_id: venue.id,
        title: venue.name,
        type: secType,
        source: 'automated',
        status: 'approved',
        description: null,
        source_url: venue.website || null,
        last_update_date: new Date().toISOString().slice(0, 10),
      });
      created++;
      console.log(`  🏷️  #${newId}: ${venue.name} [${secType}]`);
    }
  }

  console.log(`\nDone. Created: ${created}, Skipped (already exists): ${skipped}`);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
