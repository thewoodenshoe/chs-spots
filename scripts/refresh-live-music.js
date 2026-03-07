#!/usr/bin/env node
// Daily Live Music Refresh — finds today's events, creates venues/spots for unmatched.
// Step 1 of live music pipeline. Runs daily at 1pm EST.
// Usage: node scripts/refresh-live-music.js [--dry-run]

const fs = require('fs');
const path = require('path');
const db = require('./utils/db');
const { parseTimeRange, parseDayPart } = require('./utils/time-parse');
const { ensureVenue } = require('./utils/ensure-venue');
const { reportingPath } = require('./utils/data-dir');
const { createLogger } = require('./utils/logger');
const { log, warn, error: logError, close: closeLog } = createLogger('refresh-live-music');

try {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local') });
} catch { /* dotenv not installed in production */ }

const { webSearch, getApiKey } = require('./utils/llm-client');
const { loadPrompt } = require('./utils/load-prompt');

const DRY_RUN = process.argv.includes('--dry-run');

if (!getApiKey()) {
  log('Error: No Grok API key found');
  process.exit(1);
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function getEstNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function getTodayLabel() {
  const n = getEstNow();
  return `${DAY_NAMES[n.getDay()]}, ${MONTHS[n.getMonth()]} ${n.getDate()}, ${n.getFullYear()}`;
}

function getTodayDate() {
  const n = getEstNow();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
}

function normalizeVenueName(name) {
  return name.toLowerCase().replace(/['']/g, "'").replace(/^the\s+/i, '')
    .replace(/\s*[-–—]\s*charleston.*$/i, '').replace(/\s*\(.*\)$/i, '')
    .replace(/\s+/g, ' ').trim();
}

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

function buildPromotionTime(dayAbbr, startTime, endTime) {
  const s = startTime.replace(/\s+/g, '').toLowerCase();
  const e = endTime ? endTime.replace(/\s+/g, '').toLowerCase() : null;
  const timeRange = e ? `${s}-${e}` : s;
  return `${timeRange} • ${dayAbbr}`;
}

async function fetchTodaysEvents(venueNames) {
  const todayLabel = getTodayLabel();
  const prompt = loadPrompt('llm-refresh-live-music', {
    TODAY_LABEL: todayLabel, VENUE_LIST: venueNames.join(', '),
  });
  log(`[refresh-live-music] Searching for events: ${todayLabel} (${venueNames.length} venues)`);
  const result = await webSearch({ prompt, timeoutMs: 120000, log });
  if (!result?.parsed || !Array.isArray(result.parsed)) {
    log('[refresh-live-music] Grok returned no valid JSON array');
    return { events: [], rawCount: 0, droppedCount: 0 };
  }
  const raw = result.parsed;
  const events = raw.filter(e => e.venue && e.start_time).map(e => ({
    venue: e.venue.trim(), performer: (e.performer || 'Live Music').trim(),
    startTime: e.start_time.trim(), endTime: (e.end_time || '').trim(),
    description: (e.description || '').trim(),
  }));
  const droppedCount = raw.length - events.length;
  log(`[refresh-live-music] Grok returned ${raw.length}, ${events.length} valid, ${droppedCount} dropped`);
  return { events, rawCount: raw.length, droppedCount };
}

function matchEventToSpot(event, spotsByNorm) {
  const normEvent = normalizeVenueName(event.venue);
  let spot = spotsByNorm.get(normEvent);
  if (spot) return spot;

  for (const [normTitle, s] of spotsByNorm) {
    if (normTitle.includes(normEvent) || normEvent.includes(normTitle)) return s;
  }
  return null;
}

async function main() {
  const { acquire: acquireLock, release: releaseLock } = require('./utils/pipeline-lock');
  const lock = acquireLock('refresh-live-music');
  if (!lock.acquired) {
    log(`[refresh-live-music] Pipeline locked by ${lock.holder}. Skipping.`);
    process.exit(0);
  }

  const startMs = Date.now();
  const todayLabel = getTodayLabel();
  const todayDate = getTodayDate();
  const dayAbbr = DAY_ABBR[getEstNow().getDay()];
  log('=== Daily Live Music Refresh ===\n');

  const database = db.getDb();
  db.setAuditContext('pipeline', 'refresh-live-music');

  const existingSpots = database.prepare(
    "SELECT id, title, promotion_time, description, venue_id FROM spots WHERE type = 'Live Music' AND status = 'approved'"
  ).all();
  log(`[refresh-live-music] ${existingSpots.length} Live Music spots in DB`);

  const spotsByNorm = new Map();
  const venueNames = [];
  for (const spot of existingSpots) {
    spotsByNorm.set(normalizeVenueName(spot.title), spot);
    venueNames.push(spot.title);
  }

  const { events, rawCount, droppedCount } = await fetchTodaysEvents(venueNames);

  let matched = 0;
  let created = 0;
  let skipped = 0;
  const details = { matched: [], created: [], skipped: [], multiShow: [] };
  const updatedSpotIds = new Set();

  for (const event of events) {
    const effectiveEnd = event.endTime || estimateEndTime(event.startTime);
    const promoTime = buildPromotionTime(dayAbbr, event.startTime, effectiveEnd || '');
    const { timeStart, timeEnd } = parseTimeRange(promoTime);
    const dayNums = parseDayPart(dayAbbr);
    const daysStr = dayNums ? dayNums.sort((a, b) => a - b).join(',') : null;
    const desc = `${event.performer}. ${event.description}`.trim();

    const spot = matchEventToSpot(event, spotsByNorm);

    const endEstimated = !event.endTime;
    const row = { venue: event.venue, performer: event.performer, time: promoTime, endEstimated };

    if (spot) {
      if (updatedSpotIds.has(spot.id)) {
        log(`[refresh-live-music] MULTI-SHOW: ${spot.title} (${event.performer})`);
        if (!DRY_RUN) {
          const current = database.prepare("SELECT description FROM spots WHERE id = ?").get(spot.id);
          db.spots.update(spot.id, { description: `${current.description} | ${desc}`.trim() });
        }
        matched++;
        details.multiShow.push(row);
        continue;
      }
      if (!DRY_RUN) {
        db.spots.update(spot.id, {
          promotion_time: promoTime, time_start: timeStart, time_end: timeEnd,
          days: daysStr, specific_date: todayDate, description: desc,
        });
      }
      log(`[refresh-live-music] ${DRY_RUN ? 'DRY RUN' : 'UPDATED'}: ${spot.title} → "${promoTime}"`);
      matched++;
      updatedSpotIds.add(spot.id);
      details.matched.push(row);
      continue;
    }

    const venueResult = await ensureVenue({ name: event.venue }, { db, log });
    if (!venueResult) {
      skipped++;
      details.skipped.push({ ...row, reason: 'Geocode failed or Places API disabled' });
      log(`[refresh-live-music] SKIP (no venue): ${event.venue}`);
      continue;
    }
    if (!DRY_RUN) {
      db.spots.insert({
        venue_id: venueResult.venue.id, title: event.venue, type: 'Live Music',
        source: 'automated', status: 'approved', description: desc,
        promotion_time: promoTime, time_start: timeStart, time_end: timeEnd,
        days: daysStr, specific_date: todayDate, last_update_date: todayDate,
      });
      spotsByNorm.set(normalizeVenueName(event.venue), { id: -1, title: event.venue });
    }
    log(`[refresh-live-music] ${DRY_RUN ? 'DRY RUN NEW' : 'CREATED'}: ${event.venue} → "${promoTime}"`);
    created++;
    details.created.push({ ...row, venueCreated: venueResult.created });
  }

  if (!DRY_RUN) {
    let cleared = 0;
    for (const spot of existingSpots) {
      if (updatedSpotIds.has(spot.id)) continue;
      if (spot.promotion_time && /•\s*(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s*$/i.test(spot.promotion_time)) {
        db.spots.update(spot.id, { promotion_time: null, time_start: null, time_end: null, days: null, specific_date: null });
        cleared++;
      }
    }
    if (cleared > 0) log(`[refresh-live-music] Cleared stale times from ${cleared} spots`);
  }

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  log(`\n[refresh-live-music] Done: ${matched} matched, ${created} created, ${skipped} skipped, ${elapsed}s`);
  if (DRY_RUN) log('(DRY RUN — nothing written)');

  const summary = {
    date: todayDate, dateLabel: todayLabel, elapsed, dryRun: DRY_RUN,
    existingSpots: existingSpots.length,
    acquisition: { raw: rawCount, valid: events.length, dropped: droppedCount },
    results: { matched, created, skipped, staleCleared: 0 },
    details,
  };
  if (!DRY_RUN) {
    const cleared = existingSpots.filter(s => !updatedSpotIds.has(s.id) && s.promotion_time).length;
    summary.results.staleCleared = cleared;
  }
  const summaryPath = reportingPath('live-music-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
  log(`[refresh-live-music] Summary written to ${summaryPath}`);

  releaseLock();
  closeLog();
  db.closeDb();
}

main().catch(e => {
  logError('Fatal:', e);
  console.error(e);
  closeLog();
  try { require('./utils/pipeline-lock').release(); } catch {}
  process.exit(1);
});
