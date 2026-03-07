#!/usr/bin/env node
'use strict';

/**
 * Openings Step 4+5: Upsert verified venues + download photos + lifecycle.
 * Reads: step-3-validated.json → Outputs: step-5-upserted.json
 */
const path = require('path');
try { require('dotenv').config({ path: path.resolve(__dirname, '../../..', '.env.local') }); } catch {}

const db = require('../../utils/db');
const { createLogger } = require('../../utils/logger');
const { readStepOutput, writeStepOutput, getTodayDate } = require('../shared/pipeline-io');
const { findAreaFromAddress, findAreaFromCoordinates, downloadPhoto, fetchPlacePhoto,
  enrichViaGrok, VALID_AREAS } = require('../../utils/discover-places');
const { extractDescription } = require('../../utils/discover-rss');

const { log, error: logError, close: closeLog } = createLogger('op-upsert');
const PIPELINE = 'openings';
const RECENTLY_OPENED_MAX_DAYS = 90;

function upsertVenue(spot, area, description, expectedOpen) {
  if (!spot.placeId) return null;
  const venueStatus = spot.classification === 'Recently Opened' ? 'recently_opened' : 'coming_soon';
  db.venues.upsert({
    id: spot.placeId, name: spot.placeName || spot.name,
    address: spot.address || null, lat: spot.lat, lng: spot.lng,
    area: area || null, website: spot.website || spot.grokWebsite || null,
    phone: spot.phone || spot.grokPhone || null,
    description: description || null,
    operating_hours: spot.operatingHours || null,
    hours_source: spot.operatingHours ? 'google_places' : null,
    types: Array.isArray(spot.types) ? spot.types.join(', ') : null,
    venue_status: venueStatus,
    venue_added_at: getTodayDate(),
  });
  if (expectedOpen) db.venues.updateStatus(spot.placeId, venueStatus, expectedOpen);
  return spot.placeId;
}

function ageOutOldStatuses() {
  const cutoff = new Date(Date.now() - RECENTLY_OPENED_MAX_DAYS * 86400000).toISOString().slice(0, 10);
  const datePrefix = /^(Opened|Expected to open)\s+[^.]+\.\s*/i;
  const toAge = db.getDb().prepare(
    "SELECT id, description FROM venues WHERE venue_status IN ('recently_opened','coming_soon') AND venue_added_at < ?",
  ).all(cutoff);
  const stmt = db.getDb().prepare("UPDATE venues SET venue_status = 'active', description = ?, updated_at = datetime('now') WHERE id = ?");
  for (const v of toAge) stmt.run((v.description || '').replace(datePrefix, '').trim() || null, v.id);
  if (toAge.length > 0) log(`[lifecycle] Aged out ${toAge.length} venue(s) to active`);
  return toAge.length;
}

async function main() {
  const input = readStepOutput(PIPELINE, 'step-4-quality')
    || readStepOutput(PIPELINE, 'step-3-validated');
  if (!input) { log('No step-4/step-3 output — aborting'); process.exit(1); }
  const venues = input.approved || input.verified || [];
  log(`=== Openings Upsert: ${venues.length} venues ===`);
  db.setAuditContext('pipeline', 'op-upsert');

  let inserted = 0;
  const insertedNames = [];

  for (const spot of venues) {
    let area = findAreaFromAddress(spot.address) || spot.area || findAreaFromCoordinates(spot.lat, spot.lng);
    let description = spot.description || extractDescription(spot.title, spot.description, spot.classification);
    const openDate = spot.grokVerifiedDate || spot.expectedOpen || null;
    if (spot.classification === 'Recently Opened' && openDate) {
      description = `Opened ${openDate}. ${description || ''}`.trim();
    } else if (spot.classification === 'Coming Soon' && openDate) {
      description = `Expected to open ${openDate}. ${description || ''}`.trim();
    }

    if (!area || area === 'Unknown') {
      const enriched = await enrichViaGrok(spot.placeName, spot.address, log);
      if (enriched?.area && VALID_AREAS.includes(enriched.area)) area = enriched.area;
      if (!description && enriched?.description) description = enriched.description;
    }

    const venueId = upsertVenue(spot, area, description, spot.expectedOpen);
    const spotTitle = spot.name || spot.placeName;
    try {
      let photoPath = null;
      if (spot.photoRef) photoPath = await downloadPhoto(spot.photoRef, spotTitle);
      if (!photoPath && spot.placeId) {
        const safeName = spotTitle.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase().slice(0, 50);
        photoPath = await fetchPlacePhoto(spot.placeId, safeName);
      }
      if (photoPath) db.venues.updatePhotoUrl(venueId, photoPath);
      inserted++;
      const tag = spot.classification === 'Recently Opened' ? 'NEW' : 'SOON';
      insertedNames.push(`${tag} ${spotTitle} (${area || 'Downtown Charleston'})`);
      log(`[upsert] ${tag}: ${spotTitle} → ${venueId}`);
    } catch (err) {
      logError(`[upsert] Failed "${spotTitle}": ${err.message}`);
    }
  }

  const agedOut = ageOutOldStatuses();
  log(`[upsert] Done: ${inserted} inserted, ${agedOut} aged out`);

  writeStepOutput(PIPELINE, 'step-5-upserted', {
    ...input, inserted, insertedNames, agedOut,
  });

  closeLog(); db.closeDb();
}

main().catch(e => { console.error('Fatal:', e); closeLog(); process.exit(1); });
