#!/usr/bin/env node
/**
 * validate-status-venues.js — Audit all recently_opened / coming_soon venues.
 *
 * Checks EVERY status venue against Google Places review counts AND Grok
 * verification. Demotes anything that fails to 'active'.
 *
 * Usage: node scripts/validate-status-venues.js [--dry-run]
 */

const db = require('./utils/db');
const { createLogger } = require('./utils/logger');
const { getGoogleApiKey } = require('./utils/discover-places');
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
  if (statusVenues.length === 0) { log('Nothing to validate'); closeLog(); db.closeDb(); return; }

  const toReject = [];
  const toVerify = [];

  for (const v of statusVenues) {
    if (!isValidVenueName(v.name)) {
      log(`  INVALID NAME: "${v.name}"`);
      toReject.push(v);
      continue;
    }

    await delay(400);
    const apiKey = getGoogleApiKey();
    const q = encodeURIComponent(v.address ? `${v.name} ${v.address}` : `"${v.name}" charleston sc`);
    let reviewCount = 0;
    try {
      const resp = await fetch(
        `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${q}&key=${apiKey}`,
      );
      const data = await resp.json();
      reviewCount = data.results?.[0]?.user_ratings_total || 0;
    } catch (err) { warn(`  Places API error for "${v.name}": ${err.message}`); }

    const cls = v.venue_status === 'recently_opened' ? 'Recently Opened' : 'Coming Soon';
    const signal = checkReviewCount(reviewCount, cls);
    log(`  "${v.name}": ${reviewCount} reviews → ${signal}`);

    if (signal === 'established') {
      toReject.push(v);
    } else {
      toVerify.push({ ...v, placeName: v.name, userRatingsTotal: reviewCount });
    }
  }

  if (toVerify.length > 0) {
    log(`Grok-verifying ${toVerify.length} venues (ALL must pass)...`);
    const verified = await verifyViaGrok(toVerify, log);
    const verifiedIds = new Set(verified.map(v => v.id));
    for (const v of toVerify) {
      if (!verifiedIds.has(v.id)) toReject.push(v);
    }
  }

  log(`\nResults: ${toReject.length} to demote, ${statusVenues.length - toReject.length} verified`);
  for (const v of toReject) {
    log(`  DEMOTING: "${v.name}" (${v.venue_status}) → active`);
    if (!DRY_RUN) {
      raw.prepare("UPDATE venues SET venue_status = 'active', updated_at = datetime('now') WHERE id = ?").run(v.id);
    }
  }

  log(`Done: ${toReject.length} demoted${DRY_RUN ? ' (dry run)' : ''}`);
  closeLog();
  db.closeDb();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
