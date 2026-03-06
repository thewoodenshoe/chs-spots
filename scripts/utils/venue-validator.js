/**
 * Venue validation for the discovery pipeline — prevents established
 * venues from being classified as "Recently Opened" or "Coming Soon".
 *
 * Validation signals:
 *   1. Google Places review count (high reviews = established)
 *   2. Name quality (rejects generic/non-venue names)
 *   3. Grok LLM verification for borderline cases
 */

const { chat, getApiKey } = require('./llm-client');

const MAX_REVIEWS_RECENTLY_OPENED = 50;
const MAX_REVIEWS_COMING_SOON = 15;

const GENERIC_NAMES = new Set([
  'broad street', 'king street', 'market street', 'meeting street',
  'brunches', 'brunch', 'happy hour', 'dinner', 'lunch', 'breakfast',
  'downtown', 'charleston', 'north charleston', 'mount pleasant',
  'west ashley', 'james island', 'daniel island', 'folly beach',
  'restaurant', 'bar', 'cafe', 'coffee', 'ramen shop', 'pizza',
]);

function isValidVenueName(name) {
  if (!name || name.length < 3 || name.length > 80) return false;
  const lower = name.toLowerCase().trim();
  if (GENERIC_NAMES.has(lower)) return false;
  if (/^\d+$/.test(lower)) return false;
  if (/^(the |a )?(new |old )?(north |south |east |west )?\w+ (street|road|ave|blvd|drive|lane|way|hwy)$/i.test(name)) return false;
  const words = lower.split(/\s+/);
  if (words.length === 1 && lower.length < 4) return false;
  return true;
}

function checkReviewCount(userRatingsTotal, classification) {
  const threshold = classification === 'Recently Opened'
    ? MAX_REVIEWS_RECENTLY_OPENED
    : MAX_REVIEWS_COMING_SOON;
  if (userRatingsTotal > threshold) return 'established';
  if (userRatingsTotal > threshold * 0.5) return 'borderline';
  return 'plausible';
}

async function verifyViaGrok(candidates, log) {
  if (!getApiKey() || candidates.length === 0) return candidates;

  const nameList = candidates.map(c => `- "${c.placeName}" at ${c.address || 'Charleston, SC'}`).join('\n');
  const result = await chat({
    messages: [{
      role: 'user',
      content: `For each venue below, determine if it is a GENUINELY NEW establishment in Charleston, SC that opened within the last 6 months, OR if it is a well-established venue that has been operating for longer.

Venues:
${nameList}

Return ONLY a JSON array. Each object must have:
- "name": exact venue name
- "is_new": true if genuinely opened in last 6 months, false if established
- "confidence": 0-100 confidence score
- "reason": brief explanation (e.g. "opened March 2026" or "established since 2015")

Be STRICT. If unsure, mark is_new as false. Well-known Charleston institutions (Blind Tiger, Husk, FIG, Halls Chophouse, etc.) are NEVER new.`,
    }],
    model: 'grok-3-mini-fast',
    timeoutMs: 60000,
    log: () => {},
  });

  if (!result?.parsed || !Array.isArray(result.parsed)) {
    log('  Grok verification returned no valid results — rejecting all borderline candidates');
    return candidates.filter(c => c._reviewSignal === 'plausible');
  }

  const verdicts = new Map();
  for (const v of result.parsed) {
    if (v.name) verdicts.set(v.name.toLowerCase().trim(), v);
  }

  return candidates.filter(c => {
    const verdict = verdicts.get(c.placeName.toLowerCase().trim());
    if (!verdict) {
      log(`  No Grok verdict for "${c.placeName}" — ${c._reviewSignal === 'plausible' ? 'keeping' : 'rejecting'}`);
      return c._reviewSignal === 'plausible';
    }
    if (!verdict.is_new || verdict.confidence < 60) {
      log(`  REJECTED "${c.placeName}": ${verdict.reason} (confidence: ${verdict.confidence})`);
      return false;
    }
    log(`  VERIFIED "${c.placeName}": ${verdict.reason} (confidence: ${verdict.confidence})`);
    return true;
  });
}

async function validateCandidates(geocoded, _unused, log) {
  const validName = [];

  for (const c of geocoded) {
    if (!isValidVenueName(c.placeName)) {
      log(`  Name rejected: "${c.placeName}" (generic/invalid)`);
      continue;
    }
    const cls = c.classification || 'Recently Opened';
    const signal = checkReviewCount(c.userRatingsTotal || 0, cls);
    if (signal === 'established') {
      log(`  Review rejected: "${c.placeName}" (${c.userRatingsTotal} reviews — too many for ${cls})`);
      continue;
    }
    c._reviewSignal = signal;
    validName.push(c);
  }

  const borderline = validName.filter(c => c._reviewSignal === 'borderline');
  if (borderline.length > 0) {
    log(`  ${borderline.length} borderline candidates — verifying via Grok...`);
  }

  const needsVerification = validName.filter(c => c._reviewSignal !== 'plausible');
  const autoPass = validName.filter(c => c._reviewSignal === 'plausible');

  if (needsVerification.length > 0) {
    const verified = await verifyViaGrok(needsVerification, log);
    return [...autoPass, ...verified];
  }
  return autoPass;
}

module.exports = {
  isValidVenueName,
  checkReviewCount,
  verifyViaGrok,
  validateCandidates,
  MAX_REVIEWS_RECENTLY_OPENED,
  MAX_REVIEWS_COMING_SOON,
};
