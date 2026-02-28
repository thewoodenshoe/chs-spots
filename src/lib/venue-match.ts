import { getDb } from './db';

function normalizeForMatch(name: string): string {
  return name.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(the|a|an|at|in|of|and|or|on)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameScore(spotName: string, venueName: string): number {
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

export function findMatchingVenue(title: string, lat: number, lng: number): {
  venueId: string; venueName: string; distance: number; score: number;
} | null {
  if (!title || lat == null || lng == null) return null;
  const db = getDb();
  const candidates = db.prepare(
    `SELECT id, name, lat, lng FROM venues
     WHERE ABS(lat - ?) < 0.005 AND ABS(lng - ?) < 0.005
     ORDER BY (lat-?)*(lat-?) + (lng-?)*(lng-?) LIMIT 5`
  ).all(lat, lng, lat, lat, lng, lng) as { id: string; name: string; lat: number; lng: number }[];

  let bestScore = 0;
  let bestMatch: { venueId: string; venueName: string; distance: number; score: number } | null = null;

  for (const venue of candidates) {
    const dlat = lat - venue.lat;
    const dlng = lng - venue.lng;
    const dist = Math.round(Math.sqrt(dlat * dlat + dlng * dlng) * 111000);
    if (dist > 50) continue;
    const score = nameScore(title, venue.name);
    if (score >= 0.5 && score > bestScore) {
      bestScore = score;
      bestMatch = { venueId: venue.id, venueName: venue.name, distance: dist, score };
    }
  }
  return bestMatch;
}
