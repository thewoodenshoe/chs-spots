/**
 * Venue matching utility for linking spots to existing venues.
 *
 * Uses proximity (< 50m) + name similarity (token overlap >= 0.5)
 * to match a spot title + coordinates to the nearest venue.
 */

const db = require('./db');

const PROXIMITY_THRESHOLD_DEG = 0.0005; // ~55m
const PROXIMITY_SEARCH_DEG = 0.005;     // ~550m search radius for candidates
const SCORE_THRESHOLD = 0.5;

function normalizeForMatch(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(the|a|an|at|in|of|and|or|on)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameScore(spotName, venueName) {
  const a = normalizeForMatch(spotName);
  const b = normalizeForMatch(venueName);
  if (a === b) return 1.0;
  if (a.includes(b) || b.includes(a)) return 0.9;
  const tokA = new Set(a.split(' ').filter(t => t.length > 1));
  const tokB = new Set(b.split(' ').filter(t => t.length > 1));
  if (tokA.size === 0 || tokB.size === 0) return 0;
  let shared = 0;
  for (const t of tokA) if (tokB.has(t)) shared++;
  return shared / Math.min(tokA.size, tokB.size);
}

function distanceMeters(lat1, lng1, lat2, lng2) {
  const dlat = lat1 - lat2;
  const dlng = lng1 - lng2;
  return Math.round(Math.sqrt(dlat * dlat + dlng * dlng) * 111000);
}

/**
 * Find the best matching venue for a spot by proximity + name similarity.
 *
 * @param {string} title  - spot title
 * @param {number} lat    - spot latitude
 * @param {number} lng    - spot longitude
 * @returns {{ venueId: string, venueName: string, distance: number, score: number } | null}
 */
function findMatchingVenue(title, lat, lng) {
  if (!title || lat == null || lng == null) return null;

  const database = db.getDb();
  const candidates = database.prepare(
    `SELECT id, name, lat, lng FROM venues
     WHERE ABS(lat - ?) < ? AND ABS(lng - ?) < ?
     ORDER BY (lat-?)*(lat-?) + (lng-?)*(lng-?) LIMIT 5`
  ).all(lat, PROXIMITY_SEARCH_DEG, lng, PROXIMITY_SEARCH_DEG, lat, lat, lng, lng);

  let bestScore = 0;
  let bestMatch = null;

  for (const venue of candidates) {
    const dist = distanceMeters(lat, lng, venue.lat, venue.lng);
    if (dist > 50) continue;

    const score = nameScore(title, venue.name);
    if (score >= SCORE_THRESHOLD && score > bestScore) {
      bestScore = score;
      bestMatch = { venueId: venue.id, venueName: venue.name, distance: dist, score };
    }
  }

  return bestMatch;
}

module.exports = { findMatchingVenue, nameScore, normalizeForMatch, distanceMeters };
