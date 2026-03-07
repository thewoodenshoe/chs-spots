'use strict';

const { getPlacesApiKey, geocodePlace, downloadPlacePhoto } = require('../../utils/google-places');
const { webSearch, getApiKey } = require('../../utils/llm-client');
const { loadPrompt } = require('../../utils/load-prompt');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function normalizeForLookup(name) {
  return (name || '').toLowerCase().replace(/['']/g, "'")
    .replace(/^the\s+/i, '').replace(/\s+/g, ' ').trim();
}

function findExistingVenue(name, db) {
  const allVenues = db.venues.getAll();
  const normName = normalizeForLookup(name);
  for (const v of allVenues) {
    const normV = normalizeForLookup(v.name);
    if (normV === normName || normV.includes(normName) || normName.includes(normV)) {
      return v;
    }
  }
  return null;
}

async function enrichVenueWebsite(venue, log) {
  if (venue.website && venue.website !== 'n/a') return venue;
  if (!getApiKey()) return venue;

  try {
    const prompt = loadPrompt('shared/find-venue', {
      VENUE_NAME: venue.name, ADDRESS: venue.address || 'Charleston, SC',
    });
    const result = await webSearch({ prompt, timeoutMs: 60000, log });
    if (result?.parsed?.website) {
      return { ...venue, website: result.parsed.website };
    }
  } catch (err) {
    log(`[find-venue] LLM enrichment failed for ${venue.name}: ${err.message}`);
  }
  return venue;
}

/**
 * Multi-step venue resolution sub-workflow.
 * 1. Search existing venues by name
 * 2. If not found, geocode via Google Places
 * 3. Download photo
 * 4. Enrich website/phone via LLM if missing
 * 5. Quality check venue data
 *
 * @returns {{ venue, created, quality }} or null if unresolvable
 */
async function findVenue({ name, address, website, area }, { db, log }) {
  const existing = findExistingVenue(name, db);
  if (existing) {
    log(`[find-venue] REUSE: ${existing.name} (${existing.id})`);
    const hasBasics = existing.lat && existing.lng;
    return { venue: existing, created: false, quality: hasBasics ? 'complete' : 'partial' };
  }

  if (!getPlacesApiKey() || process.env.GOOGLE_PLACES_ENABLED !== 'true') {
    log(`[find-venue] SKIP (geocoding disabled): ${name}`);
    return null;
  }

  const geo = await geocodePlace(name, address || 'Charleston SC');
  if (!geo) {
    log(`[find-venue] SKIP (geocode failed): ${name}`);
    return null;
  }
  log(`[find-venue] GEOCODED: ${name} → ${geo.lat}, ${geo.lng}`);
  await sleep(250);

  const venueId = geo.placeId || `ven_${normalizeForLookup(name).replace(/\s+/g, '_').slice(0, 30)}`;
  db.venues.upsert({
    id: venueId, name, address: address || null,
    lat: geo.lat, lng: geo.lng,
    area: area || 'Downtown Charleston',
    website: website || null,
  });

  let photoUrl = null;
  if (geo.placeId) {
    try {
      photoUrl = await downloadPlacePhoto(geo.placeId, venueId, log);
      if (photoUrl) db.venues.updatePhotoUrl(venueId, photoUrl);
      await sleep(300);
    } catch (e) {
      log(`[find-venue] Photo failed for ${name}: ${e.message}`);
    }
  }

  let venue = {
    id: venueId, name, address: address || null,
    lat: geo.lat, lng: geo.lng,
    area: area || 'Downtown Charleston',
    website: website || null, photo_url: photoUrl,
  };
  log(`[find-venue] CREATED: ${name} (${venueId})`);

  venue = await enrichVenueWebsite(venue, log);
  if (venue.website && venue.website !== website) {
    db.venues.upsert({ id: venueId, website: venue.website });
  }

  const quality = (venue.lat && venue.lng && venue.website) ? 'complete' : 'partial';
  return { venue, created: true, quality };
}

module.exports = { findVenue, findExistingVenue, normalizeForLookup };
