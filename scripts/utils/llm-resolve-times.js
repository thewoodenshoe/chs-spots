/**
 * LLM fallback for resolving missing times on spots.
 *
 * Two-tier approach:
 *   Tier 1 (chat): raw time string exists but regex couldn't parse it → ask LLM to parse.
 *   Tier 2 (web search): no time string at all → ask LLM to look up the venue's times online.
 *
 * Returns an array of { id, timeStart, timeEnd, days, specificDate, resolved, tier }.
 */

const { chat, webSearch, getApiKey } = require('./llm-client');

const PARSE_SYSTEM_PROMPT = `You parse restaurant/bar promotion time strings into structured data.
Return ONLY a JSON object with these fields:
- time_start: HH:MM in 24-hour format (e.g. "16:00" for 4pm), or null
- time_end: HH:MM in 24-hour format (e.g. "19:00" for 7pm), or null
- days: comma-separated day numbers where 0=Sun,1=Mon,2=Tue,3=Wed,4=Thu,5=Fri,6=Sat (e.g. "1,2,3,4,5" for Mon-Fri), or null
- specific_date: ISO date (YYYY-MM-DD) if it's a one-time event, otherwise null

Examples:
  "4pm-7pm • Mon-Fri" → {"time_start":"16:00","time_end":"19:00","days":"1,2,3,4,5","specific_date":null}
  "Daily 3-6pm" → {"time_start":"15:00","time_end":"18:00","days":"0,1,2,3,4,5,6","specific_date":null}
  "Fri/Sat" → {"time_start":null,"time_end":null,"days":"5,6","specific_date":null}
  "all day" → {"time_start":"00:00","time_end":"23:59","days":null,"specific_date":null}

Return ONLY valid JSON. No explanation.`;

function buildWebSearchPrompt(venueName, address, activityType, sourceUrl) {
  const urlNote = sourceUrl ? `Their website is ${sourceUrl}.` : '';
  return `I need the ${activityType} schedule for "${venueName}" in Charleston, SC.
${urlNote}
Find their ${activityType} start time, end time, and which days it runs.

Return ONLY a JSON object:
{
  "time_start": "HH:MM",  // 24-hour format, e.g. "16:00" for 4pm. null if unknown.
  "time_end": "HH:MM",    // 24-hour format, e.g. "19:00" for 7pm. null if unknown.
  "days": "1,2,3,4,5",    // comma-separated day numbers: 0=Sun,1=Mon,2=Tue,3=Wed,4=Thu,5=Fri,6=Sat. null if unknown.
  "specific_date": null    // ISO date if one-time event, otherwise null
}

If you truly cannot find any time information, return all nulls.`;
}

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

function validateDate(d) {
  if (!d || typeof d !== 'string') return null;
  const m = d.match(/^\d{4}-\d{2}-\d{2}$/);
  return m ? d : null;
}

/**
 * Resolve missing times for a batch of spots using LLM.
 *
 * @param {Array} spots - [{ id, title, type, promotionTime, sourceUrl, address }]
 * @param {string} apiKey
 * @param {Function} log
 * @returns {Promise<{ resolved: Array, unresolved: Array }>}
 */
async function resolveMissingTimes(spots, apiKey, log = console.log) {
  const resolved = [];
  const unresolved = [];

  for (const spot of spots) {
    const rawTime = spot.promotionTime;
    let result = null;
    let tier = null;

    // Tier 1: raw time string exists but couldn't be regex-parsed
    if (rawTime && rawTime.trim()) {
      tier = 1;
      log(`  🔍 Tier 1 (parse): ${spot.title} [${spot.type}] — "${rawTime}"`);
      const chatResult = await chat({
        messages: [
          { role: 'system', content: PARSE_SYSTEM_PROMPT },
          { role: 'user', content: rawTime },
        ],
        temperature: 0,
        timeoutMs: 15000,
        apiKey,
        log,
      });
      if (chatResult?.parsed) result = chatResult.parsed;
    }

    // Tier 2: no raw time string, or Tier 1 failed → web search
    if (!result || (!result.time_start && !result.time_end && !result.days)) {
      tier = 2;
      log(`  🌐 Tier 2 (web search): ${spot.title} [${spot.type}]`);
      const prompt = buildWebSearchPrompt(
        spot.title,
        spot.address || 'Charleston, SC',
        spot.type,
        spot.sourceUrl,
      );
      const searchResult = await webSearch({ prompt, timeoutMs: 30000, apiKey, log });
      if (searchResult?.parsed) result = searchResult.parsed;
    }

    if (result) {
      const timeStart = validateTime(result.time_start);
      const timeEnd = validateTime(result.time_end);
      const days = validateDays(result.days);
      const specificDate = validateDate(result.specific_date);

      if (timeStart || timeEnd || days) {
        resolved.push({
          id: spot.id,
          title: spot.title,
          type: spot.type,
          timeStart,
          timeEnd,
          days,
          specificDate,
          tier,
        });
        log(`  ✅ Resolved: ${spot.title} → ${timeStart || '?'}-${timeEnd || '?'}, days=${days || '?'} (tier ${tier})`);
        continue;
      }
    }

    unresolved.push({
      id: spot.id,
      title: spot.title,
      type: spot.type,
      area: spot.area,
      promotionTime: rawTime || null,
      sourceUrl: spot.sourceUrl || null,
    });
    log(`  ❌ Unresolved: ${spot.title} [${spot.type}] — couldn't figure out times`);
  }

  return { resolved, unresolved };
}

module.exports = { resolveMissingTimes };
