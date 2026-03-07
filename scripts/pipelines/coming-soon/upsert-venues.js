#!/usr/bin/env node
'use strict';

/**
 * Coming Soon Step 5: Resolve/create venues and set coming_soon status.
 * Uses shared/find-venue.js for venue resolution workflow.
 * Reads: step-4-quality.json → Outputs: step-5-upserted.json
 */
const path = require('path');
try { require('dotenv').config({ path: path.resolve(__dirname, '../../..', '.env.local') }); } catch {}

const db = require('../../utils/db');
const { createLogger } = require('../../utils/logger');
const { readStepOutput, writeStepOutput, getTodayDate } = require('../shared/pipeline-io');
const { findVenue } = require('../shared/find-venue');
const { findAreaFromAddress, findAreaFromCoordinates, VALID_AREAS } = require('../../utils/discover-places');
const { downloadPlacePhoto, getPlacesApiKey } = require('../../utils/google-places');

const { log, error: logError, close: closeLog } = createLogger('cs-upsert');
const PIPELINE = 'coming-soon';

function buildDescription(candidate) {
  const parts = [];
  if (candidate.expectedOpen) parts.push(`Expected to open ${candidate.expectedOpen}.`);
  if (candidate.description) parts.push(candidate.description);
  return parts.join(' ').trim() || null;
}

function normalizeForId(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30);
}

async function createMinimalVenue(candidate) {
  const venueId = db.venues.generateId
    ? db.venues.generateId()
    : `ven_${normalizeForId(candidate.placeName || candidate.name)}`;

  const area = findAreaFromAddress(candidate.address)
    || candidate.area
    || (candidate.lat && candidate.lng ? findAreaFromCoordinates(candidate.lat, candidate.lng) : null)
    || 'Downtown Charleston';

  db.venues.upsert({
    id: venueId,
    name: candidate.placeName || candidate.name,
    address: candidate.address || null,
    lat: candidate.lat || null, lng: candidate.lng || null,
    area, website: candidate.website || null,
    venue_status: 'coming_soon',
    venue_added_at: getTodayDate(),
    description: buildDescription(candidate),
  });

  return venueId;
}

async function tryDownloadPhoto(venueId, candidate) {
  if (!getPlacesApiKey() || process.env.GOOGLE_PLACES_ENABLED !== 'true') return null;
  const placeId = candidate.placeId || candidate.google_place_id;
  if (!placeId) return null;
  try {
    const safeName = (candidate.placeName || candidate.name)
      .replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase().slice(0, 50);
    return await downloadPlacePhoto(placeId, safeName, log);
  } catch (e) {
    log(`[upsert] Photo failed for ${candidate.placeName || candidate.name}: ${e.message}`);
    return null;
  }
}

async function main() {
  const input = readStepOutput(PIPELINE, 'step-4-quality')
    || readStepOutput(PIPELINE, 'step-3-validated');
  if (!input) { log('No step-4/step-3 output — aborting'); process.exit(1); }
  const venues = input.approved || input.verified || [];
  log(`=== Coming Soon Upsert: ${venues.length} venues ===`);
  db.setAuditContext('pipeline', 'cs-upsert');

  let inserted = 0;
  const insertedNames = [];

  for (const candidate of venues) {
    try {
      const name = candidate.placeName || candidate.name;
      const result = await findVenue(
        { name, address: candidate.address, website: candidate.website, area: candidate.area },
        { db, log },
      );

      let venueId;
      if (result) {
        venueId = result.venue.id;
        log(`[upsert] Resolved venue: ${name} → ${venueId}`);
      } else {
        venueId = await createMinimalVenue(candidate);
        log(`[upsert] Created minimal venue: ${name} → ${venueId}`);
      }

      const description = buildDescription(candidate);
      db.venues.updateStatus(venueId, 'coming_soon');
      if (description) db.venues.update(venueId, { description, venue_added_at: getTodayDate() });

      const photoUrl = await tryDownloadPhoto(venueId, candidate);
      if (photoUrl) db.venues.updatePhotoUrl(venueId, photoUrl);

      inserted++;
      insertedNames.push(`${name} (${candidate.area || 'Downtown Charleston'})`);
      log(`[upsert] DONE: ${name}`);
    } catch (err) {
      logError(`[upsert] Failed "${candidate.placeName || candidate.name}": ${err.message}`);
    }
  }

  log(`[upsert] Done: ${inserted} inserted`);
  writeStepOutput(PIPELINE, 'step-5-upserted', { ...input, inserted, insertedNames });
  closeLog(); db.closeDb();
}

main().catch(e => { console.error('Fatal:', e); closeLog(); process.exit(1); });
