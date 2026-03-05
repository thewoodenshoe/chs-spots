/**
 * Structured time-field extraction and formatting for spot entries.
 * Handles both new LLM format (time_start/time_end/days as numbers)
 * and legacy format (times/days as human-readable strings).
 */

const { parseTimeRange, parseDayPart } = require('./time-parse');

function normalizeField(val) {
  if (!val || typeof val !== 'string') return null;
  const lower = val.trim().toLowerCase();
  if (lower === 'not specified' || lower === 'unknown' || lower === 'n/a' || lower === '') return null;
  return val.trim();
}

/**
 * Extract structured time fields from a single entry.
 * Prefers new structured fields, falls back to parsing legacy strings.
 */
function extractTimeFields(entry) {
  let timeStart = null;
  let timeEnd = null;
  let days = null;

  if (entry.time_start && /^\d{1,2}:\d{2}$/.test(entry.time_start)) {
    timeStart = entry.time_start.padStart(5, '0');
  }
  if (entry.time_end && /^\d{1,2}:\d{2}$/.test(entry.time_end)) {
    timeEnd = entry.time_end.padStart(5, '0');
  }

  if (!timeStart && !timeEnd) {
    const times = normalizeField(entry.times);
    if (times) {
      if (/all\s*day/i.test(times)) {
        timeStart = '00:00'; timeEnd = '23:59';
      } else {
        const parsed = parseTimeRange(times);
        timeStart = parsed.timeStart;
        timeEnd = parsed.timeEnd;
      }
    }
  }

  const rawDays = normalizeField(entry.days);
  if (rawDays) {
    if (/^[\d,\s]+$/.test(rawDays)) {
      const nums = rawDays.split(',').map(s => parseInt(s.trim())).filter(n => n >= 0 && n <= 6);
      if (nums.length > 0) days = [...new Set(nums)].sort((a, b) => a - b).join(',');
    }
    if (!days) {
      const dayNums = parseDayPart(rawDays);
      if (dayNums) days = dayNums.sort((a, b) => a - b).join(',');
    }
  }

  return { timeStart, timeEnd, days };
}

function buildPromotionTimeLabel(entry, timeStart, timeEnd, days) {
  const times = normalizeField(entry.times);
  const entryDays = normalizeField(entry.days);
  const timePart = times || (timeStart && timeEnd ? `${timeStart}-${timeEnd}` : null);
  const dayPart = entryDays || (days ? days : null);

  if (timePart && dayPart) return `${timePart} • ${dayPart}`;
  if (timePart) return timePart;
  if (dayPart) return dayPart;
  return null;
}

/**
 * Build time/specials/source fields from a group of entries.
 */
function buildSpotFields(entries) {
  let promotionTime = null;
  let promotionList = [];
  let sourceUrl = null;
  let timeStart = null;
  let timeEnd = null;
  let days = null;

  if (entries.length === 1) {
    const entry = entries[0];
    const extracted = extractTimeFields(entry);
    timeStart = extracted.timeStart;
    timeEnd = extracted.timeEnd;
    days = extracted.days;
    promotionTime = buildPromotionTimeLabel(entry, timeStart, timeEnd, days);
    promotionList = entry.specials || [];
    sourceUrl = entry.source || null;
  } else if (entries.length > 1) {
    const timeParts = [];
    const allSpecials = [];
    const sources = [];

    const firstExtracted = extractTimeFields(entries[0]);
    timeStart = firstExtracted.timeStart;
    timeEnd = firstExtracted.timeEnd;
    days = firstExtracted.days;

    for (const entry of entries) {
      const ext = extractTimeFields(entry);
      const label = entry.label ? `${entry.label}: ` : '';
      const ptLabel = buildPromotionTimeLabel(entry, ext.timeStart, ext.timeEnd, ext.days);
      if (ptLabel) {
        const timeStr = `${label}${ptLabel}`;
        if (!timeParts.includes(timeStr)) timeParts.push(timeStr);
      }
      if (entry.specials && Array.isArray(entry.specials)) {
        const prefix = entries.length > 1 && entry.label ? `[${entry.label}] ` : '';
        allSpecials.push(...entry.specials.map(s => `${prefix}${s}`));
      }
      if (entry.source && !sources.includes(entry.source)) sources.push(entry.source);
    }

    promotionTime = timeParts.length > 0 ? timeParts.join(', ') : null;
    promotionList = allSpecials;
    sourceUrl = sources.length > 0 ? sources[0] : null;
  }

  return { promotionTime, promotionList, sourceUrl, timeStart, timeEnd, days };
}

module.exports = { normalizeField, extractTimeFields, buildPromotionTimeLabel, buildSpotFields };
