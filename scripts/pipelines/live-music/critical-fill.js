#!/usr/bin/env node
'use strict';

/**
 * Live Music Step 3: Critical LLM — fill mandatory missing fields.
 * For each event missing start_time or end_time, makes a targeted LLM call.
 * Reads: step-1-discover.json → Outputs: step-3-enriched.json
 */
const path = require('path');
try { require('dotenv').config({ path: path.resolve(__dirname, '../../..', '.env.local') }); } catch {}

const { webSearch, getApiKey } = require('../../utils/llm-client');
const { loadPrompt } = require('../../utils/load-prompt');
const { createLogger } = require('../../utils/logger');
const { parseTimeRange, parseDayPart } = require('../../utils/time-parse');
const { readStepOutput, writeStepOutput, getTodayLabel, getTodayDate, getTodayDayAbbr } = require('../shared/pipeline-io');

const { log, error: logError, close: closeLog } = createLogger('lm-critical');
const PIPELINE = 'live-music';

function estimateEndTime(startTime) {
  const m = startTime.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)/i);
  if (!m) return null;
  let h = parseInt(m[1]);
  const min = m[2] ? parseInt(m[2]) : 0;
  if (m[3].toLowerCase() === 'pm' && h !== 12) h += 12;
  if (m[3].toLowerCase() === 'am' && h === 12) h = 0;
  const endH = (h + 3) % 24;
  const dh = endH === 0 ? 12 : endH > 12 ? endH - 12 : endH;
  return `${dh}:${String(min).padStart(2, '0')} ${endH >= 12 ? 'PM' : 'AM'}`;
}

function buildPromoTime(dayAbbr, startTime, endTime) {
  const s = startTime.replace(/\s+/g, '').toLowerCase();
  const e = endTime ? endTime.replace(/\s+/g, '').toLowerCase() : null;
  return e ? `${s}-${e} • ${dayAbbr}` : `${s} • ${dayAbbr}`;
}

async function fillMissingTimes(event, todayLabel) {
  if (!getApiKey()) return event;
  if (event.start_time && event.end_time) return event;

  log(`[critical] Targeted LLM for: ${event.venue} (${event.performer})`);
  try {
    const prompt = loadPrompt('live-music/step-3-critical-fill', {
      VENUE_NAME: event.venue, PERFORMER: event.performer, TODAY_LABEL: todayLabel,
    });
    const result = await webSearch({ prompt, timeoutMs: 60000, log });
    if (result?.parsed) {
      if (!event.start_time && result.parsed.start_time) event.start_time = result.parsed.start_time;
      if (!event.end_time && result.parsed.end_time) event.end_time = result.parsed.end_time;
      log(`[critical] FILLED: ${event.venue} → ${event.start_time}-${event.end_time}`);
    }
  } catch (err) {
    log(`[critical] LLM failed for ${event.venue}: ${err.message}`);
  }
  return event;
}

async function main() {
  const input = readStepOutput(PIPELINE, 'step-1-discover');
  if (!input) { log('No step-1 output found — aborting'); process.exit(1); }
  if (input.acquireError) {
    log('[critical] Step 1 had acquire error — passing through');
    writeStepOutput(PIPELINE, 'step-3-enriched', { ...input, enrichedEvents: [] });
    closeLog(); return;
  }

  const todayLabel = input.dateLabel || getTodayLabel();
  const todayDate = input.date || getTodayDate();
  const dayAbbr = getTodayDayAbbr();
  const dayNum = String(new Date().getDay());
  log(`=== Live Music Critical Fill: ${todayLabel} ===`);
  log(`[critical] Processing ${input.mappedEvents.length} event(s)`);

  const enrichedEvents = [];
  for (const event of input.mappedEvents) {
    if (!event.venue_id) {
      log(`[critical] SKIP: ${event.venue} — no venue resolved`);
      continue;
    }

    const filled = await fillMissingTimes({ ...event }, todayLabel);

    if (!filled.start_time) {
      log(`[critical] DROP: ${filled.venue} — no start time after LLM`);
      continue;
    }
    if (!filled.end_time) filled.end_time = estimateEndTime(filled.start_time);
    if (!filled.end_time) {
      log(`[critical] DROP: ${filled.venue} — could not estimate end time`);
      continue;
    }

    const promoTime = buildPromoTime(dayAbbr, filled.start_time, filled.end_time);
    const { timeStart, timeEnd } = parseTimeRange(promoTime);
    const daysStr = (parseDayPart(dayAbbr) || []).sort((a, b) => a - b).join(',') || dayNum;

    enrichedEvents.push({
      venue: filled.venue,
      venue_id: filled.venue_id,
      venue_created: filled.venue_created,
      title: filled.venue,
      performer: filled.performer,
      description: `${filled.performer}. ${filled.description}`.trim(),
      promotion_time: promoTime,
      time_start: timeStart,
      time_end: timeEnd,
      days: daysStr,
      specific_date: todayDate,
    });
  }

  log(`[critical] ${enrichedEvents.length} event(s) fully enriched`);

  writeStepOutput(PIPELINE, 'step-3-enriched', {
    ...input, enrichedEvents,
    droppedCount: input.mappedEvents.length - enrichedEvents.length,
  });
  closeLog();
}

main().catch(e => { logError('Fatal:', e); closeLog(); process.exit(1); });
