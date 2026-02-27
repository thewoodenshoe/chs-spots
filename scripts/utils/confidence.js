/**
 * Post-extraction confidence validation for spots.
 *
 * Applies heuristic rules to LLM-assigned confidence scores.
 * Returns an adjusted confidence + flags array explaining adjustments.
 *
 * Design: pure functions, no side effects, fully testable.
 */

const ALCOHOL_KEYWORDS = /\b(beer|wine|cocktail|drink|pint|well|margarita|mimosa|sangria|spritz|mule|martini|bourbon|whiskey|vodka|tequila|rum|gin|draft|tap|pour|seltzer|highball|negroni|aperol|bellini|prosecco|champagne|cider|ale|lager|ipa|stout|pilsner)\b/i;

const NON_HH_LABEL_KEYWORDS = /\b(market|mercato|cafe|café|coffee|bakery|breakfast|pastry|pastries|deli|lunch combo|lunch special)\b/i;

const EFFECTIVE_THRESHOLD = 50;
const FLAG_THRESHOLD = 70;

function parseStartHour(timeStr) {
  if (!timeStr) return null;
  const m = timeStr.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const ampm = m[3].toLowerCase();
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  return h;
}

function parseEndHour(timeStr) {
  if (!timeStr) return null;
  const parts = timeStr.match(/[-–—to]+\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (!parts) return null;
  let h = parseInt(parts[1], 10);
  const ampm = parts[3].toLowerCase();
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  return h;
}

function timeSpanHours(timeStr) {
  const start = parseStartHour(timeStr);
  const end = parseEndHour(timeStr);
  if (start === null || end === null) return null;
  let span = end - start;
  if (span < 0) span += 24;
  return span;
}

/**
 * Validate a single gold extraction entry and return adjusted confidence.
 *
 * @param {object} entry — { activityType, label, days, times, specials, confidence }
 * @returns {{ confidence: number, flags: string[], action: 'keep'|'flag'|'reject' }}
 */
function validateEntry(entry) {
  const flags = [];
  let score = entry.confidence ?? 75;
  const type = entry.activityType || 'Happy Hour';

  if (type === 'Happy Hour') {
    const startHour = parseStartHour(entry.times);

    // Rule 1: Happy hours starting before 11AM are almost certainly wrong
    if (startHour !== null && startHour < 11) {
      flags.push(`starts-before-11am (${entry.times})`);
      score -= 40;
    }

    // Rule 2: No alcohol keywords in specials → probably not a drink deal
    const specialsText = (entry.specials || []).join(' ');
    const labelText = entry.label || '';
    const allText = `${labelText} ${specialsText}`;
    if (!ALCOHOL_KEYWORDS.test(allText)) {
      flags.push('no-alcohol-keywords');
      score -= 20;
    }

    // Rule 3: Label contains market/cafe/breakfast keywords
    if (NON_HH_LABEL_KEYWORDS.test(labelText)) {
      flags.push(`non-hh-label: "${labelText}"`);
      score -= 30;
    }

    // Rule 4: Time span > 8 hours looks like regular hours, not a promotion
    const span = timeSpanHours(entry.times);
    if (span !== null && span >= 8) {
      flags.push(`long-span: ${span}h`);
      score -= 15;
    }

    // Rule 5: "Close" as end time with no specials = just bar hours
    if (entry.times && /close/i.test(entry.times) && (!entry.specials || entry.specials.length === 0)) {
      flags.push('bar-hours-only (no specials)');
      score -= 25;
    }

    // Rule 6: Vague specials like "Weekly drink special" without prices
    if (entry.specials && entry.specials.length > 0) {
      const hasPrice = entry.specials.some(s => /\$\d/.test(s));
      const allVague = entry.specials.every(s =>
        /^(weekly|daily|rotating)\s+(drink|food|menu)\s+special$/i.test(s.trim())
      );
      if (allVague && !hasPrice) {
        flags.push('vague-specials-no-prices');
        score -= 15;
      }
    }
  }

  if (type === 'Brunch') {
    // Brunch heuristics: less strict, but flag if no brunch-related content
    const specialsText = (entry.specials || []).join(' ');
    const labelText = entry.label || '';
    const allText = `${labelText} ${specialsText} ${entry.days || ''}`;

    if (!/brunch/i.test(allText) && !/\b(mimosa|bloody mary|bellini|benedic)/i.test(allText)) {
      flags.push('no-brunch-keywords');
      score -= 10;
    }
  }

  score = Math.max(0, Math.min(100, score));

  let action = 'keep';
  if (score < EFFECTIVE_THRESHOLD) action = 'reject';
  else if (score < FLAG_THRESHOLD) action = 'flag';

  return { confidence: score, flags, action };
}

/**
 * Validate all entries in a gold extraction result.
 * Returns { kept, flagged, rejected } arrays.
 */
function validateGoldEntries(entries) {
  const kept = [];
  const flagged = [];
  const rejected = [];

  for (const entry of entries) {
    const result = validateEntry(entry);
    const enriched = { ...entry, effectiveConfidence: result.confidence, confidenceFlags: result.flags };

    if (result.action === 'reject') {
      rejected.push(enriched);
    } else if (result.action === 'flag') {
      flagged.push(enriched);
      kept.push(enriched);
    } else {
      kept.push(enriched);
    }
  }

  return { kept, flagged, rejected };
}

module.exports = { validateEntry, validateGoldEntries, EFFECTIVE_THRESHOLD, FLAG_THRESHOLD };
