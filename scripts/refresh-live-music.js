#!/usr/bin/env node
/**
 * refresh-live-music.js - Daily Live Music Event Refresh
 *
 * Uses Grok web search to find tonight's live music events in Charleston,
 * then updates existing Live Music spots with parseable show times so
 * isSpotActiveNow() works correctly.
 *
 * Runs daily at 3:00 PM EST via cron.
 * Cost: ~$0.05-0.10/day (single Grok web search call)
 *
 * Usage: node scripts/refresh-live-music.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const db = require('./utils/db');

const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
const logPath = path.join(logDir, 'refresh-live-music.log');
fs.writeFileSync(logPath, '', 'utf8');

function log(msg) {
  const ts = new Date().toISOString();
  console.log(msg);
  fs.appendFileSync(logPath, `[${ts}] ${msg}\n`);
}

try {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local') });
} catch (e) {
  try { require('dotenv').config(); } catch (_) {}
}

const { webSearch, getApiKey } = require('./utils/llm-client');

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT = process.env.TELEGRAM_ADMIN_CHAT_ID || '';
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

function getTodayLabel() {
  const now = getEstNow();
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return `${DAY_NAMES[now.getDay()]}, ${months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
}

async function sendTelegram(text) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT) return;
  try {
    const payload = JSON.stringify({ chat_id: TELEGRAM_CHAT, text, parse_mode: 'HTML' });
    await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.telegram.org',
        path: `/bot${TELEGRAM_TOKEN}/sendMessage`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      }, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d)); });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  } catch (e) {
    log(`  Telegram failed: ${e.message}`);
  }
}

function normalizeVenueName(name) {
  return name
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/^the\s+/i, '')
    .replace(/\s*[-–—]\s*charleston.*$/i, '')
    .replace(/\s*\(.*\)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildPromotionTime(dayAbbr, startTime, endTime) {
  const s = startTime.replace(/\s+/g, '').toLowerCase();
  const e = endTime ? endTime.replace(/\s+/g, '').toLowerCase() : null;
  const timeRange = e ? `${s}-${e}` : s;
  return `${timeRange} • ${dayAbbr}`;
}

async function fetchTonightsEvents(venueNames) {
  const todayLabel = getTodayLabel();
  const venueList = venueNames.join(', ');

  const prompt = `Search the web for live music events happening TONIGHT (${todayLabel}) at venues in the Charleston, South Carolina area. Focus on these known live music venues: ${venueList}.

Also include any other Charleston area venues with live music tonight that are not in the list above.

Return a JSON array of objects with these fields:
- "venue": exact venue name
- "performer": name of the band/artist/act performing tonight
- "start_time": show start time in "8:00 PM" format (use listed start time, not doors)
- "end_time": estimated end time in "11:00 PM" format (if not listed, estimate: +3hrs for bar shows, +2hrs for concerts)
- "description": one sentence about the performer or type of music

Only include events confirmed for TONIGHT ${todayLabel}. Do NOT include events from other dates. Maximum 40 results.`;

  log(`[refresh-live-music] Searching for events: ${todayLabel}`);
  log(`[refresh-live-music] Querying ${venueNames.length} venue names`);

  const result = await webSearch({ prompt, timeoutMs: 120000, log });
  if (!result?.parsed || !Array.isArray(result.parsed)) {
    log('[refresh-live-music] Grok returned no valid JSON array');
    return [];
  }

  const events = result.parsed
    .filter(e => e.venue && e.start_time)
    .map(e => ({
      venue: e.venue.trim(),
      performer: (e.performer || 'Live Music').trim(),
      startTime: e.start_time.trim(),
      endTime: (e.end_time || '').trim(),
      description: (e.description || '').trim(),
    }));

  log(`[refresh-live-music] Found ${events.length} events with valid times`);
  return events;
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

  const startTime = Date.now();
  const todayLabel = getTodayLabel();
  const dayAbbr = DAY_ABBR[getEstNow().getDay()];
  log('=== Daily Live Music Refresh ===\n');

  const database = db.getDb();

  const existingSpots = database.prepare(
    "SELECT id, title, promotion_time, description FROM spots WHERE type = 'Live Music' AND status = 'approved'"
  ).all();
  log(`[refresh-live-music] ${existingSpots.length} Live Music spots in DB`);

  const spotsByNorm = new Map();
  const venueNames = [];
  for (const spot of existingSpots) {
    spotsByNorm.set(normalizeVenueName(spot.title), spot);
    venueNames.push(spot.title);
  }

  const events = await fetchTonightsEvents(venueNames);

  let matched = 0;
  let unmatched = 0;
  const matchedNames = [];
  const unmatchedNames = [];
  const updatedSpotIds = new Set();

  for (const event of events) {
    const spot = matchEventToSpot(event, spotsByNorm);

    if (!spot) {
      unmatched++;
      unmatchedNames.push(`${event.venue}: ${event.performer}`);
      log(`[refresh-live-music] UNMATCHED: ${event.venue} — ${event.performer} @ ${event.startTime}`);
      continue;
    }

    const promoTime = buildPromotionTime(dayAbbr, event.startTime, event.endTime);

    if (updatedSpotIds.has(spot.id)) {
      log(`[refresh-live-music] MULTI-SHOW: ${spot.title} already updated (${event.performer})`);
      if (!DRY_RUN) {
        const current = database.prepare("SELECT description FROM spots WHERE id = ?").get(spot.id);
        const combinedDesc = `${current.description} | ${event.performer}. ${event.description}`.trim();
        database.prepare("UPDATE spots SET description = ? WHERE id = ?").run(combinedDesc, spot.id);
      }
      matched++;
      matchedNames.push(`${spot.title}: ${event.performer} (multi-show)`);
      continue;
    }

    const desc = `${event.performer}. ${event.description}`.trim();

    if (DRY_RUN) {
      log(`[refresh-live-music] DRY RUN: ${spot.title} → "${promoTime}" (${event.performer})`);
    } else {
      database.prepare(
        "UPDATE spots SET promotion_time = ?, description = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(promoTime, desc, spot.id);
      log(`[refresh-live-music] UPDATED: ${spot.title} → "${promoTime}" (${event.performer})`);
    }

    matched++;
    updatedSpotIds.add(spot.id);
    matchedNames.push(`${spot.title}: ${event.performer}`);
  }

  if (!DRY_RUN) {
    let cleared = 0;
    for (const spot of existingSpots) {
      if (updatedSpotIds.has(spot.id)) continue;
      if (spot.promotion_time && /•\s*(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s*$/i.test(spot.promotion_time)) {
        database.prepare(
          "UPDATE spots SET promotion_time = NULL, updated_at = datetime('now') WHERE id = ?"
        ).run(spot.id);
        cleared++;
      }
    }
    if (cleared > 0) log(`[refresh-live-music] Cleared stale times from ${cleared} spots`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`\n[refresh-live-music] Done: ${matched} matched, ${unmatched} unmatched, ${elapsed}s`);
  if (DRY_RUN) log('(DRY RUN — nothing written)');

  const msg = [
    `🎵 <b>Live Music Refresh</b> (${todayLabel})`,
    '',
    `Events found: ${events.length}`,
    `Matched: ${matched}`,
    `Unmatched: ${unmatched}`,
    matched > 0 ? `\n<b>Tonight:</b>\n${matchedNames.join('\n')}` : '\nNo shows matched tonight.',
    unmatched > 0 ? `\n<i>Unmatched:</i> ${unmatchedNames.join(', ')}` : '',
    `\nElapsed: ${elapsed}s`,
  ].filter(Boolean).join('\n');
  await sendTelegram(msg);

  releaseLock();
  db.closeDb();
}

main().catch(e => {
  console.error('Fatal:', e);
  try { require('./utils/pipeline-lock').release(); } catch {}
  process.exit(1);
});
