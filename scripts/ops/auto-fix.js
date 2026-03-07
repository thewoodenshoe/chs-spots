#!/usr/bin/env node

/**
 * auto-fix.js — Pre-report auto-fix pass
 *
 * Reads logic-check.json and incomplete-spots.json, attempts LLM-powered
 * corrections for flagged/incomplete items, then re-writes the reports
 * so generate-report.js sees the final state.
 *
 * Usage: node scripts/ops/auto-fix.js [--dry-run]
 */

const fs = require('fs');
const db = require('../utils/db');
const { reportingPath } = require('../utils/data-dir');
const { webSearch, getApiKey } = require('../utils/llm-client');
const { loadPrompt } = require('../utils/load-prompt');
const { findIncompleteSpots, enrichIncompleteSpots } = require('../utils/enrich-incomplete');
const { runLogicChecks } = require('../utils/logic-check');
const { logAgentDecision } = require('../utils/agent-log');
const { createLogger } = require('../utils/logger');

const { log, warn, close: closeLog } = createLogger('auto-fix');
const DRY_RUN = process.argv.includes('--dry-run');

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
  const nums = d.split(',').map(s => parseInt(s.trim())).filter(n => n >= 0 && n <= 6);
  return nums.length > 0 ? [...new Set(nums)].sort((a, b) => a - b).join(',') : null;
}

async function fixFlaggedSpots(flagged) {
  if (!getApiKey() || flagged.length === 0) return { fixed: 0, stillFlagged: flagged.length };

  const items = flagged.slice(0, 15).map((f, i) => ({
    index: i,
    venue: f.title,
    type: f.type,
    time_start: f.time_start,
    time_end: f.time_end,
    days: f.days,
    issues: f.issues.map(iss => iss.msg).join('; '),
  }));

  const prompt = loadPrompt('shared/outlier-verification', {
    FLAGGED_ITEMS: JSON.stringify(items, null, 2),
    ACTIVITY_TYPE: [...new Set(items.map(i => i.type))].join('/'),
  });

  let fixed = 0;
  try {
    const result = await webSearch({ prompt, timeoutMs: 120000, log });
    if (!result?.parsed || !Array.isArray(result.parsed)) {
      warn('LLM outlier verification returned no valid result');
      return { fixed: 0, stillFlagged: flagged.length };
    }

    for (const verdict of result.parsed) {
      if (typeof verdict.index !== 'number' || verdict.index >= items.length) continue;
      if (verdict.verdict !== 'incorrect') continue;

      const item = items[verdict.index];
      const original = flagged[verdict.index];
      const updates = {};
      let hasUpdate = false;

      if (verdict.corrected_time_start) {
        const v = validateTime(verdict.corrected_time_start);
        if (v) { updates.time_start = v; hasUpdate = true; }
      }
      if (verdict.corrected_time_end) {
        const v = validateTime(verdict.corrected_time_end);
        if (v) { updates.time_end = v; hasUpdate = true; }
      }
      if (verdict.corrected_days) {
        const v = validateDays(verdict.corrected_days);
        if (v) { updates.days = v; hasUpdate = true; }
      }

      if (hasUpdate && !DRY_RUN) {
        db.spots.update(original.id, updates);
        fixed++;
        log(`  Fixed: ${item.venue} [${item.type}] → ${JSON.stringify(updates)} (${verdict.reasoning})`);
        logAgentDecision({ agent: 'auto-fix', promptFile: 'llm-outlier-verification', action: 'fix_flagged',
          input: { venue: item.venue, type: item.type, issues: item.issues },
          output: updates, decision: 'corrected', applied: true });
      } else if (hasUpdate) {
        fixed++;
        log(`  DRY RUN fix: ${item.venue} [${item.type}] → ${JSON.stringify(updates)}`);
      }
    }
  } catch (err) {
    warn(`Outlier verification failed: ${err.message}`);
  }

  return { fixed, stillFlagged: flagged.length - fixed };
}

async function main() {
  if (DRY_RUN) log('=== DRY RUN — no DB writes ===');
  log('=== auto-fix.js START ===');
  db.setAuditContext('pipeline', 'auto-fix');

  let logicFixed = 0;
  let enrichFixed = 0;

  const checkPath = reportingPath('logic-check.json');
  if (fs.existsSync(checkPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(checkPath, 'utf8'));
      const flagged = data.flagged || [];
      if (flagged.length > 0) {
        log(`Logic check: ${flagged.length} flagged spot(s) — attempting auto-fix...`);
        const result = await fixFlaggedSpots(flagged);
        logicFixed = result.fixed;
        log(`  Result: ${result.fixed} fixed, ${result.stillFlagged} still flagged`);
      }
    } catch (err) {
      warn(`Logic check read failed: ${err.message}`);
    }
  }

  try {
    const incomplete = findIncompleteSpots(db.getDb());
    if (incomplete.length > 0) {
      log(`Incomplete spots: ${incomplete.length} — second enrichment pass...`);
      const { enriched } = await enrichIncompleteSpots(incomplete, log);
      for (const r of enriched) {
        if (!DRY_RUN) db.spots.update(r.id, r.updates);
      }
      enrichFixed = enriched.length;
      log(`  Result: ${enriched.length} enriched`);
    }
  } catch (err) {
    warn(`Enrichment pass failed: ${err.message}`);
  }

  if (logicFixed > 0 || enrichFixed > 0) {
    log('Re-running logic checks on corrected data...');
    try {
      const allApproved = db.getDb().prepare(
        `SELECT s.id, s.title, s.type, s.time_start, s.time_end, s.days, s.venue_id
         FROM spots s WHERE s.status = 'approved' AND s.type IN ('Happy Hour', 'Brunch', 'Live Music')`,
      ).all();

      const venueRows = db.venues.getAll();
      const venueMap = new Map();
      for (const v of venueRows) venueMap.set(v.id, v);

      const results = runLogicChecks(allApproved, venueMap);
      fs.writeFileSync(checkPath, JSON.stringify({
        generatedAt: new Date().toISOString(),
        autoFixed: { logic: logicFixed, enrichment: enrichFixed },
        summary: {
          passed: results.passed.length,
          flagged: results.flagged.length,
          failed: results.failed.length,
        },
        flagged: results.flagged.map(({ spot, issues }) => ({
          id: spot.id, title: spot.title, type: spot.type,
          time_start: spot.time_start, time_end: spot.time_end, days: spot.days,
          issues,
        })),
        failed: results.failed.map(({ spot, issues }) => ({
          id: spot.id, title: spot.title, type: spot.type,
          time_start: spot.time_start, time_end: spot.time_end, days: spot.days,
          issues,
        })),
      }, null, 2), 'utf8');

      const remaining = findIncompleteSpots(db.getDb());
      const incompletePath = reportingPath('incomplete-spots.json');
      fs.writeFileSync(incompletePath, JSON.stringify({
        generatedAt: new Date().toISOString(),
        count: remaining.length,
        llmEnriched: enrichFixed,
        spots: remaining.map(r => ({
          id: r.id, title: r.title, type: r.type,
          time_start: r.time_start, time_end: r.time_end, days: r.days,
          promotionTime: r.promotion_time, sourceUrl: r.source_url || r.website,
        })),
      }, null, 2), 'utf8');

      log(`Post-fix: ${results.passed.length} passed, ${results.flagged.length} flagged, ${results.failed.length} failed`);
      log(`Post-fix: ${remaining.length} still incomplete`);
    } catch (err) {
      warn(`Post-fix logic check failed: ${err.message}`);
    }
  } else {
    log('No fixes applied — skipping re-check');
  }

  log(`=== auto-fix.js DONE (logic: ${logicFixed}, enrichment: ${enrichFixed}) ===`);
  closeLog();
  db.closeDb();
}

main().catch(err => {
  console.error('Fatal:', err);
  closeLog();
  process.exit(1);
});
