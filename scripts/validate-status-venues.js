#!/usr/bin/env node
/**
 * validate-status-venues.js — Validate all recently_opened / coming_soon venues.
 *
 * Checks each status venue against Google Places review counts and Grok verification.
 * Demotes false positives (established venues) to 'active' status.
 *
 * Usage: node scripts/validate-status-venues.js [--dry-run]
 */

const db = require('./utils/db');
const { createLogger } = require('./utils/logger');
const { getGoogleApiKey, geocodeViaPlaces } = require('./utils/discover-places');
const { isValidVenueName, checkReviewCount, verifyViaGrok } = require('./utils/venue-validator');
const { delay } = require('./utils/discover-rss');

const { log, warn, close: closeLog } = createLogger('validate-status-venues');
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  if (!getGoogleApiKey()) { warn('No Google Places API key'); return; }
  log(`Validating status venues${DRY_RUN ? ' (DRY RUN)' : ''}...`);

  const raw = db.getDb();
  const statusVenues = raw.prepare(
    "SELECT * FROM venues WHERE venue_status IN ('recently_opened', 'coming_soon') ORDER BY name",
  ).all();
  log(`Found ${statusVenues.length} status venues to validate`);

  const toReject = [];
  const toVerify = [];

  for (const v of statusVenues) {
    if (!isValidVenueName(v.name)) {
      log(`  INVALID NAME: "${v.name}" — will demote`);
      toReject.push(v);
      continue;
    }

    await delay(400);
    const searchTerm = v.address
      ? `${v.name} ${v.address}`
      : `"${v.name}" charleston sc`;
    const query = encodeURIComponent(searchTerm);
    const apiKey = getGoogleApiKey();
    let reviewCount = 0;
    try {
      const text = await (await fetch(
        `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&key=${apiKey}`,
      )).text();
      const data = JSON.parse(text);
      if (data.status === 'OK' && data.results?.[0]) {
        reviewCount = data.results[0].user_ratings_total || 0;
      }
    } catch (err) { warn(`  Places API error for "${v.name}": ${err.message}`); }

    const signal = checkReviewCount(reviewCount, v.venue_status === 'recently_opened' ? 'Recently Opened' : 'Coming Soon');
    log(`  "${v.name}": ${reviewCount} reviews → ${signal}`);

    if (signal === 'established') {
      toReject.push(v);
    } else if (signal === 'borderline') {
      toVerify.push({ ...v, placeName: v.name, userRatingsTotal: reviewCount, _reviewSignal: signal });
    }
  }

  if (toVerify.length > 0) {
    log(`Verifying ${toVerify.length} borderline venues via Grok...`);
    const verified = await verifyViaGrok(toVerify, log);
    const verifiedNames = new Set(verified.map(v => v.name.toLowerCase()));
    for (const v of toVerify) {
      if (!verifiedNames.has(v.name.toLowerCase())) {
        toReject.push(v);
      }
    }
  }

  log(`\nResults: ${toReject.length} false positives to demote, ${statusVenues.length - toReject.length} valid`);

  for (const v of toReject) {
    log(`  DEMOTING: "${v.name}" (${v.venue_status}) → active`);
    if (!DRY_RUN) {
      raw.prepare("UPDATE venues SET venue_status = 'active', updated_at = datetime('now') WHERE id = ?").run(v.id);
    }
  }

  log(`Done: ${toReject.length} venues demoted${DRY_RUN ? ' (dry run)' : ''}`);
  closeLog();
  db.closeDb();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
