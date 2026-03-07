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
  logCandidateHistory,
};
