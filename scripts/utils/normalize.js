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
  
  // Remove ISO timestamps (e.g., "2026-01-20T15:34:58.724Z" or "2026-01-20")
  normalized = normalized.replace(/\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?)?/g, '');
  
  // Remove day-of-week + month-day patterns (e.g., "Wednesday January 28th", "Thursday January 29th")
  normalized = normalized.replace(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(st|nd|rd|th)?(,\s+\d{4})?\b/gi, '');
  
  // Remove common month-day patterns (e.g., "Jan 20", "Jan 20, 2026", "January 20, 2026", "January 28th")
  normalized = normalized.replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(st|nd|rd|th)?(,\s+\d{4})?\b/gi, '');
  
  // Remove "Loading..." or placeholder phrases
  normalized = normalized.replace(/Loading\s+product\s+options\.\.\.|Loading\.\.\./gi, '');
  
  // Remove Google Analytics / GTM IDs (e.g., "gtm-abc123", "UA-123456-7", "G-[A-Z0-9]+")
  normalized = normalized.replace(/gtm-[a-z0-9]+/gi, '');
  normalized = normalized.replace(/UA-\d+-\d+/g, '');
  normalized = normalized.replace(/G-[A-Z0-9]+/g, '');
  
  // Remove common tracking parameters in URLs (even if they appear in text)
  normalized = normalized.replace(/[?&](sid|fbclid|utm_[^=\s&]+|gclid|_ga|_gid|ref|source|tracking|campaign)=[^\s&"']+/gi, '');
  
  // Remove dynamic footers: "Copyright © [year]", "All rights reserved", "Powered by ..."
  normalized = normalized.replace(/Copyright\s+©\s+\d{4}/gi, '');
  normalized = normalized.replace(/All\s+rights\s+reserved/gi, '');
  normalized = normalized.replace(/Powered\s+by\s+[^\s]+/gi, '');
  normalized = normalized.replace(/©\s+\d{4}\s+[^\n]+/gi, '');
  
  // Remove session IDs and tracking tokens (common patterns)
  normalized = normalized.replace(/\b(session|sid|token|tracking)[-_]?[a-z0-9]{8,}\b/gi, '');
  
  // Remove standalone year numbers that change annually (e.g., "2026", "2025")
  // Only match 4-digit years that appear as standalone tokens (not part of phone numbers etc.)
  normalized = normalized.replace(/\b20[2-3]\d\b/g, '');
  
  // More aggressive whitespace/newline collapse
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
