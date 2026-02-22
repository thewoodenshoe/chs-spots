/**
 * Shared text normalization utility
 * 
 * Used by both trim-silver-html.js and delta-trimmed-files.js to ensure
 * consistent normalization for hash computation and delta comparison.
 * 
 * IMPORTANT: Any changes here affect both trimming AND delta detection.
 * Always update the tests in scripts/__tests__/normalize.test.js when modifying.
 */

/**
 * Normalize text by removing dynamic noise that causes false-positive deltas.
 * Strips timestamps, dates, tracking IDs, session tokens, copyright footers,
 * and collapses whitespace to produce stable hashes for comparison.
 */
function normalizeText(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }
  
  let normalized = text;
  
  // ── Remove binary / non-printable content ─────────────────────
  // If text looks like binary (high ratio of non-ASCII), treat as empty
  const nonPrintable = (normalized.match(/[^\x20-\x7E\n\r\t]/g) || []).length;
  if (normalized.length > 100 && nonPrintable / normalized.length > 0.3) {
    return '';
  }
  
  // ── Remove ISO timestamps ─────────────────────────────────────
  normalized = normalized.replace(/\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?)?/g, '');
  
  // ── Remove day-of-week + month-day patterns ───────────────────
  normalized = normalized.replace(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(st|nd|rd|th)?(,\s+\d{4})?\b/gi, '');
  
  // ── Remove common month-day patterns ──────────────────────────
  normalized = normalized.replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(st|nd|rd|th)?(,\s+\d{4})?\b/gi, '');
  
  // ── Canonicalize day-of-week hours tables ─────────────────────
  // Many venues show hours starting from the current day of the week.
  // e.g., "Fri 10AM-1AM Sat 10AM-1AM Sun 10AM-12AM Mon..."
  // Normalize by sorting these entries so the order is always Mon→Sun.
  const DOW_ORDER = { 'mon': 0, 'tue': 1, 'wed': 2, 'thu': 3, 'fri': 4, 'sat': 5, 'sun': 6,
                      'monday': 0, 'tuesday': 1, 'wednesday': 2, 'thursday': 3, 'friday': 4, 'saturday': 5, 'sunday': 6 };
  // Match blocks like "Mon 10AM-1AM" or "Monday: 10:00 AM - 1:00 AM" or "Mon 10AM–1AM"
  const hoursBlockRe = /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)[:\s]+\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)\s*[-–—to]+\s*\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)/gi;
  const hoursMatches = normalized.match(hoursBlockRe);
  if (hoursMatches && hoursMatches.length >= 3) {
    // Sort matched hours blocks by day of week (Mon=0 … Sun=6)
    const sorted = [...hoursMatches].sort((a, b) => {
      const dayA = a.match(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i);
      const dayB = b.match(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i);
      const orderA = dayA ? (DOW_ORDER[dayA[1].toLowerCase()] ?? 99) : 99;
      const orderB = dayB ? (DOW_ORDER[dayB[1].toLowerCase()] ?? 99) : 99;
      return orderA - orderB;
    });
    // Replace each original match with the sorted version
    let sortIdx = 0;
    normalized = normalized.replace(hoursBlockRe, () => sorted[sortIdx++] || '');
  }
  
  // ── Remove "Loading..." or placeholder phrases ────────────────
  normalized = normalized.replace(/Loading\s+product\s+options\.\.\.|Loading\.\.\./gi, '');
  
  // ── Remove analytics / GTM IDs ────────────────────────────────
  normalized = normalized.replace(/gtm-[a-z0-9]+/gi, '');
  normalized = normalized.replace(/UA-\d+-\d+/g, '');
  normalized = normalized.replace(/G-[A-Z0-9]+/g, '');
  
  // ── Remove tracking parameters everywhere (URLs and page titles) ─
  normalized = normalized.replace(/[?&](sid|fbclid|utm_[^=\s&]+|gclid|_ga|_gid|ref|source|tracking|campaign|matchtype|gad_source|gad_campaignid|gbraid|gclsrc|dclid|msclkid|li_fat_id|mc_[^=\s&]+|hsa_[^=\s&]+)=[^\s&"'\]]+/gi, '');
  normalized = normalized.replace(/\?(&|$)/g, '');
  
  // ── Remove store / location counts (e.g., "United States (5829)") ─
  normalized = normalized.replace(/\(\d{3,}\)/g, '');
  
  // ── Remove social media link text / icons ─────────────────────
  normalized = normalized.replace(/\b(Facebook|Instagram|Twitter|TikTok|YouTube|Pinterest|LinkedIn|Yelp|Google)\s+(page|icon|link)\b/gi, '');
  normalized = normalized.replace(/\bFollow us on\b.*?(?=\.|$)/gim, '');
  normalized = normalized.replace(/\bFind us on\b.*?(?=\.|$)/gim, '');
  
  // ── Remove cookie consent / reCAPTCHA / legal boilerplate ─────
  normalized = normalized.replace(/This site is protected by reCAPTCHA and the Google[^.]*\./gi, '');
  normalized = normalized.replace(/Privacy\s+Policy\s+Terms\s+of\s+Service/gi, '');
  normalized = normalized.replace(/We use cookies[^.]*\./gi, '');
  normalized = normalized.replace(/Accept\s+(All\s+)?Cookies/gi, '');
  normalized = normalized.replace(/Cookie\s+(Policy|Settings|Preferences)/gi, '');
  
  // ── Remove navigation / UI chrome text ────────────────────────
  normalized = normalized.replace(/\b(Skip to (main )?content|Return to Nav|Back to top|Close\s+(menu|modal|dialog)?)\b/gi, '');
  normalized = normalized.replace(/\bOrder\s+(Now|Online)\b/gi, '');
  normalized = normalized.replace(/\bNo description added\.?/gi, '');
  
  // ── Remove dynamic footers ────────────────────────────────────
  normalized = normalized.replace(/Copyright\s+©\s+\d{4}/gi, '');
  normalized = normalized.replace(/All\s+rights\s+reserved/gi, '');
  normalized = normalized.replace(/Powered\s+by\s+[^\s]+/gi, '');
  normalized = normalized.replace(/©\s+\d{4}\s+[^\n]+/gi, '');
  
  // ── Remove session IDs and tracking tokens ────────────────────
  normalized = normalized.replace(/\b(session|sid|token|tracking)[-_]?[a-z0-9]{8,}\b/gi, '');
  
  // ── Remove standalone years ───────────────────────────────────
  normalized = normalized.replace(/\b20[2-3]\d\b/g, '');
  
  // ── Collapse whitespace ───────────────────────────────────────
  normalized = normalized.replace(/[\s\n\r\t]+/g, ' ').trim();
  
  return normalized;
}

/**
 * Normalize URL by removing query parameters and tracking tokens
 */
function normalizeUrl(url) {
  if (!url || typeof url !== 'string') {
    return url || '';
  }
  try {
    const urlObj = new URL(url);
    const trackingParams = ['fbclid', 'gclid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'sid', '_ga', '_gid', 'ref', 'source'];
    trackingParams.forEach(param => {
      urlObj.searchParams.delete(param);
    });
    return urlObj.origin + urlObj.pathname;
  } catch (e) {
    return url.split('?')[0].split('#')[0];
  }
}

module.exports = { normalizeText, normalizeUrl };
