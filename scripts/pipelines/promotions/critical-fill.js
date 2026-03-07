#!/usr/bin/env node
'use strict';

/**
 * Promotions Step 3: Critical fill — targeted LLM for HH/Brunch spots missing times.
 * Runs after create-spots.js to fill gaps the extraction LLM missed.
 */
const path = require('path');
try { require('dotenv').config({ path: path.resolve(__dirname, '../../..', '.env.local') }); } catch {}

const db = require('../../utils/db');
const { createLogger } = require('../../utils/logger');
const { webSearch, getApiKey } = require('../../utils/llm-client');
const { loadPrompt } = require('../../utils/load-prompt');

const { log, close: closeLog } = createLogger('pm-critical');
const TYPES = ['Happy Hour', 'Brunch'];
const MAX_FILLS = 20;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fillMissingTimes(spot, venue) {
  const prompt = loadPrompt('promotions/step-3-critical-fill', {
    VENUE_NAME: venue.name,
    ACTIVITY_TYPE: spot.type,
    WEBSITE: venue.website || 'unknown',
  });

  const result = await webSearch({ prompt, timeoutMs: 60000, log });
  if (!result?.parsed) return null;

  const updates = {};
  if (result.parsed.time_start && /^\d{2}:\d{2}$/.test(result.parsed.time_start)) {
    updates.time_start = result.parsed.time_start;
  }
  if (result.parsed.time_end && /^\d{2}:\d{2}$/.test(result.parsed.time_end)) {
    updates.time_end = result.parsed.time_end;
  }
  if (result.parsed.days) {
    updates.days = result.parsed.days;
  }
  return Object.keys(updates).length > 0 ? updates : null;
}

async function main() {
  if (!getApiKey()) { log('No API key — skipping critical fill'); closeLog(); return; }

  log('=== Promotions Critical Fill ===');
  db.setAuditContext('pipeline', 'pm-critical');
  const d = db.getDb();

  const incomplete = d.prepare(`
    SELECT s.id, s.title, s.type, s.time_start, s.time_end, s.days, s.venue_id
    FROM spots s
    WHERE s.status = 'approved'
      AND s.type IN ('Happy Hour', 'Brunch')
      AND (s.time_start IS NULL OR s.time_end IS NULL OR s.days IS NULL)
    LIMIT ?
  `).all(MAX_FILLS);

  log(`[critical] ${incomplete.length} spots missing times/days`);
  let filled = 0;
  let failed = 0;

  for (const spot of incomplete) {
    const venue = d.prepare('SELECT * FROM venues WHERE id = ?').get(spot.venue_id);
    if (!venue) { log(`[critical] SKIP #${spot.id} ${spot.title}: no venue`); continue; }

    log(`[critical] LLM fill: ${spot.title} (${spot.type})`);
    try {
      const updates = await fillMissingTimes(spot, venue);
      if (updates) {
        db.spots.update(spot.id, updates);
        filled++;
        log(`[critical] FILLED: ${spot.title} → ${updates.time_start || spot.time_start}-${updates.time_end || spot.time_end}`);
      } else {
        failed++;
        log(`[critical] No data from LLM for ${spot.title}`);
      }
      await sleep(1500);
    } catch (err) {
      failed++;
      log(`[critical] Error for ${spot.title}: ${err.message}`);
    }
  }

  log(`[critical] Done: ${filled} filled, ${failed} failed of ${incomplete.length}`);
  closeLog(); db.closeDb();
}

main().catch(e => { console.error('Fatal:', e); closeLog(); process.exit(1); });
