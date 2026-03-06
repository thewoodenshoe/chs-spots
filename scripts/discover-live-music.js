#!/usr/bin/env node
/**
 * discover-live-music.js - Weekly Live Music Venue Discovery
 *
 * Uses Grok API with web_search to find new live music venues in Charleston.
 * Deduplicates against existing spots, geocodes via Google Places,
 * downloads photos, and inserts new discoveries.
 *
 * Runs weekly (Wednesday 4am EST via cron).
 *
 * Usage: GOOGLE_PLACES_ENABLED=true node scripts/discover-live-music.js
 */

const fs = require('fs');
const path = require('path');
const db = require('./utils/db');
const { parsePromotionTime } = require('./utils/time-parse');
const { resolveMissingTimes } = require('./utils/llm-resolve-times');
const { getPlacesApiKey, geocodePlace, downloadPlacePhoto, sendTelegram } = require('./utils/google-places');
const { createLogger } = require('./utils/logger');

const { log, warn, close: closeLog } = createLogger('discover-live-music');

try {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local') });
} catch { /* dotenv not installed in production */ }

const { webSearch, getApiKey } = require('./utils/llm-client');

const VALID_AREAS = [
  'Downtown Charleston', 'Mount Pleasant', 'Daniel Island',
  'North Charleston', 'West Ashley', 'James Island', "Sullivan's & IOP",
];
const TODAY = new Date().toISOString().split('T')[0];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function discoverViaGrok() {
  const prompt = `Search the web for bars, restaurants, breweries, distilleries, music halls, and other venues in the Charleston, South Carolina metro area that regularly host live music performances, concerts, or DJ sets.

Return a JSON array of objects with these columns:
- "venue": the venue name
- "address": full street address
- "neighborhood": one of: ${VALID_AREAS.map(a => `"${a}"`).join(', ')}
- "description": one sentence about the venue and what kind of music they host
- "schedule": when they have live music (e.g. "Nightly", "Fri/Sat", "Weekends")
- "website": link to their website or social media page

Only include venues in the greater Charleston SC area. Include bars with regular live music, dedicated music venues, breweries with live acts, restaurants with regular performers. Do NOT include one-time event spaces or venues that only occasionally host music. Maximum 40 results.`;

  log('Calling Grok API with web_search...');
  const result = await webSearch({ prompt, timeoutMs: 120000, log });
  if (!result?.parsed || !Array.isArray(result.parsed)) {
    log('Grok API returned no valid JSON array');
    return [];
  }
  const valid = result.parsed
    .filter(item => item.venue && item.description)
    .slice(0, 40)
    .map(item => ({
      name: item.venue.trim(),
      address: (item.address || '').trim() || null,
      area: VALID_AREAS.includes(item.neighborhood) ? item.neighborhood : null,
      description: (item.description || '').trim(),
      schedule: (item.schedule || '').trim() || null,
      website: (item.website || '').trim() || null,
    }));
  log(`Grok API: ${result.parsed.length} results, ${valid.length} valid`);
  return valid;
}

async function main() {
  const { acquire: acquireLock, release: releaseLock } = require('./utils/pipeline-lock');
  const lock = acquireLock('discover-live-music');
  if (!lock.acquired) { log(`Pipeline locked by ${lock.holder}. Exiting.`); process.exit(0); }

  if (!getPlacesApiKey()) { log('Error: No Google Places API key'); releaseLock(); process.exit(1); }
  if (!getApiKey()) { log('Error: No Grok API key'); releaseLock(); process.exit(1); }

  const startTime = Date.now();
  log('=== Live Music Discovery ===');

  const database = db.getDb();
  db.activities.upsert({ name: 'Live Music', icon: 'Music', emoji: '🎵', color: '#e11d48', community_driven: 0 });

  const grokVenues = await discoverViaGrok();
  if (grokVenues.length === 0) {
    log('No venues found from Grok API');
    await sendTelegram('🎵 Live Music Discovery\nNo new venues found.');
    releaseLock(); closeLog(); db.closeDb(); return;
  }

  const existingSpots = database.prepare("SELECT title FROM spots WHERE type = 'Live Music' AND status = 'approved'").all();
  const existingTitles = new Set(existingSpots.map(s => s.title.toLowerCase()));
  const excludedIds = db.watchlist.getExcludedIds();
  const excludedNames = new Set(db.watchlist.getExcluded().map(w => (w.name || '').toLowerCase().trim()).filter(Boolean));
  const allVenues = db.venues.getAll();
  const venuesByName = new Map();
  for (const v of allVenues) venuesByName.set(v.name?.toLowerCase(), v);

  let inserted = 0;
  const insertedNames = [];

  for (const venue of grokVenues) {
    if (existingTitles.has(venue.name.toLowerCase())) continue;
    if (excludedNames.has(venue.name.toLowerCase())) { log(`  SKIP (excluded): ${venue.name}`); continue; }

    const existingVenue = venuesByName.get(venue.name.toLowerCase());
    if (existingVenue && excludedIds.has(existingVenue.id)) { log(`  SKIP (venue excluded): ${venue.name}`); continue; }

    let lat, lng, placeId;
    if (existingVenue) {
      lat = existingVenue.lat; lng = existingVenue.lng; placeId = existingVenue.id;
      log(`  REUSE: ${venue.name}`);
    } else {
      if (process.env.GOOGLE_PLACES_ENABLED !== 'true') { log(`  SKIP (no geocoding): ${venue.name}`); continue; }
      const geo = await geocodePlace(venue.name, venue.address);
      if (!geo) { log(`  SKIP (geocode failed): ${venue.name}`); continue; }
      lat = geo.lat; lng = geo.lng; placeId = geo.placeId;
      log(`  GEOCODED: ${venue.name} → ${lat}, ${lng}`);
      await sleep(250);
    }

    const area = venue.area || existingVenue?.area || 'Downtown Charleston';
    const venueId = existingVenue?.id || placeId || `lm_${venue.name.toLowerCase().replace(/\s+/g, '_').slice(0, 30)}`;
    if (!existingVenue) {
      db.venues.upsert({ id: venueId, name: venue.name, address: venue.address, lat, lng, area, website: venue.website });
    }

    if (!existingVenue?.photo_url && placeId) {
      try {
        const photoPath = await downloadPlacePhoto(placeId, venueId, log);
        if (photoPath) db.venues.updatePhotoUrl(venueId, photoPath);
        await sleep(300);
      } catch (e) { log(`  Photo failed for ${venue.name}: ${e.message}`); }
    }

    const parsed = parsePromotionTime(venue.schedule);
    db.spots.insert({
      venue_id: venueId, title: venue.name, type: 'Live Music', source: 'automated', status: 'approved',
      description: venue.description, promotion_time: venue.schedule,
      time_start: parsed.timeStart, time_end: parsed.timeEnd, days: parsed.days,
      source_url: venue.website, last_update_date: TODAY,
    });
    log(`  INSERT: ${venue.name} (${area})`);
    inserted++;
    insertedNames.push(venue.name);
    existingTitles.add(venue.name.toLowerCase());
  }

  let timeResolved = 0;
  let unresolvedNames = [];
  if (inserted > 0 && getApiKey()) {
    try {
      const missingTimes = database.prepare(
        "SELECT id, title, type, promotion_time, source_url FROM spots WHERE type = 'Live Music' AND status = 'approved' AND time_start IS NULL AND time_end IS NULL AND last_update_date = ? LIMIT 20",
      ).all(TODAY);
      if (missingTimes.length > 0) {
        log(`LLM time resolution: ${missingTimes.length} spot(s) missing times...`);
        const { resolved, unresolved } = await resolveMissingTimes(
          missingTimes.map(r => ({ id: r.id, title: r.title, type: r.type, promotionTime: r.promotion_time, sourceUrl: r.source_url })),
          getApiKey(), log,
        );
        for (const r of resolved) {
          db.spots.update(r.id, {
            time_start: r.timeStart, time_end: r.timeEnd, days: r.days || null,
          });
        }
        timeResolved = resolved.length;
        unresolvedNames = unresolved.map(u => u.title);
      }
    } catch (err) { warn(`LLM time resolution failed: ${err.message}`); }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`Done: ${inserted} new, ${grokVenues.length} checked. Elapsed: ${elapsed}s`);

  const msg = [
    '🎵 <b>Live Music Discovery</b>', '',
    `Grok found: ${grokVenues.length} venues`, `New additions: ${inserted}`,
    inserted > 0 ? `\nNew: ${insertedNames.join(', ')}` : '',
    timeResolved > 0 ? `Times resolved: ${timeResolved}` : '',
    unresolvedNames.length > 0 ? `⚠️ No times: ${unresolvedNames.join(', ')}` : '',
    `Elapsed: ${elapsed}s`,
  ].filter(Boolean).join('\n');
  await sendTelegram(msg);

  releaseLock(); closeLog(); db.closeDb();
}

main().catch(e => {
  console.error('Fatal:', e);
  try { require('./utils/pipeline-lock').release(); } catch (_err) { /* already released */ }
  process.exit(1);
});
