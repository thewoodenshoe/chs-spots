/**
 * Google Places geocoding, photo downloads, area assignment,
 * deduplication, and Grok enrichment for discover-openings.
 */

const fs = require('fs');
const path = require('path');
const { fetchWithRetry, delay } = require('./discover-rss');
const { chat, getApiKey } = require('./llm-client');
const { loadPrompt } = require('./load-prompt');

const areasConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'config', 'areas.json'), 'utf8'),
);
const VALID_AREAS = areasConfig.map(a => a.name);

function getGoogleApiKey() {
  return process.env.GOOGLE_PLACES_SERVER_KEY
    || process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY
    || process.env.GOOGLE_PLACES_KEY;
}

const DAY_MAP = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function cleanWebsiteUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    [...u.searchParams.keys()].filter(k => k.startsWith('utm_')).forEach(k => u.searchParams.delete(k));
    return u.toString();
  } catch { return rawUrl; }
}

function formatGoogleHours(periods) {
  if (!Array.isArray(periods) || periods.length === 0) return null;
  const result = {};
  for (const p of periods) {
    if (!p.open) continue;
    const day = DAY_MAP[p.open.day];
    if (!day) continue;
    const open = p.open.time.replace(/(\d{2})(\d{2})/, '$1:$2');
    const close = p.close ? p.close.time.replace(/(\d{2})(\d{2})/, '$1:$2') : '23:59';
    result[day] = { open, close };
  }
  return Object.keys(result).length > 0 ? JSON.stringify(result) : null;
}

async function fetchPlaceDetails(placeId) {
  const apiKey = getGoogleApiKey();
  const fields = 'website,formatted_phone_number,opening_hours,photos';
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${fields}&key=${apiKey}`;
  try {
    const text = await fetchWithRetry(url);
    const data = JSON.parse(text);
    if (data.status === 'OK' && data.result) {
      const r = data.result;
      return {
        website: r.website ? cleanWebsiteUrl(r.website) : null,
        phone: r.formatted_phone_number || null,
        operatingHours: r.opening_hours?.periods
          ? formatGoogleHours(r.opening_hours.periods)
          : null,
        photoRef: r.photos?.[0]?.photo_reference || null,
      };
    }
  } catch { /* logged by caller */ }
  return null;
}

async function geocodeViaPlaces(name, address, log) {
  const apiKey = getGoogleApiKey();
  const searchTerm = address ? `${name} ${address}` : `"${name}" charleston sc`;
  const query = encodeURIComponent(searchTerm);
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&key=${apiKey}`;
  try {
    const text = await fetchWithRetry(url);
    const data = JSON.parse(text);
    if (data.status === 'OK' && data.results?.length > 0) {
      const r = data.results[0];
      const details = r.place_id ? await fetchPlaceDetails(r.place_id) : null;
      return {
        placeId: r.place_id,
        name: r.name,
        address: r.formatted_address,
        lat: r.geometry?.location?.lat,
        lng: r.geometry?.location?.lng,
        types: r.types || [],
        rating: r.rating || null,
        userRatingsTotal: r.user_ratings_total || 0,
        businessStatus: r.business_status || null,
        website: details?.website || null,
        phone: details?.phone || null,
        operatingHours: details?.operatingHours || null,
        photoRef: details?.photoRef || null,
      };
    }
  } catch (err) {
    log(`  Geocode error for "${name}": ${err.message}`);
  }
  return null;
}

async function downloadPhoto(photoRef, filename) {
  if (!photoRef) return null;
  const apiKey = getGoogleApiKey();
  try {
    const photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${photoRef}&key=${apiKey}`;
    const res = await fetch(photoUrl, { redirect: 'follow' });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const destDir = path.join(__dirname, '..', '..', 'public', 'spots');
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    const dest = path.join(destDir, `${filename}.jpg`);
    fs.writeFileSync(dest, buffer);
    return `/spots/${filename}.jpg`;
  } catch { return null; }
}

async function fetchPlacePhoto(placeId, spotId) {
  const apiKey = getGoogleApiKey();
  const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=photos&key=${apiKey}`;
  try {
    const text = await fetchWithRetry(detailUrl);
    const data = JSON.parse(text);
    if (data.status !== 'OK' || !data.result?.photos?.length) return null;
    return downloadPhoto(data.result.photos[0].photo_reference, spotId);
  } catch { return null; }
}

function findAreaFromCoordinates(lat, lng) {
  const matches = areasConfig.filter(area => {
    if (!area.bounds) return false;
    const { south, west, north, east } = area.bounds;
    return lat >= south && lat <= north && lng >= west && lng <= east;
  });
  if (matches.length === 0) return 'Downtown Charleston';
  if (matches.length === 1) return matches[0].name;
  let best = matches[0];
  let bestDist = Infinity;
  for (const area of matches) {
    const d = (lat - area.center.lat) ** 2 + (lng - area.center.lng) ** 2;
    if (d < bestDist) { bestDist = d; best = area; }
  }
  return best.name;
}

function findAreaFromAddress(address) {
  if (!address) return null;
  const lower = address.toLowerCase();
  for (const area of areasConfig) {
    if (lower.includes(area.name.toLowerCase())) return area.name;
  }
  const aliases = { 'folly beach': 'James Island', 'park circle': 'North Charleston', 'shem creek': 'Mount Pleasant' };
  for (const [key, val] of Object.entries(aliases)) {
    if (lower.includes(key)) return val;
  }
  const zipMatch = address.match(/\b(\d{5})\b/);
  if (zipMatch) {
    for (const area of areasConfig) {
      if (area.zipCodes && area.zipCodes.includes(zipMatch[1])) return area.name;
    }
  }
  return null;
}

async function enrichViaGrok(name, address, log) {
  if (!getApiKey()) return null;
  const areaList = VALID_AREAS.map(a => `"${a}"`).join(', ');
  const prompt = loadPrompt('llm-discover-places', {
    NAME: name,
    ADDRESS_NOTE: address ? ` (address: ${address})` : '',
    AREA_LIST: areaList,
  });
  const result = await chat({
    messages: [{ role: 'user', content: prompt }],
    model: 'grok-3-mini-fast',
    timeoutMs: 30000,
    log: () => {},
  });
  if (!result?.parsed) return null;
  if (result.parsed.area && VALID_AREAS.includes(result.parsed.area)) {
    log(`  Grok enriched "${name}" -> area: ${result.parsed.area}`);
    return result.parsed;
  }
  return null;
}

function fuzzyNameMatch(a, b) {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  return longer.includes(shorter) && shorter.length / longer.length > 0.5;
}

function isDuplicate(candidate, existingSpots, existingVenues) {
  const candidateTitle = candidate.placeName.toLowerCase().trim();

  for (const spot of existingSpots) {
    const spotTitle = (spot.title || '').toLowerCase().trim();
    if (fuzzyNameMatch(spotTitle, candidateTitle)) return true;
  }

  for (const venue of existingVenues) {
    const venueName = (venue.name || '').toLowerCase().trim();
    if (fuzzyNameMatch(venueName, candidateTitle)) return true;
  }

  if (candidate.placeId) {
    for (const venue of existingVenues) {
      if (venue.id === candidate.placeId) return true;
    }
    for (const spot of existingSpots) {
      if (spot.venue_id === candidate.placeId) return true;
    }
  }
  if (candidate.lat && candidate.lng) {
    for (const venue of existingVenues) {
      if (!venue.lat || !venue.lng) continue;
      const dist = Math.sqrt((venue.lat - candidate.lat) ** 2 + (venue.lng - candidate.lng) ** 2);
      if (dist < 0.0002) return true;
    }
  }
  return false;
}

module.exports = {
  VALID_AREAS,
  getGoogleApiKey,
  geocodeViaPlaces,
  fetchPlacePhoto,
  fetchPlaceDetails,
  downloadPhoto,
  findAreaFromCoordinates,
  findAreaFromAddress,
  enrichViaGrok,
  isDuplicate,
};
