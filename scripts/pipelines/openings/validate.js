#!/usr/bin/env node
'use strict';

/**
 * Openings Step 3: Critical validation — geocode, deduplicate, and LLM verify.
 * Reads: step-1-discover.json → Outputs: step-3-validated.json
 */
const path = require('path');
try { require('dotenv').config({ path: path.resolve(__dirname, '../../..', '.env.local') }); } catch {}

const db = require('../../utils/db');
const { createLogger } = require('../../utils/logger');
const { readStepOutput, writeStepOutput, getTodayDate } = require('../shared/pipeline-io');
const { VALID_AREAS, getGoogleApiKey, geocodeViaPlaces, isDuplicate } = require('../../utils/discover-places');
const { isValidVenueName, checkReviewCount } = require('../../utils/venue-validator');
const { webSearch, getApiKey } = require('../../utils/llm-client');
const { loadPrompt } = require('../../utils/load-prompt');

const { log, warn, close: closeLog } = createLogger('op-validate');
const PIPELINE = 'openings';
const GEOCODE_DELAY = 500;
const MIN_CONFIDENCE = 70;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function geocodeCandidates(candidates) {
  if (!getGoogleApiKey()) { warn('No Google API key — skipping geocoding'); return []; }
  const results = [];
  for (const c of candidates) {
    if (!isValidVenueName(c.name)) { log(`[validate] Name rejected: "${c.name}"`); continue; }
    await sleep(GEOCODE_DELAY);
    let geo = await geocodeViaPlaces(c.name, c.address, log);
    if (!geo && c.address) {
      await sleep(GEOCODE_DELAY);
      geo = await geocodeViaPlaces(c.address, null, log);
      if (geo) geo.name = c.name;
    }
    if (!geo) { log(`[validate] Geocode failed: "${c.name}"`); continue; }
    results.push({ ...c, ...geo, placeName: geo.name });
    log(`[validate] Geocoded: ${c.name} → ${geo.address || 'no address'}`);
  }
  return results;
}

function deduplicateCandidates(geocoded) {
  const existingSpots = db.spots.getAll({});
  const allVenues = db.getDb().prepare('SELECT * FROM venues').all();
  const statusVenues = allVenues.filter(v => v.venue_status !== 'active');
  const excluded = new Set(db.watchlist.getExcluded().map(w => (w.name || '').toLowerCase().trim()).filter(Boolean));
  return geocoded.filter(c => {
    if (excluded.has(c.placeName.toLowerCase().trim())) { log(`[validate] Excluded: "${c.placeName}"`); return false; }
    if (isDuplicate(c, existingSpots, statusVenues)) { log(`[validate] Duplicate: "${c.placeName}"`); return false; }
    const cls = c.classification || 'Recently Opened';
    if (checkReviewCount(c.userRatingsTotal || 0, cls) === 'established') {
      log(`[validate] Too many reviews: "${c.placeName}" (${c.userRatingsTotal})`);
      return false;
    }
    return true;
  });
}

async function llmVerify(candidates) {
  if (!getApiKey() || candidates.length === 0) return [];

  const nameList = candidates.map(c =>
    `- "${c.placeName}" at ${c.address || 'Charleston, SC'} (${c.userRatingsTotal || 0} Google reviews)`,
  ).join('\n');

  const prompt = loadPrompt('openings/step-3-validate', { NAME_LIST: nameList });
  const result = await webSearch({ prompt, timeoutMs: 120000, log });
  if (!result?.parsed || !Array.isArray(result.parsed)) {
    warn('[validate] LLM verification failed — rejecting all');
    return [];
  }

  const verdicts = new Map();
  for (const v of result.parsed) {
    if (v.name) verdicts.set(v.name.toLowerCase().trim(), v);
  }

  return candidates.filter(c => {
    const v = verdicts.get(c.placeName.toLowerCase().trim());
    if (!v) { log(`[validate] REJECT "${c.placeName}": no LLM verdict`); return false; }
    if (!v.is_new) { log(`[validate] REJECT "${c.placeName}": ${v.reason}`); return false; }
    if (v.confidence < MIN_CONFIDENCE) {
      log(`[validate] REJECT "${c.placeName}": confidence ${v.confidence} < ${MIN_CONFIDENCE}`);
      return false;
    }
    log(`[validate] VERIFIED "${c.placeName}": ${v.reason} (${v.confidence}%)`);
    c.grokVerifiedDate = v.opened_date || null;
    if (v.classification) c.classification = v.classification;
    return true;
  });
}

async function main() {
  const input = readStepOutput(PIPELINE, 'step-1-discover');
  if (!input) { log('No step-1 output — aborting'); process.exit(1); }
  log(`=== Openings Validate: ${input.candidates.length} candidates ===`);
  db.setAuditContext('pipeline', 'op-validate');

  const geocoded = await geocodeCandidates(input.candidates);
  log(`[validate] ${geocoded.length} geocoded`);

  const deduped = deduplicateCandidates(geocoded);
  log(`[validate] ${deduped.length} after dedup`);

  const verified = await llmVerify(deduped);
  log(`[validate] ${verified.length} verified`);

  writeStepOutput(PIPELINE, 'step-3-validated', {
    ...input, geocodedCount: geocoded.length, dedupedCount: deduped.length,
    verified, rejectedCount: input.candidates.length - verified.length,
  });

  closeLog(); db.closeDb();
}

main().catch(e => { console.error('Fatal:', e); closeLog(); process.exit(1); });
