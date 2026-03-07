#!/usr/bin/env node
/**
 * check-opening-status.js — Nightly Venue Lifecycle Management
 *
 * 1. Checks venues with venue_status='coming_soon' — uses Grok to determine
 *    if they've opened. If yes, transitions to 'recently_opened'.
 * 2. Ages out 'recently_opened' venues older than 3 months → 'active'.
 */

const db = require('./utils/db');
const { createLogger } = require('./utils/logger');
const { webSearch, getApiKey } = require('./utils/llm-client');
const { loadPrompt } = require('./utils/load-prompt');
const { logAgentDecision } = require('./utils/agent-log');

const { log, warn, error, close: closeLog } = createLogger('check-opening-status');

const CHECK_DELAY_MS = 2000;
const RECENTLY_OPENED_MAX_DAYS = 90;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function checkIfOpened(venue) {
  const address = venue.address || venue.area || 'Charleston, SC';
  const prompt = loadPrompt('coming-soon/step-6-lifecycle', {
    VENUE_NAME: venue.name,
    ADDRESS: address,
  });
  const start = Date.now();
  const result = await webSearch({ prompt, timeoutMs: 90000, log });
  const parsed = result?.parsed || null;
  logAgentDecision({
    agent: 'check-opening-status',
    promptFile: 'llm-opening-status-check',
    action: 'verify_opening',
    input: { venue: venue.name, address },
    output: parsed,
    decision: parsed?.opened ? 'opened' : 'still_coming_soon',
    applied: !!parsed,
    durationMs: Date.now() - start,
  });
  return parsed;
}

function ageOutRecentlyOpened() {
  const cutoff = new Date(Date.now() - RECENTLY_OPENED_MAX_DAYS * 86400000).toISOString().slice(0, 10);
  const result = db.getDb().prepare(
    "UPDATE venues SET venue_status = 'active', updated_at = datetime('now') WHERE venue_status = 'recently_opened' AND venue_added_at < ?",
  ).run(cutoff);
  if (result.changes > 0) log(`Aged ${result.changes} recently_opened venue(s) to active`);
  return result.changes;
}

async function main() {
  const { acquire: acquireLock, release: releaseLock } = require('./utils/pipeline-lock');
  const lock = acquireLock('check-opening-status');
  if (!lock.acquired) { log(`Pipeline locked by ${lock.holder}. Exiting.`); return; }

  if (!getApiKey()) {
    warn('No GROK_API_KEY set — cannot check opening status');
    releaseLock(); return;
  }

  const startTime = Date.now();
  log('Checking coming_soon venues for opened status...');

  const csVenues = db.venues.getByStatus('coming_soon');
  log(`Found ${csVenues.length} coming_soon venue(s)`);

  let transitioned = 0;
  let checked = 0;
  let errCount = 0;
  const transitionedNames = [];

  for (const venue of csVenues) {
    await delay(CHECK_DELAY_MS);
    checked++;
    try {
      log(`[${checked}/${csVenues.length}] Checking "${venue.name}"...`);
      const result = await checkIfOpened(venue);
      if (!result) { warn(`No result for "${venue.name}" — skipping`); continue; }

      if (result.opened) {
        db.venues.updateStatus(venue.id, 'recently_opened');
        transitioned++;
        transitionedNames.push(venue.name);
        log(`"${venue.name}" has OPENED -> recently_opened`);
      } else {
        log(`"${venue.name}" still coming soon: ${result.evidence || 'no evidence'}`);
        db.getDb().prepare(
          "UPDATE venues SET updated_at = datetime('now') WHERE id = ?",
        ).run(venue.id);
      }
    } catch (err) {
      errCount++;
      error(`Error checking "${venue.name}": ${err.message}`);
    }
  }

  const aged = ageOutRecentlyOpened();
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`Complete in ${elapsed}s: ${checked} checked, ${transitioned} transitioned, ${aged} aged out, ${errCount} errors`);

  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID || '';
  if (token && chatId && (transitioned > 0 || aged > 0)) {
    const lines = ['Venue Status Check', '',
      `${transitioned} venue(s) now open:`, ...transitionedNames.map(n => `  ${n}`),
      aged > 0 ? `${aged} aged out of recently_opened` : '',
      '', `${checked} checked, ${errCount} errors`].filter(Boolean);
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
  try { require('./utils/pipeline-lock').release(); } catch (_e) { /* already released */ }
  process.exit(1);
});
