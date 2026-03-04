#!/usr/bin/env node
/**
 * Backfill structured time columns (time_start, time_end, days, specific_date)
 * from existing promotion_time free-text strings.
 *
 * Usage:
 *   node scripts/migrate-promotion-time.js [--dry-run]
 */

const db = require('./utils/db');
const { parsePromotionTime } = require('./utils/time-parse');

const DRY_RUN = process.argv.includes('--dry-run');

function main() {
  const database = db.getDb();

  const spots = database.prepare(
    "SELECT id, promotion_time FROM spots WHERE promotion_time IS NOT NULL AND promotion_time != ''"
  ).all();

  console.log(`[migrate] Found ${spots.length} spots with promotion_time`);
  console.log(`[migrate] Dry run: ${DRY_RUN}\n`);

  const update = database.prepare(`
    UPDATE spots SET time_start = ?, time_end = ?, days = ?, specific_date = ?, updated_at = datetime('now')
    WHERE id = ?
  `);

  let updated = 0;
  let skipped = 0;
  let noTime = 0;
  const failures = [];

  const txn = database.transaction(() => {
    for (const spot of spots) {
      try {
        const parsed = parsePromotionTime(spot.promotion_time);

        if (!parsed.timeStart && !parsed.days) {
          noTime++;
          continue;
        }

        if (DRY_RUN) {
          console.log(`  [DRY] #${spot.id}: "${spot.promotion_time}" → start=${parsed.timeStart} end=${parsed.timeEnd} days=${parsed.days}`);
        } else {
          update.run(parsed.timeStart, parsed.timeEnd, parsed.days, parsed.specificDate, spot.id);
        }
        updated++;
      } catch (err) {
        failures.push({ id: spot.id, text: spot.promotion_time, error: err.message });
        skipped++;
      }
    }
  });

  txn();

  console.log(`\n[migrate] Results:`);
  console.log(`  Updated: ${updated}`);
  console.log(`  No parseable time: ${noTime}`);
  console.log(`  Errors: ${skipped}`);

  if (failures.length > 0) {
    console.log(`\n[migrate] Failures:`);
    for (const f of failures) {
      console.log(`  #${f.id}: "${f.text}" — ${f.error}`);
    }
  }

  const remaining = database.prepare(
    "SELECT COUNT(*) as c FROM spots WHERE promotion_time IS NOT NULL AND promotion_time != '' AND time_start IS NULL AND days IS NULL"
  ).get();
  console.log(`\n[migrate] Remaining without structured data: ${remaining.c}`);
}

main();
