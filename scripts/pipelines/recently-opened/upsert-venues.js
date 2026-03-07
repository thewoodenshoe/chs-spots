#!/usr/bin/env node
'use strict';

/**
 * Recently Opened Step 5: Resolve venues via find-venue and set recently_opened status.
 * Skips candidates where findVenue returns null (must have a real geocodable venue).
 * Reads: step-4-quality.json → Outputs: step-5-upserted.json
 */
const path = require('path');
try { require('dotenv').config({ path: path.resolve(__dirname, '../../..', '.env.local') }); } catch {}

const db = require('../../utils/db');
const { createLogger } = require('../../utils/logger');
const { readStepOutput, writeStepOutput, getTodayDate } = require('../shared/pipeline-io');
const { findVenue } = require('../shared/find-venue');
const { findAreaFromAddress, findAreaFromCoordinates, VALID_AREAS } = require('../../utils/discover-places');

const { log, error: logError, close: closeLog } = createLogger('ro-upsert');
const PIPELINE = 'recently-opened';

function buildDescription(candidate) {
  const parts = [];
  if (candidate.openedDate) parts.push(`Opened ${candidate.openedDate}.`);
  if (candidate.description) parts.push(candidate.description);
  return parts.join(' ').trim() || null;
}

async function main() {
  const input = readStepOutput(PIPELINE, 'step-4-quality')
    || readStepOutput(PIPELINE, 'step-3-validated');
  if (!input) { log('No step-4/step-3 output — aborting'); process.exit(1); }
  const venues = input.approved || input.verified || [];
  log(`=== Recently Opened Upsert: ${venues.length} venues ===`);
  db.setAuditContext('pipeline', 'ro-upsert');

  let inserted = 0;
  const insertedNames = [];

  for (const candidate of venues) {
    try {
      const name = candidate.placeName || candidate.name;
      const result = await findVenue(
        { name, address: candidate.address, website: candidate.website, area: candidate.area },
        { db, log },
      );

      if (!result) {
        log(`[upsert] SKIP (no geocodable venue): ${name}`);
        continue;
      }

      const venueId = result.venue.id;
      log(`[upsert] Resolved venue: ${name} → ${venueId}`);

      const description = buildDescription(candidate);
      db.venues.updateStatus(venueId, 'recently_opened');
      const updates = { venue_added_at: getTodayDate() };
      if (description) updates.description = description;
      db.venues.update(venueId, updates);

      inserted++;
      const area = result.venue.area || candidate.area || 'Downtown Charleston';
      insertedNames.push(`${name} (${area})`);
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
