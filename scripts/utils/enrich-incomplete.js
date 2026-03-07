/**
 * LLM enrichment for spots with incomplete required fields.
 *
 * After extraction + spot creation, checks every required column.
 * Any missing/suspicious field triggers a targeted Grok web search.
 * Spots still incomplete after LLM get flagged for human review.
 */

const { webSearch, getApiKey } = require('./llm-client');

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
  if (nums.length === 0) return null;
  return [...new Set(nums)].sort((a, b) => a - b).join(',');
}

function getMissingFields(spot) {
  const missing = [];
  if (!spot.time_start) missing.push('time_start');
  if (!spot.time_end) missing.push('time_end');
  if (!spot.days) missing.push('days');
  if (spot.type === 'Brunch' && spot.days === '0,1,2,3,4,5,6') missing.push('days');
  return [...new Set(missing)];
}

function buildPrompt(spot, missingFields) {
  const questions = [];
  if (missingFields.includes('time_start')) questions.push(`- What time does ${spot.type} start?`);
  if (missingFields.includes('time_end')) questions.push(`- What time does ${spot.type} end?`);
  if (missingFields.includes('days')) questions.push(`- What specific days of the week does ${spot.type} run?`);

  const websiteNote = spot.website ? ` (website: ${spot.website})` : '';
  return `For "${spot.venue_name || spot.title}" in Charleston, SC${websiteNote}:
Find their ${spot.type} schedule. I need:
${questions.join('\n')}

Search the web for the most current information.

Return ONLY a JSON object:
{"time_start":"HH:MM","time_end":"HH:MM","days":"0,1,2,3,4,5,6"}
Use 24h format (e.g. "16:00" for 4pm). Day numbers: 0=Sun,1=Mon,2=Tue,3=Wed,4=Thu,5=Fri,6=Sat.
Use null for any field you truly cannot determine.`;
}

/**
 * Find spots where any required field is missing or suspicious.
 */
function findIncompleteSpots(rawDb) {
  return rawDb.prepare(`
    SELECT s.id, s.title, s.type, s.time_start, s.time_end, s.days,
           s.promotion_time, s.source_url, v.name AS venue_name, v.address, v.website
    FROM spots s LEFT JOIN venues v ON v.id = s.venue_id
    WHERE s.status = 'approved'
      AND s.manual_override = 0
      AND s.type IN ('Happy Hour', 'Brunch')
      AND (
        s.time_start IS NULL
        OR s.time_end IS NULL
        OR s.days IS NULL
        OR (s.type = 'Brunch' AND s.days = '0,1,2,3,4,5,6')
      )
    ORDER BY s.id DESC
    LIMIT 50
  `).all();
}

/**
 * Enrich spots that have incomplete required fields via Grok web search.
 *
 * @returns {{ enriched: Array, stillIncomplete: Array }}
 */
async function enrichIncompleteSpots(spots, log = console.log) {
  const apiKey = getApiKey();
  if (!apiKey) { log('  ⚠️  No API key — skipping enrichment'); return { enriched: [], stillIncomplete: spots }; }

  const enriched = [];
  const stillIncomplete = [];

  for (const spot of spots) {
    const missing = getMissingFields(spot);
    if (missing.length === 0) continue;

    log(`  🔍 ${spot.title} [${spot.type}] — missing: ${missing.join(', ')}`);
    try {
      const result = await webSearch({ prompt: buildPrompt(spot, missing), timeoutMs: 45000, log: () => {} });
      if (!result?.parsed) { stillIncomplete.push({ ...spot, missingFields: missing }); continue; }

      const updates = {};
      let resolved = false;

      if (missing.includes('time_start') && result.parsed.time_start) {
        const v = validateTime(result.parsed.time_start);
        if (v) { updates.time_start = v; resolved = true; }
      }
      if (missing.includes('time_end') && result.parsed.time_end) {
        const v = validateTime(result.parsed.time_end);
        if (v) { updates.time_end = v; resolved = true; }
      }
      if (missing.includes('days') && result.parsed.days) {
        const v = validateDays(String(result.parsed.days));
        if (v) { updates.days = v; resolved = true; }
      }

      if (resolved) {
        enriched.push({ id: spot.id, title: spot.title, type: spot.type, updates });
        log(`  ✅ Enriched: ${spot.title} → ${JSON.stringify(updates)}`);
      } else {
        stillIncomplete.push({ ...spot, missingFields: missing });
        log(`  ❌ Still incomplete: ${spot.title} — LLM couldn't resolve ${missing.join(', ')}`);
      }
    } catch (err) {
      stillIncomplete.push({ ...spot, missingFields: missing });
      log(`  ⚠️  Enrichment failed for ${spot.title}: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  return { enriched, stillIncomplete };
}

module.exports = { findIncompleteSpots, enrichIncompleteSpots, getMissingFields };
