'use strict';

const { getPlacesApiKey, geocodePlace, downloadPlacePhoto } = require('./google-places');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function normalizeForLookup(name) {
  return (name || '')
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/^the\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Find or create a venue by name. Geocodes + downloads photo for new venues.
 * Returns { venue: { id, name, lat, lng, ... }, created: boolean } or null if
 * the venue cannot be resolved (geocode failure, no Places API key).
 */
async function ensureVenue({ name, address, website, area }, { db, log }) {
  const allVenues = db.venues.getAll();
  const normName = normalizeForLookup(name);

  for (const v of allVenues) {
    const normV = normalizeForLookup(v.name);
    if (normV === normName || normV.includes(normName) || normName.includes(normV)) {
      log(`  REUSE venue: ${v.name} (${v.id})`);
      return { venue: v, created: false };
    }
  }

  if (!getPlacesApiKey() || process.env.GOOGLE_PLACES_ENABLED !== 'true') {
    log(`  SKIP (no geocoding): ${name}`);
    return null;
  }

  const geo = await geocodePlace(name, address || 'Charleston SC');
  if (!geo) {
    log(`  SKIP (geocode failed): ${name}`);
    return null;
  }

  log(`  GEOCODED: ${name} → ${geo.lat}, ${geo.lng}`);
  await sleep(250);

  const venueId = geo.placeId || `ven_${normalizeForLookup(name).replace(/\s+/g, '_').slice(0, 30)}`;
  const venueArea = area || 'Downtown Charleston';

  db.venues.upsert({
    id: venueId, name, address: address || null,
    lat: geo.lat, lng: geo.lng, area: venueArea, website: website || null,
  });

  let photoUrl = null;
  if (geo.placeId) {
    try {
      photoUrl = await downloadPlacePhoto(geo.placeId, venueId, log);
      if (photoUrl) db.venues.updatePhotoUrl(venueId, photoUrl);
      await sleep(300);
    } catch (e) {
      log(`  Photo failed for ${name}: ${e.message}`);
    }
  }

  const venue = {
    id: venueId, name, address: address || null,
    lat: geo.lat, lng: geo.lng, area: venueArea,
    website: website || null, photo_url: photoUrl,
  };

  log(`  CREATED venue: ${name} (${venueId})`);
  return { venue, created: true };
}

module.exports = { ensureVenue, normalizeForLookup };
