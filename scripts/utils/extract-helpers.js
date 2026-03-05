/**
 * Pure helper functions for extract-promotions.js.
 * Handles area filtering, hash computation, change detection,
 * LLM result normalization, and web search fallback.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { normalizeText } = require('./normalize');

function parseAreaFilter(areaFilterRaw) {
  if (!areaFilterRaw) return null;
  const areas = areaFilterRaw.split(',').map(a => a.trim().toLowerCase()).filter(Boolean);
  return areas.length > 0 ? new Set(areas) : null;
}

function hasEntriesMissingActivityType(goldData) {
  const promotions = goldData.promotions || goldData.happyHour || {};
  const entries = Array.isArray(promotions.entries) ? promotions.entries : [];
  return entries.some(entry => !entry.activityType || String(entry.activityType).trim() === '');
}

function computeContentHashes(pages) {
  const raw = pages.map(p => p.text || p.html || '').join('\n');
  const sourceHash = crypto.createHash('md5').update(raw).digest('hex');
  const normalized = pages.map(p => normalizeText(p.text || p.html || '')).join('\n');
  const normalizedSourceHash = crypto.createHash('md5').update(normalized).digest('hex');
  return { sourceHash, normalizedSourceHash };
}

/**
 * Determine whether a venue should be skipped based on hash comparison.
 * Returns { skip: true, reason } or { skip: false }.
 */
function shouldSkipVenue(existingGoldRow, hashes, reprocessMissingActivityType, venueName, venueId) {
  if (!existingGoldRow) return { skip: false };

  try {
    const promotions = typeof existingGoldRow.promotions === 'string'
      ? JSON.parse(existingGoldRow.promotions)
      : (existingGoldRow.promotions || {});
    const missingAT = hasEntriesMissingActivityType({ promotions });
    const shouldForce = reprocessMissingActivityType && missingAT;

    if (existingGoldRow.normalized_source_hash && existingGoldRow.normalized_source_hash === hashes.normalizedSourceHash) {
      if (!shouldForce) return { skip: true, reason: 'normalized hash match' };
      console.log(`  🔄 Reprocessing ${venueName} (${venueId}) despite hash match: missing activityType.`);
      return { skip: false };
    }

    if (!existingGoldRow.normalized_source_hash && existingGoldRow.source_hash === hashes.sourceHash) {
      if (!shouldForce) return { skip: true, reason: 'raw hash match' };
      console.log(`  🔄 Reprocessing ${venueName} (${venueId}) despite raw hash match: missing activityType.`);
      return { skip: false };
    }

    console.log(`  🔄 Content changed for ${venueName} (${venueId}) — sending to LLM`);
    return { skip: false };
  } catch (err) {
    console.warn(`Could not read existing gold data for ${venueId}, re-processing.`);
    return { skip: false };
  }
}

/**
 * Normalize LLM extraction result into the canonical format with entries array.
 */
function normalizeExtraction(result, venueData) {
  if (result.happyHour) return result.happyHour;

  if (result.found !== undefined) {
    if (result.found) {
      return {
        found: true,
        entries: [{
          days: result.days || 'Unknown',
          times: result.times || 'Unknown',
          specials: result.specials || [],
          source: result.source || venueData.pages[0]?.url || 'Unknown',
          confidence: result.confidence || 50,
          confidence_score_rationale: result.confidence < 80 ? 'Converted from old format' : undefined,
        }],
      };
    }
    return { found: false, reason: result.reason || 'No happy hour found' };
  }

  return result;
}

/**
 * Web search fallback: resolve missing times for entries that lack time_start/time_end.
 */
async function resolveEntryTimes(result, venueData, apiKey, webSearchFn, logFn) {
  if (!result.found || !result.entries || !Array.isArray(result.entries)) return;
  const needsTimes = result.entries.filter(e => e.confidence >= 60 && !e.time_start && !e.time_end);
  if (needsTimes.length === 0 || !apiKey) return;

  for (const entry of needsTimes) {
    try {
      const venueWebsite = venueData.pages?.[0]?.url || '';
      const searchPrompt = `For the venue "${venueData.venueName}" in Charleston, SC` +
        (venueWebsite ? ` (website: ${venueWebsite})` : '') +
        `: find their ${entry.activityType || 'Happy Hour'} schedule.` +
        (entry.label ? ` They call it "${entry.label}".` : '') +
        ` Return ONLY JSON: {"time_start":"HH:MM","time_end":"HH:MM","days":"1,2,3"}` +
        ` using 24h format and day numbers (0=Sun..6=Sat). null if truly unknown.`;
      const wsResult = await webSearchFn({
        prompt: searchPrompt,
        timeoutMs: 30000,
        apiKey,
        log: (m) => logFn(`    ${m}`),
      });
      if (wsResult?.parsed) {
        if (wsResult.parsed.time_start) entry.time_start = wsResult.parsed.time_start;
        if (wsResult.parsed.time_end) entry.time_end = wsResult.parsed.time_end;
        if (wsResult.parsed.days && !entry.days) entry.days = wsResult.parsed.days;
        logFn(`    🌐 Web search resolved times for ${venueData.venueName} [${entry.activityType}]: ${entry.time_start}-${entry.time_end}`);
      }
    } catch (wsErr) {
      logFn(`    ⚠️  Web search fallback failed for ${venueData.venueName}: ${wsErr.message}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }
}

/**
 * Append LLM candidate history for today's incremental run.
 */
function logCandidateHistory(venueFiles, venueMap, historyPath) {
  try {
    const logsDir = path.dirname(historyPath);
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

    const today = new Date().toISOString().split('T')[0];
    let logEntry = `date ${today}:\n`;
    for (const file of venueFiles) {
      const venueId = path.basename(file, '.json');
      const info = venueMap.get(venueId) || { name: 'Unknown', area: 'Unknown' };
      logEntry += `venueId: ${venueId}\nvenueName: ${info.name}\nvenueArea: ${info.area}\n\n`;
    }
    logEntry += '\n';
    fs.appendFileSync(historyPath, logEntry, 'utf8');
  } catch (error) {
    console.warn(`Warning: Could not write to LLM candidates history: ${error.message}`);
  }
}

module.exports = {
  parseAreaFilter,
  hasEntriesMissingActivityType,
  computeContentHashes,
  shouldSkipVenue,
  normalizeExtraction,
  resolveEntryTimes,
  logCandidateHistory,
};
