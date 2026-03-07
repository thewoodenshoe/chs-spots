'use strict';

const { webSearch, getApiKey } = require('./llm-client');
const { loadPrompt } = require('./load-prompt');

/**
 * Verify whether unmatched Live Music spots actually have a show today.
 * Batches them into a single LLM web search call.
 *
 * @param {Array} spots - [{ id, title, venue_id }]
 * @param {string} todayLabel - e.g. "Saturday, March 7, 2026"
 * @param {Function} log
 * @returns {{ confirmed: Array<{id,title,startTime,endTime,performer,description}>, stale: Array<{id,title}> }}
 */
async function verifyUnmatchedMusic(spots, todayLabel, log) {
  if (!getApiKey() || spots.length === 0) {
    return { confirmed: [], stale: spots.map(s => ({ id: s.id, title: s.title })) };
  }

  const venueList = spots.map(s => s.title).join(', ');
  const prompt = loadPrompt('llm-verify-stale-music', {
    TODAY_LABEL: todayLabel,
    VENUE_LIST: venueList,
  });

  log(`[verify-stale] Checking ${spots.length} unmatched venue(s) for today's shows`);

  let results;
  try {
    const response = await webSearch({ prompt, timeoutMs: 120000, log });
    if (!response?.parsed || !Array.isArray(response.parsed)) {
      log('[verify-stale] LLM returned no valid array — treating all as stale');
      return { confirmed: [], stale: spots.map(s => ({ id: s.id, title: s.title })) };
    }
    results = response.parsed;
  } catch (err) {
    log(`[verify-stale] LLM failed: ${err.message} — treating all as stale`);
    return { confirmed: [], stale: spots.map(s => ({ id: s.id, title: s.title })) };
  }

  const confirmed = [];
  const confirmedNames = new Set();

  for (const r of results) {
    if (!r.venue || !r.has_music || !r.start_time) continue;
    const normResult = r.venue.toLowerCase().trim();
    const match = spots.find(s => {
      const normSpot = s.title.toLowerCase().replace(/^the\s+/i, '').trim();
      const normR = normResult.replace(/^the\s+/i, '');
      return normR === normSpot || normR.includes(normSpot) || normSpot.includes(normR);
    });
    if (!match) continue;
    confirmedNames.add(match.id);
    confirmed.push({
      id: match.id, title: match.title,
      startTime: r.start_time, endTime: r.end_time || null,
      performer: r.performer || 'Live Music',
      description: r.description || '',
    });
  }

  const stale = spots
    .filter(s => !confirmedNames.has(s.id))
    .map(s => ({ id: s.id, title: s.title }));

  log(`[verify-stale] Result: ${confirmed.length} confirmed, ${stale.length} stale`);
  return { confirmed, stale };
}

module.exports = { verifyUnmatchedMusic };
