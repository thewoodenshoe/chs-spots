#!/usr/bin/env node
'use strict';

/**
 * Openings Step 6: Lifecycle management — check coming_soon → recently_opened.
 * Uses LLM to verify if a "coming soon" venue has opened.
 * Reads: step-5-upserted.json → Outputs: step-6-lifecycle.json
 */
const path = require('path');
try { require('dotenv').config({ path: path.resolve(__dirname, '../../..', '.env.local') }); } catch {}

const db = require('../../utils/db');
const { createLogger } = require('../../utils/logger');
const { readStepOutput, writeStepOutput } = require('../shared/pipeline-io');
const { webSearch, getApiKey } = require('../../utils/llm-client');
const { loadPrompt } = require('../../utils/load-prompt');

const { log, warn, close: closeLog } = createLogger('op-lifecycle');
const PIPELINE = 'openings';
const CHECK_DELAY_MS = 2000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function checkIfOpened(venue) {
  const prompt = loadPrompt('llm-opening-status-check', {
    VENUE_NAME: venue.name, ADDRESS: venue.address || venue.area || 'Charleston, SC',
  });
  const result = await webSearch({ prompt, timeoutMs: 90000, log });
  return result?.parsed || null;
}

async function main() {
  const input = readStepOutput(PIPELINE, 'step-5-upserted');
  if (!input) { log('No step-5 output — aborting'); process.exit(1); }
  if (!getApiKey()) { warn('No API key — skipping lifecycle checks'); return; }
  log('=== Openings Lifecycle Check ===');
  db.setAuditContext('pipeline', 'op-lifecycle');

  const csVenues = db.venues.getByStatus('coming_soon');
  log(`[lifecycle] ${csVenues.length} coming_soon venue(s) to check`);

  let transitioned = 0;
  let errors = 0;
  const transitionedNames = [];

  for (const venue of csVenues) {
    await sleep(CHECK_DELAY_MS);
    try {
      log(`[lifecycle] Checking "${venue.name}"...`);
      const result = await checkIfOpened(venue);
      if (!result) { warn(`[lifecycle] No result for "${venue.name}"`); continue; }
      if (result.opened) {
        db.venues.updateStatus(venue.id, 'recently_opened');
        transitioned++;
        transitionedNames.push(venue.name);
        log(`[lifecycle] "${venue.name}" → recently_opened`);
      } else {
        log(`[lifecycle] "${venue.name}" still coming soon: ${result.evidence || 'n/a'}`);
        db.getDb().prepare("UPDATE venues SET updated_at = datetime('now') WHERE id = ?").run(venue.id);
      }
    } catch (err) {
      errors++;
      warn(`[lifecycle] Error checking "${venue.name}": ${err.message}`);
    }
  }

  log(`[lifecycle] Done: ${transitioned} transitioned, ${errors} errors`);
  writeStepOutput(PIPELINE, 'step-6-lifecycle', {
    ...input, csChecked: csVenues.length, transitioned, transitionedNames, lifecycleErrors: errors,
  });

  closeLog(); db.closeDb();
}

main().catch(e => { console.error('Fatal:', e); closeLog(); process.exit(1); });
