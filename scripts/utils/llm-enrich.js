/**
 * LLM-powered enrichment for spot/venue data.
 *
 * Currently handles:
 *   - Area assignment for spots/venues with 'Unknown' or NULL area
 */

const GROK_API_URL = 'https://api.x.ai/v1/chat/completions';
const GROK_MODEL = 'grok-4-fast-reasoning';
const REQUEST_TIMEOUT_MS = 30000;

async function fetchWithTimeout(url, options, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Use LLM to assign areas to venues/spots that are missing one.
 *
 * @param {Array<{id: string, name: string, lat?: number, lng?: number, address?: string}>} items
 * @param {string[]} validAreas - list of valid area names from the DB
 * @param {string} apiKey
 * @param {Function} log
 * @returns {Array<{id: string, area: string}>} — items with assigned areas
 */
async function enrichAreas(items, validAreas, apiKey, log) {
  if (!items.length) return [];

  const prompt = items.map((item, i) => ({
    index: i,
    id: item.id,
    name: item.name,
    lat: item.lat || null,
    lng: item.lng || null,
    address: item.address || null,
  }));

  try {
    const res = await fetchWithTimeout(GROK_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: GROK_MODEL,
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
        temperature: 0.1,
      }),
    });

    if (!res.ok) {
      log('  ⚠️  Area enrichment API error: ' + res.status);
      return [];
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) return [];

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const results = JSON.parse(jsonMatch[0]);
    const enriched = [];

    for (const r of results) {
      if (typeof r.index !== 'number' || r.index < 0 || r.index >= items.length) continue;
      if (!r.area || r.area === 'Unknown' || !validAreas.includes(r.area)) continue;
      enriched.push({ id: items[r.index].id, area: r.area });
    }

    return enriched;
  } catch (err) {
    log('  ⚠️  Area enrichment failed: ' + err.message);
    return [];
  }
}

module.exports = { enrichAreas };
