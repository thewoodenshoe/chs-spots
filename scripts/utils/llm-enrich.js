/**
 * LLM-powered enrichment for spot/venue data.
 * Handles area assignment for spots/venues with 'Unknown' or NULL area.
 */

const { chat } = require('./llm-client');

/**
 * Use LLM to assign areas to venues/spots that are missing one.
 *
 * @param {Array<{id: string, name: string, lat?: number, lng?: number, address?: string}>} items
 * @param {string[]} validAreas
 * @param {string} apiKey
 * @param {Function} log
 * @returns {Array<{id: string, area: string}>}
 */
async function enrichAreas(items, validAreas, apiKey, log) {
  if (!items.length) return [];

  const prompt = items.map((item, i) => ({
    index: i, id: item.id, name: item.name,
    lat: item.lat || null, lng: item.lng || null, address: item.address || null,
  }));

  const result = await chat({
    messages: [
      {
        role: 'system',
        content: `You assign Charleston, SC venues to their correct neighborhood area.

Valid areas (use EXACTLY these names): ${validAreas.join(', ')}

Use coordinates, address, and venue name to determine the area.
If you cannot determine the area with reasonable confidence, use "Unknown".

Return ONLY a JSON array: [{"index": 0, "area": "Downtown Charleston"}, ...]`,
      },
      { role: 'user', content: JSON.stringify(prompt) },
    ],
    timeoutMs: 30000,
    apiKey,
    log,
  });

  if (!result?.parsed || !Array.isArray(result.parsed)) return [];

  const enriched = [];
  for (const r of result.parsed) {
    if (typeof r.index !== 'number' || r.index < 0 || r.index >= items.length) continue;
    if (!r.area || r.area === 'Unknown' || !validAreas.includes(r.area)) continue;
    enriched.push({ id: items[r.index].id, area: r.area });
  }
  return enriched;
}

module.exports = { enrichAreas };
