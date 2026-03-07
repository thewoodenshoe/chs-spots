'use strict';

const { webSearch, getApiKey } = require('../../utils/llm-client');
const { loadPrompt } = require('../../utils/load-prompt');

/**
 * Post-upsert quality audit. Scans approved spots for anomalies,
 * attempts rule-based fixes first, then targeted LLM for remaining issues.
 *
 * @param {Array} approvedIds - spot IDs just written to DB
 * @param {string} type - activity type
 * @param {Object} deps - { db, log }
 * @returns {{ fixed: number, removed: number, issues: Array }}
 */
async function runPreReportCheck(approvedIds, type, { db, log }) {
  const d = db.getDb();
  let fixed = 0;
  let removed = 0;
  const issues = [];

  for (const spotId of approvedIds) {
    const spot = db.spots.getById(spotId);
    if (!spot) continue;

    const venue = spot.venue_id ? d.prepare('SELECT * FROM venues WHERE id = ?').get(spot.venue_id) : null;

    if (!venue) {
      log(`[pre-report] REMOVE #${spotId} ${spot.title}: no venue found`);
      db.spots.update(spotId, { status: 'rejected' });
      removed++;
      issues.push({ id: spotId, title: spot.title, issue: 'No venue in DB', action: 'removed' });
      continue;
    }

    if (!venue.lat || !venue.lng) {
      issues.push({ id: spotId, title: spot.title, issue: 'Venue missing coordinates', action: 'flagged' });
    }

    if (!venue.website || venue.website === 'n/a') {
      issues.push({ id: spotId, title: spot.title, issue: 'Venue missing website', action: 'flagged' });
    }

    if (!spot.time_start || !spot.time_end) {
      if (!getApiKey()) {
        log(`[pre-report] REMOVE #${spotId} ${spot.title}: missing times, no LLM available`);
        db.spots.update(spotId, { status: 'rejected' });
        removed++;
        issues.push({ id: spotId, title: spot.title, issue: 'Missing times', action: 'removed' });
        continue;
      }

      log(`[pre-report] LLM fix attempt: ${spot.title} — missing times`);
      try {
        const prompt = loadPrompt('shared/find-times', {
          VENUE_NAME: spot.title, ACTIVITY_TYPE: type,
          WEBSITE: venue.website || 'unknown',
        });
        const result = await webSearch({ prompt, timeoutMs: 60000, log });
        if (result?.parsed?.time_start && result?.parsed?.time_end) {
          db.spots.update(spotId, {
            time_start: result.parsed.time_start,
            time_end: result.parsed.time_end,
          });
          fixed++;
          log(`[pre-report] FIXED: ${spot.title} → ${result.parsed.time_start}-${result.parsed.time_end}`);
        } else {
          db.spots.update(spotId, { status: 'rejected' });
          removed++;
          issues.push({ id: spotId, title: spot.title, issue: 'Missing times after LLM', action: 'removed' });
        }
      } catch (err) {
        log(`[pre-report] LLM failed for ${spot.title}: ${err.message}`);
        db.spots.update(spotId, { status: 'rejected' });
        removed++;
        issues.push({ id: spotId, title: spot.title, issue: `LLM error: ${err.message}`, action: 'removed' });
      }
    }
  }

  log(`[pre-report] Done: ${fixed} fixed, ${removed} removed, ${issues.length} issue(s)`);
  return { fixed, removed, issues };
}

module.exports = { runPreReportCheck };
