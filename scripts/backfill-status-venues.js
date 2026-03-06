#!/usr/bin/env node
/**
 * backfill-status-venues.js — Enrich & deduplicate recently_opened / coming_soon venues.
 *
 * 1. Runs migration to add description column if missing
 * 2. Removes duplicates: status venues that match an existing active venue by name
 * 3. Enriches remaining status venues with descriptions + photos via Google Places + Grok
 *
 * Usage: node scripts/backfill-status-venues.js [--dry-run]
 */

const db = require('./utils/db');
const { createLogger } = require('./utils/logger');
const { enrichViaGrok, fetchPlaceDetails, downloadPhoto } = require('./utils/discover-places');
const { delay } = require('./utils/discover-rss');

const { log, warn, close: closeLog } = createLogger('backfill-status-venues');
const DRY_RUN = process.argv.includes('--dry-run');

function deduplicateStatusVenues() {
  const raw = db.getDb();
  const statusVenues = raw.prepare(
    "SELECT * FROM venues WHERE venue_status IN ('recently_opened', 'coming_soon')",
  ).all();
  const activeVenues = raw.prepare(
    "SELECT * FROM venues WHERE venue_status = 'active'",
  ).all();

  let removed = 0;
  for (const sv of statusVenues) {
    const svName = sv.name.toLowerCase().trim();
    const match = activeVenues.find(av => {
      const avName = av.name.toLowerCase().trim();
      if (avName === svName) return true;
      if (avName.length < 4 || svName.length < 4) return false;
      const shorter = avName.length < svName.length ? avName : svName;
      const longer = avName.length < svName.length ? svName : avName;
      return longer.includes(shorter) && shorter.length / longer.length > 0.5;
    });

    if (match) {
      log(`Duplicate: "${sv.name}" (${sv.venue_status}) matches active venue "${match.name}" (${match.id})`);
      if (!DRY_RUN) {
        raw.prepare(
          "UPDATE venues SET venue_status = 'active', updated_at = datetime('now') WHERE id = ?",
        ).run(sv.id);
      }
      removed++;
    }
  }
  log(`Dedup: ${removed} duplicate status venues ${DRY_RUN ? 'would be' : ''} removed`);
  return removed;
}

async function enrichStatusVenues() {
  const raw = db.getDb();
  const statusVenues = raw.prepare(
    "SELECT * FROM venues WHERE venue_status IN ('recently_opened', 'coming_soon') ORDER BY venue_added_at DESC",
  ).all();

  log(`Enriching ${statusVenues.length} status venues...`);
  let enriched = 0;

  for (const venue of statusVenues) {
    const needsDescription = !venue.description;
    const needsPhoto = !venue.photo_url;
    if (!needsDescription && !needsPhoto) continue;

    let description = venue.description;
    let photoPath = venue.photo_url;

    if (needsPhoto && venue.id.startsWith('ChIJ')) {
      await delay(300);
      const details = await fetchPlaceDetails(venue.id);
      if (details?.photoRef) {
        const safeName = venue.name.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase().slice(0, 50);
        const downloaded = await downloadPhoto(details.photoRef, safeName);
        if (downloaded) photoPath = downloaded;
      }
    }

    if (needsDescription) {
      const grokResult = await enrichViaGrok(venue.name, venue.address, log);
      if (grokResult?.description) {
        description = grokResult.description;
      }
    }

    if (description !== venue.description || photoPath !== venue.photo_url) {
      if (!DRY_RUN) {
        const updates = {};
        if (description && description !== venue.description) updates.description = description;
        if (photoPath && photoPath !== venue.photo_url) updates.photo_url = photoPath;
        if (Object.keys(updates).length > 0) {
          db.venues.update(venue.id, updates);
        }
      }
      log(`Enriched "${venue.name}": desc=${!!description} photo=${!!photoPath}`);
      enriched++;
    }
  }

  log(`Enriched ${enriched}/${statusVenues.length} venues ${DRY_RUN ? '(dry run)' : ''}`);
  return enriched;
}

async function main() {
  log(`Backfill status venues${DRY_RUN ? ' (DRY RUN)' : ''}`);

  require('./db/migrate-004-venue-description');

  const removed = deduplicateStatusVenues();
  const enrichedCount = await enrichStatusVenues();

  log(`Done: ${removed} duplicates removed, ${enrichedCount} venues enriched`);
  closeLog();
  db.closeDb();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
