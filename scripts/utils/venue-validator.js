/**
 * Venue validation for the discovery pipeline.
 *
 * Philosophy: REJECT BY DEFAULT. A venue only gets listed as
 * "Recently Opened" or "Coming Soon" if we have HIGH confidence
 * it is genuinely new. False positives destroy credibility.
 *
 * Every candidate must pass ALL gates:
 *   1. Name quality (no generic/vague names)
 *   2. Google Places review count (established venues auto-rejected)
 *   3. Grok LLM verification with minimum confidence 70
 */

const { webSearch, getApiKey } = require('./llm-client');
const { loadPrompt } = require('./load-prompt');

const MAX_REVIEWS_RECENTLY_OPENED = 30;
const MAX_REVIEWS_COMING_SOON = 10;
const MIN_GROK_CONFIDENCE = 70;

const GENERIC_NAMES = new Set([
  'broad street', 'king street', 'market street', 'meeting street',
  'brunches', 'brunch', 'happy hour', 'dinner', 'lunch', 'breakfast',
  'downtown', 'charleston', 'north charleston', 'mount pleasant',
  'west ashley', 'james island', 'daniel island', 'folly beach',
  'restaurant', 'bar', 'cafe', 'coffee', 'ramen shop', 'pizza',
  'food truck', 'food hall', 'hotel', 'inn', 'resort',
]);

function isValidVenueName(name) {
  if (!name || name.length < 3 || name.length > 80) return false;
  const lower = name.toLowerCase().trim();
  if (GENERIC_NAMES.has(lower)) return false;
  if (/^\d+$/.test(lower)) return false;
  if (/^(the |a )?(new |old )?(north |south |east |west )?\w+ (street|road|ave|blvd|drive|lane|way|hwy)$/i.test(name)) return false;
  const words = lower.split(/\s+/);
  if (words.length === 1 && lower.length < 4) return false;
  if (/\b(ramen shop|pizza place|burger joint|taco stand)\b/i.test(name)) return false;
  return true;
}

function checkReviewCount(userRatingsTotal, classification) {
  const threshold = classification === 'Recently Opened'
    ? MAX_REVIEWS_RECENTLY_OPENED
    : MAX_REVIEWS_COMING_SOON;
  return userRatingsTotal > threshold ? 'established' : 'passable';
}

async function verifyViaGrok(candidates, log) {
  if (!getApiKey() || candidates.length === 0) {
    log('  No Grok API key — rejecting all candidates (cannot verify)');
    return [];
  }

  const nameList = candidates.map(c =>
    `- "${c.placeName}" at ${c.address || 'Charleston, SC'} (${c.userRatingsTotal || 0} Google reviews)`,
  ).join('\n');

  const prompt = loadPrompt('llm-validate-openings', { NAME_LIST: nameList });
  const result = await webSearch({
    prompt,
    timeoutMs: 120000,
    log: () => {},
  });

  if (!result?.parsed || !Array.isArray(result.parsed)) {
    log('  Grok verification failed — rejecting all candidates');
    return [];
  }

  const verdicts = new Map();
  for (const v of result.parsed) {
    if (v.name) verdicts.set(v.name.toLowerCase().trim(), v);
  }

  return candidates.filter(c => {
    const verdict = verdicts.get(c.placeName.toLowerCase().trim());
    if (!verdict) {
      log(`  REJECTED "${c.placeName}": no Grok verdict (default reject)`);
      return false;
    }
    if (!verdict.is_new) {
      log(`  REJECTED "${c.placeName}": ${verdict.reason}`);
      return false;
    }
    if (verdict.confidence < MIN_GROK_CONFIDENCE) {
      log(`  REJECTED "${c.placeName}": confidence ${verdict.confidence} < ${MIN_GROK_CONFIDENCE} (${verdict.reason})`);
      return false;
    }
    log(`  VERIFIED "${c.placeName}": ${verdict.reason} (confidence: ${verdict.confidence})`);
    c.grokVerifiedDate = verdict.opened_date || null;
    return true;
  });
}

async function validateCandidates(geocoded, _unused, log) {
  const passedFilters = [];

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
    passedFilters.push(c);
  }

  if (passedFilters.length === 0) return [];

  log(`  ${passedFilters.length} candidates passed filters — ALL require Grok verification...`);
  return verifyViaGrok(passedFilters, log);
}

module.exports = {
  isValidVenueName,
  checkReviewCount,
  verifyViaGrok,
  validateCandidates,
  MIN_GROK_CONFIDENCE,
  MAX_REVIEWS_RECENTLY_OPENED,
  MAX_REVIEWS_COMING_SOON,
};
