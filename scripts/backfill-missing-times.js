#!/usr/bin/env node
/**
 * backfill-missing-times.js
 *
 * Bulk-resolves missing time_start / time_end / days for all approved spots
 * that have NULL in those columns.
 *
 * Uses Grok web-search API: asks specifically about the venue's activity
 * schedule and expects JSON back with the exact columns we need.
 *
 * Two-tier per spot:
 *   Tier 1 — raw promotion_time string exists but regex couldn't parse it
 *             → ask Grok chat to parse it (fast, cheap)
 *   Tier 2 — no raw time string at all
 *             → ask Grok with web_search to look it up online
 *
 * Usage:
 *   node scripts/backfill-missing-times.js [--dry-run] [--type "Happy Hour"] [--limit 20]
 *
 * Produces:
 *   logs/backfill-missing-times.log  — full run log
 *   data/reporting/missing-times.json — updated missing-times report
 */

'use strict';

const fs   = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local') });

const db              = require('./utils/db');
const { chat, webSearch, getApiKey } = require('./utils/llm-client');
const { reportingPath }              = require('./utils/data-dir');

// ── CLI args ────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const TYPE_FILTER = (() => {
  const i = args.indexOf('--type');
  return i !== -1 ? args[i + 1] : null;
})();
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  return i !== -1 ? parseInt(args[i + 1]) || 200 : 200;
})();

// ── Logging ─────────────────────────────────────────────────────
const logDir  = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
const logPath = path.join(logDir, 'backfill-missing-times.log');
fs.writeFileSync(logPath, '', 'utf8');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(msg);
  fs.appendFileSync(logPath, line + '\n');
}

// ── LLM prompts ─────────────────────────────────────────────────

const PARSE_SYSTEM = `You convert restaurant promotion time strings into structured JSON.
Return ONLY a JSON object — no explanation, no markdown fences.

Required fields:
  "time_start"    : "HH:MM" in 24-hour format (e.g. "16:00" for 4 pm), or null
  "time_end"      : "HH:MM" in 24-hour format (e.g. "19:00" for 7 pm), or null
  "days"          : comma-separated JS getDay() numbers where 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat
                    (e.g. "1,2,3,4,5" for Mon–Fri, "0,6" for weekends), or null
  "specific_date" : ISO date "YYYY-MM-DD" if it's a one-time event, otherwise null

Examples:
  "4pm-7pm Mon-Fri"      → {"time_start":"16:00","time_end":"19:00","days":"1,2,3,4,5","specific_date":null}
  "Saturday-Sunday"      → {"time_start":null,"time_end":null,"days":"0,6","specific_date":null}
  "Nightly 8pm-close"    → {"time_start":"20:00","time_end":null,"days":"0,1,2,3,4,5,6","specific_date":null}
  "all day"              → {"time_start":"00:00","time_end":"23:59","days":null,"specific_date":null}
  "Fri/Sat nights"       → {"time_start":null,"time_end":null,"days":"5,6","specific_date":null}`;

function buildSearchPrompt(title, type, website, address, rawTime) {
  const websiteNote = website ? `Their website: ${website}` : '';
  const addressNote = address ? `Address: ${address}` : 'Location: Charleston, SC';
  const rawNote     = rawTime  ? `We already know it happens on: "${rawTime}" but need the specific start/end times.` : '';

  return `I need the ${type} schedule for a Charleston, SC venue called "${title}".
${websiteNote}
${addressNote}
${rawNote}

Please look this up and return ONLY a JSON object with exactly these fields:

{
  "time_start"    : "HH:MM",   // 24-hour format start time, e.g. "16:00" for 4 pm. null if unknown.
  "time_end"      : "HH:MM",   // 24-hour format end time,   e.g. "19:00" for 7 pm. null if unknown.
  "days"          : "1,2,3,4,5", // comma-separated day numbers: 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat. null if unknown.
  "specific_date" : null        // ISO date "YYYY-MM-DD" if one-time event, otherwise null.
}

No markdown, no explanation — only the JSON object.`;
}

// ── Validation helpers ───────────────────────────────────────────

function validateTime(t) {
  if (!t || typeof t !== 'string') return null;
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1]), min = parseInt(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function validateDays(d) {
  if (!d || typeof d !== 'string') return null;
  const nums = d.split(',')
    .map(s => parseInt(s.trim()))
    .filter(n => !isNaN(n) && n >= 0 && n <= 6);
  if (nums.length === 0) return null;
  return [...new Set(nums)].sort((a, b) => a - b).join(',');
}

function validateDate(d) {
  if (!d || typeof d !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  const apiKey = getApiKey();
  if (!apiKey) {
    log('❌ GROK_API_KEY not set — aborting');
    process.exit(1);
  }

  db.setAuditContext('llm', 'backfill-missing-times');
  log(`=== backfill-missing-times.js START${DRY_RUN ? ' (DRY RUN)' : ''} ===`);
  if (TYPE_FILTER) log(`   Type filter: ${TYPE_FILTER}`);
  log(`   Limit: ${LIMIT}`);

  const d = db.getDb();

  // ── Load spots missing times ──
  let typeClause = `s.type IN ('Happy Hour', 'Brunch', 'Live Music')`;
  if (TYPE_FILTER) typeClause = `s.type = '${TYPE_FILTER.replace(/'/g, '')}'`;

  const rows = d.prepare(`
    SELECT s.id, s.title, s.type, s.area,
           s.promotion_time, s.source_url,
           v.name  AS venue_name,
           v.website,
           v.address
    FROM spots s
    LEFT JOIN venues v ON v.id = s.venue_id
    WHERE s.status = 'approved'
      AND s.time_start IS NULL
      AND s.time_end   IS NULL
      AND s.manual_override = 0
      AND ${typeClause}
    ORDER BY s.type, s.title
    LIMIT ${LIMIT}
  `).all();

  log(`\n📋 Found ${rows.length} spot(s) with missing times\n`);

  if (rows.length === 0) {
    log('✅ Nothing to backfill — all approved spots have times.');
    db.closeDb();
    return;
  }

  // Print full list upfront
  const byType = {};
  for (const r of rows) { byType[r.type] = (byType[r.type] || 0) + 1; }
  log('   By type: ' + Object.entries(byType).map(([t, n]) => `${t}: ${n}`).join(' | '));
  log('');

  // ── Process each spot ──
  let resolved  = 0;
  let unresolved = 0;
  const unresolvedList = [];

  for (let i = 0; i < rows.length; i++) {
    const row     = rows[i];
    const rawTime = row.promotion_time ? row.promotion_time.trim() : null;
    const website = row.source_url || row.website;

    log(`[${i + 1}/${rows.length}] #${row.id} [${row.type}] ${row.title} (${row.area || '?'})`);
    if (rawTime) log(`   raw time string: "${rawTime}"`);
    if (website) log(`   website: ${website}`);

    let result = null;
    let tier   = null;

    // ── Tier 1: parse existing raw string with LLM chat ──
    if (rawTime) {
      tier = 1;
      log('   → Tier 1: asking LLM to parse raw string...');
      const chatResult = await chat({
        messages: [
          { role: 'system', content: PARSE_SYSTEM },
          { role: 'user',   content: rawTime },
        ],
        temperature: 0,
        timeoutMs:   30000,
        apiKey,
        log,
      });
      if (chatResult?.parsed) result = chatResult.parsed;
    }

    // ── Tier 2: web search lookup ──
    // Trigger if we still don't have actual start/end times (even if Tier 1 found days)
    const tier1HadTimes = result && (result.time_start || result.time_end);
    if (!tier1HadTimes) {
      tier = 2;
      log('   → Tier 2: asking Grok with web search...');
      const prompt = buildSearchPrompt(
        row.title,
        row.type,
        website,
        row.address,
        rawTime,
      );
      const searchResult = await webSearch({ prompt, timeoutMs: 90000, apiKey, log });
      if (searchResult?.parsed) {
        // Merge: keep days from Tier 1 if Tier 2 didn't find them
        const t1Days = result ? validateDays(result.days) : null;
        result = searchResult.parsed;
        if (!result.days && t1Days) result.days = t1Days;
      }
    }

    // ── Validate & apply ──
    let timeStart    = null;
    let timeEnd      = null;
    let days         = null;
    let specificDate = null;

    if (result) {
      timeStart    = validateTime(result.time_start);
      timeEnd      = validateTime(result.time_end);
      days         = validateDays(result.days);
      specificDate = validateDate(result.specific_date);
    }

    if (timeStart || timeEnd || days) {
      log(`   ✅ Resolved (tier ${tier}): time_start=${timeStart || 'null'} time_end=${timeEnd || 'null'} days=${days || 'null'}${specificDate ? ' specific_date=' + specificDate : ''}`);
      if (!DRY_RUN) {
        db.spots.update(row.id, { time_start: timeStart, time_end: timeEnd, days, specific_date: specificDate });
      } else {
        log('   (DRY RUN — no DB write)');
      }
      resolved++;
    } else {
      log(`   ❌ Unresolved — couldn't find times even with web search`);
      unresolved++;
      unresolvedList.push({
        id:           row.id,
        title:        row.title,
        type:         row.type,
        area:         row.area,
        promotionTime: rawTime,
        sourceUrl:    website,
      });
    }

    // Be kind to the API — small delay between calls
    if (i < rows.length - 1) await sleep(500);
  }

  // ── Summary ──
  log(`\n${'='.repeat(50)}`);
  log(`📊 Backfill complete:`);
  log(`   ✅ Resolved:   ${resolved}`);
  log(`   ❌ Unresolved: ${unresolved}`);
  if (DRY_RUN) log(`   (DRY RUN — no changes written to DB)`);

  if (unresolvedList.length > 0) {
    log(`\n⚠️  Spots that still need manual time entry:`);
    for (const s of unresolvedList) {
      log(`   #${s.id} [${s.type}] ${s.title}${s.area ? ' (' + s.area + ')' : ''}${s.promotionTime ? ' — raw: "' + s.promotionTime + '"' : ''}`);
      if (s.sourceUrl) log(`      ${s.sourceUrl}`);
    }
  }

  // ── Update missing-times.json for the daily report ──
  try {
    const reportDir = path.dirname(reportingPath('missing-times.json'));
    if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });

    // Re-query DB to get the fresh unresolved count
    const stillMissing = d.prepare(`
      SELECT s.id, s.title, s.type, s.area, s.promotion_time, s.source_url
      FROM spots s
      WHERE s.status = 'approved'
        AND s.time_start IS NULL AND s.time_end IS NULL
        AND s.type IN ('Happy Hour', 'Brunch', 'Live Music')
      ORDER BY s.type, s.title
    `).all();

    fs.writeFileSync(reportingPath('missing-times.json'), JSON.stringify({
      generatedAt:  new Date().toISOString(),
      count:        stillMissing.length,
      llmResolved:  resolved,
      spots:        stillMissing.map(r => ({
        id:           r.id,
        title:        r.title,
        type:         r.type,
        area:         r.area,
        promotionTime: r.promotion_time,
        sourceUrl:    r.source_url,
      })),
    }, null, 2), 'utf8');

    log(`\n📄 Updated missing-times.json: ${stillMissing.length} still unresolved`);
  } catch (err) {
    log(`⚠️  Could not write missing-times.json: ${err.message}`);
  }

  log('\n=== backfill-missing-times.js DONE ===');
  db.closeDb();
}

main().catch(err => {
  log(`❌ Fatal: ${err.message}`);
  console.error(err);
  db.closeDb();
  process.exit(1);
});
