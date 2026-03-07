#!/usr/bin/env node
'use strict';

/**
 * Live Music Step 1+2: Discover today's events (wide LLM) + map to our schema.
 * Reads from: data/config/llm/live-music/step-1-discover-today.txt
 * Outputs: step-1-discover.json
 */
const path = require('path');
try { require('dotenv').config({ path: path.resolve(__dirname, '../../..', '.env.local') }); } catch {}

const db = require('../../utils/db');
const { webSearch, getApiKey } = require('../../utils/llm-client');
const { loadPrompt } = require('../../utils/load-prompt');
const { createLogger } = require('../../utils/logger');
const { writeStepOutput, getTodayLabel, getTodayDate } = require('../shared/pipeline-io');
const { findVenue } = require('../shared/find-venue');

const { log, error: logError, close: closeLog } = createLogger('lm-discover');
const PIPELINE = 'live-music';

async function main() {
  if (!getApiKey()) { log('No Grok API key — aborting'); process.exit(1); }
  const todayLabel = getTodayLabel();
  const todayDate = getTodayDate();
  log(`=== Live Music Discover: ${todayLabel} ===`);

  db.setAuditContext('pipeline', 'lm-discover');

  const existingSpots = db.getDb().prepare(
    "SELECT id, title, venue_id FROM spots WHERE type = 'Live Music' AND status = 'approved'",
  ).all();
  const venueNames = existingSpots.map(s => s.title);
  log(`[discover] ${existingSpots.length} existing Live Music spots`);

  const prompt = loadPrompt('live-music/step-1-discover-today', {
    TODAY_LABEL: todayLabel,
    VENUE_LIST: venueNames.join(', '),
  });

  const result = await webSearch({ prompt, timeoutMs: 120000, log });
  const acquireError = !result || !result.parsed;

  if (acquireError) {
    log('[discover] LLM returned no valid data — flagging error');
    writeStepOutput(PIPELINE, 'step-1-discover', {
      date: todayDate, dateLabel: todayLabel, acquireError: true,
      existingSpots: existingSpots.length, rawEvents: [], mappedEvents: [],
    });
    closeLog(); db.closeDb();
    return;
  }

  const rawEvents = Array.isArray(result.parsed) ? result.parsed : [];
  log(`[discover] LLM found ${rawEvents.length} raw event(s)`);

  const mappedEvents = [];
  for (const event of rawEvents) {
    if (!event.venue) { log(`[discover] SKIP: no venue name`); continue; }

    const venueResult = await findVenue(
      { name: event.venue, address: event.address },
      { db, log },
    );

    mappedEvents.push({
      venue: event.venue,
      venue_id: venueResult?.venue?.id || null,
      venue_created: venueResult?.created || false,
      performer: (event.performer || 'Live Music').trim(),
      start_time: event.start_time || null,
      end_time: event.end_time || null,
      description: (event.description || '').trim(),
      address: event.address || venueResult?.venue?.address || null,
    });
  }

  log(`[discover] Mapped ${mappedEvents.length} event(s), ${mappedEvents.filter(e => !e.venue_id).length} missing venue`);

  writeStepOutput(PIPELINE, 'step-1-discover', {
    date: todayDate, dateLabel: todayLabel, acquireError: false,
    existingSpots: existingSpots.length,
    rawCount: rawEvents.length,
    mappedEvents,
    existingSpotIds: existingSpots.map(s => ({ id: s.id, title: s.title, venue_id: s.venue_id })),
  });

  log(`[discover] Step 1 complete: ${mappedEvents.length} events written`);
  closeLog(); db.closeDb();
}

main().catch(e => { logError('Fatal:', e); closeLog(); process.exit(1); });
