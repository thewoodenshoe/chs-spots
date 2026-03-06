#!/usr/bin/env node
/**
 * check-opening-status.js — Nightly Coming Soon Lifecycle Check
 *
 * For each "Coming Soon" spot, uses Grok web search to determine
 * whether the venue has opened. If opened:
 *   1. Expires the Coming Soon spot
 *   2. Creates a new "Recently Opened" spot linked to the same venue
 *
 * Also refreshes stale Coming Soon spots that haven't been updated
 * in over 30 days with the latest info.
 */

const db = require('./utils/db');
const { createLogger } = require('./utils/logger');
const { webSearch, getApiKey } = require('./utils/llm-client');
const { detectSecondaryTypes } = require('./utils/activity-tagger');

const { log, warn, error, close: closeLog } = createLogger('check-opening-status');

const CHECK_DELAY_MS = 2000;
const STALE_THRESHOLD_DAYS = 30;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function checkIfOpened(spot) {
  const venueInfo = spot.venue_id
    ? db.venues.getById(spot.venue_id)
    : null;

  const address = venueInfo?.address || spot.area || 'Charleston, SC';
  const prompt = `Has the restaurant/bar "${spot.title}" at ${address} in Charleston, South Carolina opened yet?

Search for the latest information. Look for:
- Google Maps listing showing as "open" or having reviews
- Social media posts showing food/drinks being served
- News articles announcing opening
- Website showing hours or reservation availability

Return ONLY a JSON object:
{
  "opened": true or false,
  "evidence": "brief explanation of why you determined this",
  "open_date": "YYYY-MM-DD if you can determine the opening date, otherwise null",
  "updated_description": "1-2 sentence updated description of the venue if you have new info, otherwise null"
}`;

  const result = await webSearch({ prompt, timeoutMs: 90000, log });
  if (!result?.parsed) return null;
  return result.parsed;
}

function transitionToRecentlyOpened(spot, openDate, updatedDescription) {
  const today = new Date().toISOString().split('T')[0];
  const description = updatedDescription || spot.description || `Recently opened in ${spot.area || 'Charleston'}.`;

  db.getDb().prepare(
    `UPDATE spots SET status = 'expired', updated_at = datetime('now') WHERE id = ?`
  ).run(spot.id);

  const newId = db.spots.insert({
    venue_id: spot.venue_id,
    title: spot.title,
    type: 'Recently Opened',
    source: 'automated',
    status: 'approved',
    description,
    source_url: spot.source_url || null,
    photo_url: spot.photo_url || null,
    lat: spot.lat,
    lng: spot.lng,
    area: spot.area || 'Downtown Charleston',
    last_update_date: openDate || today,
  });

  const secondaryTypes = detectSecondaryTypes(`${spot.title} ${description}`, 'Recently Opened');
  for (const secType of secondaryTypes) {
    try {
      db.spots.insert({
        venue_id: spot.venue_id, title: spot.title, type: secType,
        source: 'automated', status: 'approved', description,
        source_url: spot.source_url || null, photo_url: spot.photo_url || null,
        lat: spot.lat, lng: spot.lng, area: spot.area || 'Downtown Charleston',
        last_update_date: openDate || today,
      });
    } catch (err) { warn(`Cross-tag "${secType}" failed for "${spot.title}": ${err.message}`); }
  }

  return newId;
}

async function main() {
  const { acquire: acquireLock, release: releaseLock } = require('./utils/pipeline-lock');
  const lock = acquireLock('check-opening-status');
  if (!lock.acquired) { log(`Pipeline locked by ${lock.holder}. Exiting.`); return; }

  if (!getApiKey()) {
    warn('No GROK_API_KEY set — cannot check opening status');
    releaseLock();
    return;
  }

  const startTime = Date.now();
  log('Checking Coming Soon spots for opened venues...');

  const comingSoonSpots = db.getDb().prepare(
    `SELECT * FROM spots WHERE type = 'Coming Soon' AND status = 'approved' ORDER BY id`
  ).all();

  log(`Found ${comingSoonSpots.length} active Coming Soon spots`);
  if (comingSoonSpots.length === 0) { releaseLock(); closeLog(); db.closeDb(); return; }

  let transitioned = 0;
  let checked = 0;
  let errors = 0;
  const transitionedNames = [];

  for (const spot of comingSoonSpots) {
    await delay(CHECK_DELAY_MS);
    checked++;

    try {
      log(`[${checked}/${comingSoonSpots.length}] Checking "${spot.title}"...`);
      const result = await checkIfOpened(spot);

      if (!result) {
        warn(`No result for "${spot.title}" — skipping`);
        continue;
      }

      if (result.opened) {
        const newId = transitionToRecentlyOpened(spot, result.open_date, result.updated_description);
        transitioned++;
        transitionedNames.push(spot.title);
        log(`"${spot.title}" has OPENED -> new Recently Opened spot #${newId}`);
      } else {
        log(`"${spot.title}" still coming soon: ${result.evidence || 'no evidence of opening'}`);
        if (result.updated_description) {
          db.getDb().prepare('UPDATE spots SET description = ?, updated_at = datetime(\'now\') WHERE id = ?')
            .run(result.updated_description, spot.id);
        }
        db.getDb().prepare('UPDATE spots SET last_update_date = ?, updated_at = datetime(\'now\') WHERE id = ?')
          .run(new Date().toISOString().split('T')[0], spot.id);
      }
    } catch (err) {
      errors++;
      error(`Error checking "${spot.title}": ${err.message}`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`Check complete in ${elapsed}s: ${checked} checked, ${transitioned} transitioned, ${errors} errors`);

  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID || '';
  if (token && chatId && transitioned > 0) {
    const lines = [`Opening Status Check`, '', `${transitioned} venue(s) transitioned to Recently Opened:`,
      ...transitionedNames.map(n => `  ${n}`), '', `${checked} total checked, ${errors} errors`];
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: lines.join('\n'), disable_web_page_preview: true }),
      });
    } catch (err) { warn(`Telegram failed: ${err.message}`); }
  }

  releaseLock();
  closeLog();
  db.closeDb();
}

main().catch(err => {
  console.error('Fatal:', err);
  try { require('./utils/pipeline-lock').release(); } catch { /* already released */ }
  process.exit(1);
});
