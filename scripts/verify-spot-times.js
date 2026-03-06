#!/usr/bin/env node
/**
 * verify-spot-times.js — Batch-verify Happy Hour & Brunch times via Grok web search
 *
 * Sends batches of 10 venues to Grok, asking it to confirm or correct
 * time_start, time_end, and days. Applies corrections and sets
 * manual_override=1 so the nightly ETL won't overwrite verified data.
 *
 * Usage:
 *   node scripts/verify-spot-times.js              # dry-run (preview changes)
 *   node scripts/verify-spot-times.js --apply       # apply corrections to DB
 *   node scripts/verify-spot-times.js --type Brunch # verify only Brunch
 */

const path = require('path');
try { require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local') }); } catch {}
const db = require('./utils/db');
const { createLogger } = require('./utils/logger');
const { webSearch, requireApiKey } = require('./utils/llm-client');

const { log, warn, error, close: closeLog } = createLogger('verify-spot-times');

const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 3000;
const APPLY = process.argv.includes('--apply');
const TYPE_FILTER = (() => {
  const idx = process.argv.indexOf('--type');
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : null;
})();

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function formatTime(t) {
  if (!t) return 'unknown';
  return t.replace(/^(\d{2}):(\d{2})$/, (_, h, m) => {
    const hr = parseInt(h);
    const ampm = hr >= 12 ? 'PM' : 'AM';
    const h12 = hr === 0 ? 12 : hr > 12 ? hr - 12 : hr;
    return `${h12}:${m} ${ampm}`;
  });
}

function formatDays(d) {
  if (!d) return 'unknown';
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return d.split(',').map(n => names[parseInt(n.trim())] || n).join(', ');
}

function buildBatchPrompt(spots) {
  const venueLines = spots.map((s, i) => {
    const current = [];
    if (s.time_start || s.time_end) {
      current.push(`Time: ${formatTime(s.time_start)} to ${formatTime(s.time_end)}`);
    } else {
      current.push('Time: UNKNOWN');
    }
    current.push(`Days: ${s.days ? formatDays(s.days) : 'UNKNOWN'}`);
    const addr = s.address || 'Charleston, SC';
    return `${i + 1}. "${s.title}" (${s.type}) at ${addr}\n   Current: ${current.join(' | ')}`;
  }).join('\n');

  return `I need you to verify the happy hour and brunch schedules for these Charleston, SC venues. Search each venue's website, Google listing, and social media for their current schedule.

For each venue below, I've listed what we currently have on file. Please check if it's correct.

${venueLines}

Return ONLY a JSON array. For EACH venue (all ${spots.length}), include an entry:
- If our data is CORRECT: {"index": 1, "status": "confirmed"}
- If our data is WRONG or INCOMPLETE: {"index": 1, "status": "corrected", "time_start": "HH:MM", "time_end": "HH:MM", "days": "0,1,2,3,4,5,6"}
- If the venue NO LONGER offers this deal: {"index": 1, "status": "discontinued"}

Time format: 24-hour "HH:MM" (e.g., "16:00" = 4 PM, "07:00" = 7 AM)
Days format: comma-separated numbers where 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat

Only return the JSON array, nothing else. Be thorough — search each venue individually.`;
}

function loadSpots() {
  const d = db.getDb();
  let sql = `SELECT s.id, s.title, s.type, s.time_start, s.time_end, s.days,
    s.venue_id, s.manual_override, v.address, v.website
    FROM spots s LEFT JOIN venues v ON v.id = s.venue_id
    WHERE s.status = 'approved' AND s.type IN ('Happy Hour', 'Brunch')`;
  if (TYPE_FILTER) sql += ` AND s.type = '${TYPE_FILTER}'`;
  sql += ' ORDER BY s.type, s.title';
  return d.prepare(sql).all();
}

async function processBatch(batch, batchNum, totalBatches) {
  log(`[batch ${batchNum}/${totalBatches}] Verifying ${batch.length} spots...`);
  const prompt = buildBatchPrompt(batch);
  const result = await webSearch({ prompt, timeoutMs: 120000, log });

  if (!result?.parsed || !Array.isArray(result.parsed)) {
    warn(`[batch ${batchNum}] No valid JSON response`);
    return [];
  }

  const corrections = [];
  for (const item of result.parsed) {
    const idx = (item.index || item.i) - 1;
    if (idx < 0 || idx >= batch.length) continue;
    const spot = batch[idx];

    if (item.status === 'corrected') {
      corrections.push({
        id: spot.id,
        title: spot.title,
        type: spot.type,
        old: { time_start: spot.time_start, time_end: spot.time_end, days: spot.days },
        new: { time_start: item.time_start, time_end: item.time_end, days: item.days },
      });
      log(`  CORRECTED: "${spot.title}" [${spot.type}]`);
      log(`    Was: ${formatTime(spot.time_start)}-${formatTime(spot.time_end)} | ${formatDays(spot.days)}`);
      log(`    Now: ${formatTime(item.time_start)}-${formatTime(item.time_end)} | ${formatDays(item.days)}`);
    } else if (item.status === 'discontinued') {
      corrections.push({ id: spot.id, title: spot.title, type: spot.type, discontinued: true });
      log(`  DISCONTINUED: "${spot.title}" [${spot.type}]`);
    } else {
      log(`  confirmed: "${spot.title}" [${spot.type}]`);
    }
  }
  return corrections;
}

async function main() {
  requireApiKey('verify-spot-times');
  db.setAuditContext('llm', 'verify-spot-times');
  const spots = loadSpots();
  log(`Loaded ${spots.length} spots to verify (${APPLY ? 'APPLY mode' : 'DRY-RUN mode'})`);
  if (TYPE_FILTER) log(`Filtered to type: ${TYPE_FILTER}`);

  const batches = [];
  for (let i = 0; i < spots.length; i += BATCH_SIZE) {
    batches.push(spots.slice(i, i + BATCH_SIZE));
  }
  log(`Split into ${batches.length} batches of up to ${BATCH_SIZE}`);

  const allCorrections = [];
  for (let i = 0; i < batches.length; i++) {
    if (i > 0) await delay(BATCH_DELAY_MS);
    const corrections = await processBatch(batches[i], i + 1, batches.length);
    allCorrections.push(...corrections);
  }

  log(`\nVerification complete: ${allCorrections.length} correction(s) found out of ${spots.length} spots`);
  const confirmed = spots.length - allCorrections.length;
  log(`  Confirmed correct: ${confirmed}`);
  log(`  Need correction: ${allCorrections.filter(c => !c.discontinued).length}`);
  log(`  Discontinued: ${allCorrections.filter(c => c.discontinued).length}`);

  if (APPLY && allCorrections.length > 0) {
    log('\nApplying corrections...');

    let applied = 0;
    let expired = 0;
    let locked = 0;

    for (const c of allCorrections) {
      if (c.discontinued) {
        db.spots.update(c.id, { status: 'expired', manual_override: 1 }, { force: true });
        expired++;
      } else {
        db.spots.update(c.id, {
          time_start: c.new.time_start, time_end: c.new.time_end,
          days: c.new.days, manual_override: 1,
        }, { force: true });
        applied++;
      }
    }

    const correctedIds = new Set(allCorrections.map(c => c.id));
    for (const spot of spots) {
      if (!correctedIds.has(spot.id) && !spot.manual_override) {
        db.spots.update(spot.id, { manual_override: 1 }, { force: true });
        locked++;
      }
    }

    log(`Applied: ${applied} corrections, ${expired} expired, ${locked} confirmed & locked`);
  } else if (!APPLY && allCorrections.length > 0) {
    log('\nDRY-RUN: No changes written. Run with --apply to update the database.');
  }

  // Set manual_override on all spots even in apply mode for confirmed ones
  if (APPLY) {
    log('\nAll verified spots now have manual_override=1 (ETL-protected)');
  }

  closeLog();
  db.closeDb();
}

main().catch(err => {
  error(`Fatal: ${err.message}`);
  console.error(err);
  process.exit(1);
});
