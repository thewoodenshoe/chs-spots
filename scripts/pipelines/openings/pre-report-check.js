#!/usr/bin/env node
'use strict';

/**
 * Openings Step 6.5: Pre-report quality audit on all coming_soon/recently_opened venues.
 * Scans for missing photo, website, description, area. Tries to fix via LLM.
 * Reads: step-6-lifecycle.json → Outputs: step-7-precheck.json
 */
const path = require('path');
try { require('dotenv').config({ path: path.resolve(__dirname, '../../..', '.env.local') }); } catch {}

const db = require('../../utils/db');
const { createLogger } = require('../../utils/logger');
const { readStepOutput, writeStepOutput } = require('../shared/pipeline-io');
const { webSearch, getApiKey } = require('../../utils/llm-client');
const { loadPrompt } = require('../../utils/load-prompt');
const { downloadPlacePhoto, getPlacesApiKey } = require('../../utils/google-places');

const { log, warn, close: closeLog } = createLogger('op-precheck');
const PIPELINE = 'openings';
const LLM_DELAY = 2000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function auditVenue(v) {
  const issues = [];
  if (!v.photo_url) issues.push('missing photo');
  if (!v.website || v.website === 'n/a') issues.push('missing website');
  if (!v.description) issues.push('missing description');
  if (!v.area) issues.push('missing area');
  if (!v.address) issues.push('missing address');
  return issues;
}

async function tryFixViaLlm(venue, issues) {
  if (!getApiKey()) return null;
  const prompt = loadPrompt('shared/find-venue', {
    VENUE_NAME: venue.name, ADDRESS: venue.address || 'Charleston, SC',
  });
  const result = await webSearch({ prompt, timeoutMs: 60000, log });
  return result?.parsed || null;
}

async function tryFixPhoto(venue) {
  if (!getPlacesApiKey() || process.env.GOOGLE_PLACES_ENABLED !== 'true') return null;
  const placeId = venue.google_place_id || (venue.id?.startsWith('ChIJ') ? venue.id : null);
  if (!placeId) return null;
  try {
    return await downloadPlacePhoto(placeId, venue.id, log);
  } catch (e) {
    warn(`[precheck] Photo download failed for ${venue.name}: ${e.message}`);
    return null;
  }
}

async function main() {
  const input = readStepOutput(PIPELINE, 'step-6-lifecycle')
    || readStepOutput(PIPELINE, 'step-5-upserted');
  if (!input) { log('No lifecycle/upsert output — aborting'); process.exit(1); }
  log('=== Openings Pre-Report Check ===');
  db.setAuditContext('pipeline', 'op-precheck');

  const d = db.getDb();
  const activeVenues = d.prepare(
    "SELECT * FROM venues WHERE venue_status IN ('coming_soon', 'recently_opened')",
  ).all();
  log(`[precheck] Auditing ${activeVenues.length} coming_soon/recently_opened venues`);

  let fixed = 0;
  let photoFixed = 0;
  const flagged = [];

  for (const v of activeVenues) {
    const issues = auditVenue(v);
    if (issues.length === 0) continue;
    log(`[precheck] ${v.name}: ${issues.join(', ')}`);

    if (issues.includes('missing photo')) {
      const photoUrl = await tryFixPhoto(v);
      if (photoUrl) {
        db.venues.updatePhotoUrl(v.id, photoUrl);
        photoFixed++;
        log(`[precheck] FIXED photo: ${v.name}`);
        issues.splice(issues.indexOf('missing photo'), 1);
      }
    }

    const needsLlm = issues.some(i => i.includes('website') || i.includes('description') || i.includes('area'));
    if (needsLlm) {
      await sleep(LLM_DELAY);
      const llmData = await tryFixViaLlm(v, issues);
      if (llmData) {
        const updates = {};
        if (!v.website && llmData.website && llmData.website !== 'n/a') updates.website = llmData.website;
        if (!v.description && llmData.description) updates.description = llmData.description;
        if (!v.area && llmData.area) updates.area = llmData.area;
        if (!v.address && llmData.address) updates.address = llmData.address;
        if (!v.phone && llmData.phone) updates.phone = llmData.phone;

        if (Object.keys(updates).length > 0) {
          db.venues.update(v.id, updates);
          fixed++;
          log(`[precheck] FIXED ${v.name}: ${Object.keys(updates).join(', ')}`);
        }
      }
    }

    const remaining = auditVenue({ ...v, ...({}) });
    if (issues.length > 0) {
      flagged.push({ name: v.name, id: v.id, status: v.venue_status, issues });
    }
  }

  log(`[precheck] Done: ${fixed} LLM-fixed, ${photoFixed} photos fixed, ${flagged.length} flagged`);

  writeStepOutput(PIPELINE, 'step-7-precheck', {
    ...input, precheckAudited: activeVenues.length,
    precheckFixed: fixed, precheckPhotoFixed: photoFixed,
    precheckFlagged: flagged,
  });

  closeLog(); db.closeDb();
}

main().catch(e => { console.error('Fatal:', e); closeLog(); process.exit(1); });
