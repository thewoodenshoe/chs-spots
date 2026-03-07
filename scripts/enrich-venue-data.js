#!/usr/bin/env node
/**
 * enrich-venue-data.js — Unified venue data completeness pass.
 *
 * Runs after enrich-venues.js (website/phone) and before the daily report.
 * Fills missing photos via Google Places API and missing operating hours via LLM.
 * This ensures the report reflects the state AFTER all auto-fix attempts.
 *
 * Usage: node scripts/enrich-venue-data.js [--dry-run]
 */

'use strict';

const path = require('path');

try {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local') });
} catch { /* env vars set externally */ }

const db = require('./utils/db');
const { enrichPhotos, enrichHours } = require('./utils/venue-enrichment');
const { createLogger } = require('./utils/logger');
const { log, close: closeLog } = createLogger('enrich-venue-data');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  if (DRY_RUN) log('=== DRY RUN — no DB writes ===');
  log('=== enrich-venue-data.js START ===');

  const photoResult = await enrichPhotos(DRY_RUN);
  log(`Photos: ${photoResult.downloaded} downloaded, ${photoResult.skipped} no photo, ${photoResult.failed} failed`);

  const hoursResult = await enrichHours(DRY_RUN);
  log(`Hours: ${hoursResult.updated} updated, ${hoursResult.failed} failed`);

  log('=== enrich-venue-data.js DONE ===');
  closeLog();
  db.closeDb();
}

main().catch(err => {
  log(`❌ Fatal: ${err.message}`);
  console.error(err);
  closeLog();
  db.closeDb();
  process.exit(1);
});
