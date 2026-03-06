#!/usr/bin/env node
/**
 * One-time backfill: sync activity flags for all venues and normalize empty strings to NULL.
 *
 * Usage: node scripts/db/backfill-activity-flags.js [--dry-run]
 */

const db = require('../utils/db');

const DRY_RUN = process.argv.includes('--dry-run');

function normalizeEmptyStrings() {
  const database = db.getDb();
  const fields = ['website', 'phone', 'photo_url', 'address', 'operating_hours', 'hours_source'];
  let total = 0;

  for (const field of fields) {
    const count = database.prepare(
      `SELECT COUNT(*) as c FROM venues WHERE ${field} = ''`,
    ).get().c;
    if (count > 0) {
      console.log(`  ${field}: ${count} empty string(s) → NULL`);
      if (!DRY_RUN) {
        database.prepare(`UPDATE venues SET ${field} = NULL WHERE ${field} = ''`).run();
      }
      total += count;
    }
  }

  const spotFields = ['photo_url', 'source_url', 'description'];
  for (const field of spotFields) {
    const count = database.prepare(
      `SELECT COUNT(*) as c FROM spots WHERE ${field} = ''`,
    ).get().c;
    if (count > 0) {
      console.log(`  spots.${field}: ${count} empty string(s) → NULL`);
      if (!DRY_RUN) {
        database.prepare(`UPDATE spots SET ${field} = NULL WHERE ${field} = ''`).run();
      }
      total += count;
    }
  }

  return total;
}

function syncAllActivityFlags() {
  const database = db.getDb();
  const venues = database.prepare(
    'SELECT DISTINCT v.id FROM venues v INNER JOIN spots s ON s.venue_id = v.id WHERE s.status = \'approved\'',
  ).all();

  let changed = 0;
  for (const { id } of venues) {
    const before = database.prepare(
      'SELECT is_happy_hour, is_brunch, is_live_music, is_rooftop_bar, is_coffee_shop, is_landmark, is_dog_friendly, is_waterfront FROM venues WHERE id = ?',
    ).get(id);

    if (!DRY_RUN) {
      db.syncActivityFlags(id);
    }

    const after = DRY_RUN ? before : database.prepare(
      'SELECT is_happy_hour, is_brunch, is_live_music, is_rooftop_bar, is_coffee_shop, is_landmark, is_dog_friendly, is_waterfront FROM venues WHERE id = ?',
    ).get(id);

    const diffs = Object.keys(before).filter(k => before[k] !== after[k]);
    if (diffs.length > 0 || DRY_RUN) {
      const spotTypes = database.prepare(
        'SELECT DISTINCT type FROM spots WHERE venue_id = ? AND status = \'approved\'',
      ).all(id).map(r => r.type);

      if (spotTypes.length > 0) {
        const flagsFromSpots = spotTypes.filter(t =>
          ['Happy Hour', 'Brunch', 'Live Music', 'Rooftop Bar', 'Coffee Shop', 'Landmarks & Attractions', 'Dog Friendly', 'Waterfront Dining'].includes(t),
        );
        if (flagsFromSpots.length > 0 && diffs.length > 0) {
          console.log(`  ${id}: ${diffs.join(', ')} (spots: ${flagsFromSpots.join(', ')})`);
          changed++;
        }
      }
    }
  }
  return { total: venues.length, changed };
}

function main() {
  db.setAuditContext('migration', 'backfill-activity-flags');
  console.log(`\n=== Activity Flags Backfill ${DRY_RUN ? '(DRY RUN)' : ''} ===\n`);

  console.log('1. Normalizing empty strings to NULL...');
  const normalized = normalizeEmptyStrings();
  console.log(`   Total normalized: ${normalized}\n`);

  console.log('2. Syncing activity flags for all venues with approved spots...');
  const { total, changed } = syncAllActivityFlags();
  console.log(`   Processed: ${total} venues, ${changed} updated\n`);

  const database = db.getDb();
  const flagCounts = database.prepare(`
    SELECT
      SUM(is_happy_hour) as happy_hour,
      SUM(is_brunch) as brunch,
      SUM(is_live_music) as live_music,
      SUM(is_rooftop_bar) as rooftop_bar,
      SUM(is_coffee_shop) as coffee_shop,
      SUM(is_landmark) as landmark,
      SUM(is_dog_friendly) as dog_friendly,
      SUM(is_waterfront) as waterfront
    FROM venues
  `).get();
  console.log('3. Final flag counts:');
  for (const [flag, count] of Object.entries(flagCounts)) {
    console.log(`   ${flag}: ${count}`);
  }

  const remaining = database.prepare(`
    SELECT
      SUM(CASE WHEN website IS NULL THEN 1 ELSE 0 END) as no_website,
      SUM(CASE WHEN phone IS NULL THEN 1 ELSE 0 END) as no_phone,
      SUM(CASE WHEN photo_url IS NULL THEN 1 ELSE 0 END) as no_photo,
      SUM(CASE WHEN address IS NULL THEN 1 ELSE 0 END) as no_address,
      SUM(CASE WHEN operating_hours IS NULL THEN 1 ELSE 0 END) as no_hours
    FROM venues
  `).get();
  console.log('\n4. Remaining gaps (after normalization):');
  for (const [field, count] of Object.entries(remaining)) {
    console.log(`   ${field}: ${count}`);
  }

  console.log('\nDone.');
}

main();
