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
 * Cost: ~$0.10/week (Grok API + geocoding)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const db = require('./utils/db');

// ── Logging ─────────────────────────────────────────────────────

const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
const logPath = path.join(logDir, 'discover-live-music.log');
fs.writeFileSync(logPath, '', 'utf8');

function log(msg) {
  const ts = new Date().toISOString();
  console.log(msg);
  fs.appendFileSync(logPath, `[${ts}] ${msg}\n`);
}

// ── Environment ─────────────────────────────────────────────────

try {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local') });
} catch (e) {
  try { require('dotenv').config(); } catch (_) {}
}

const GOOGLE_MAPS_API_KEY =
  process.env.GOOGLE_PLACES_SERVER_KEY ||
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ||
  process.env.GOOGLE_PLACES_KEY;

const GROK_API_KEY = process.env.XAI_API_KEY || process.env.GROK_API_KEY || '';
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT = process.env.TELEGRAM_ADMIN_CHAT_ID || '';

if (!GOOGLE_MAPS_API_KEY) {
  log('Error: No Google Places API key found');
  process.exit(1);
}
if (!GROK_API_KEY) {
  log('Error: No Grok API key found (XAI_API_KEY)');
  process.exit(1);
}

const VALID_AREAS = [
  'Downtown Charleston', 'Mount Pleasant', 'Daniel Island',
  'North Charleston', 'West Ashley', 'James Island', "Sullivan's & IOP",
];
const TODAY = new Date().toISOString().split('T')[0];

// ── Helpers ─────────────────────────────────────────────────────

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        file.close();
        fs.unlinkSync(dest);
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (e) => { fs.unlinkSync(dest); reject(e); });
  });
}

async function geocode(name, address) {
  const query = encodeURIComponent(`${name} ${address || 'Charleston SC'}`);
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&key=${GOOGLE_MAPS_API_KEY}`;
  const data = await fetchJson(url);
  if (!data.results?.length) return null;
  const place = data.results[0];
  return {
    lat: place.geometry.location.lat,
    lng: place.geometry.location.lng,
    placeId: place.place_id,
  };
}

async function fetchPlacePhoto(placeId, spotId) {
  const spotsDir = path.join(__dirname, '..', 'public', 'spots');
  if (!fs.existsSync(spotsDir)) fs.mkdirSync(spotsDir, { recursive: true });
  const dest = path.join(spotsDir, `${spotId}.jpg`);
  if (fs.existsSync(dest)) return `/spots/${spotId}.jpg`;

  const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=photos&key=${GOOGLE_MAPS_API_KEY}`;
  const detail = await fetchJson(detailUrl);
  const photoRef = detail?.result?.photos?.[0]?.photo_reference;
  if (!photoRef) return null;

  const photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${photoRef}&key=${GOOGLE_MAPS_API_KEY}`;
  await downloadFile(photoUrl, dest);
  log(`  Downloaded photo → /spots/${spotId}.jpg`);
  return `/spots/${spotId}.jpg`;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sendTelegram(text) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT) return;
  try {
    const payload = JSON.stringify({ chat_id: TELEGRAM_CHAT, text, parse_mode: 'HTML' });
    await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.telegram.org',
        path: `/bot${TELEGRAM_TOKEN}/sendMessage`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      }, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => resolve(d));
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  } catch (e) {
    log(`  Telegram send failed: ${e.message}`);
  }
}

// ── Grok Discovery ──────────────────────────────────────────────

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

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    const res = await fetch('https://api.x.ai/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'grok-4-1-fast-reasoning',
        temperature: 0.2,
        input: [
          { role: 'system', content: 'You are a Charleston SC live music researcher. Return only valid JSON arrays. No markdown fences, no commentary.' },
          { role: 'user', content: prompt },
        ],
        tools: [{ type: 'web_search' }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      log(`Grok API error: HTTP ${res.status} ${errBody.substring(0, 200)}`);
      return [];
    }

    const data = await res.json();

    let text = '';
    if (data.output && Array.isArray(data.output)) {
      for (const block of data.output) {
        if (block.type === 'message' && Array.isArray(block.content)) {
          for (const part of block.content) {
            if (part.type === 'output_text' && part.text) text += part.text;
          }
        }
      }
    }
    if (!text && data.choices?.[0]?.message?.content) {
      text = data.choices[0].message.content;
    }

    if (!text) {
      log('Grok API returned empty response');
      return [];
    }

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      log('Grok response contained no JSON array');
      return [];
    }

    let items;
    try {
      items = JSON.parse(jsonMatch[0]);
    } catch (e) {
      log(`Grok JSON parse failed: ${e.message}`);
      return [];
    }

    if (!Array.isArray(items)) return [];

    const valid = items
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

    log(`Grok API: ${items.length} results, ${valid.length} valid`);
    return valid;
  } catch (err) {
    if (err.name === 'AbortError') {
      log('Grok API timed out after 120s');
    } else {
      log(`Grok API error: ${err.message}`);
    }
    return [];
  }
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  const { acquire: acquireLock, release: releaseLock } = require('./utils/pipeline-lock');
  const lock = acquireLock('discover-live-music');
  if (!lock.acquired) {
    log(`🔒 Pipeline locked by ${lock.holder} (PID ${lock.pid}). Waiting for next run.`);
    process.exit(0);
  }

  const startTime = Date.now();
  log('=== Live Music Discovery ===\n');

  const database = db.getDb();
  db.activities.upsert({ name: 'Live Music', icon: 'Music', emoji: '🎵', color: '#e11d48', community_driven: 0 });

  const grokVenues = await discoverViaGrok();
  if (grokVenues.length === 0) {
    log('No venues found from Grok API');
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    await sendTelegram(`🎵 Live Music Discovery\nNo new venues found.\nElapsed: ${elapsed}s`);
    releaseLock();
    db.closeDb();
    return;
  }

  // Load existing Live Music spots for dedup
  const existingSpots = database.prepare(
    "SELECT title FROM spots WHERE type = 'Live Music' AND status = 'approved'"
  ).all();
  const existingTitles = new Set(existingSpots.map(s => s.title.toLowerCase()));

  // Load watchlist to skip excluded venues
  const excludedIds = db.watchlist.getExcludedIds();
  const excludedNames = new Set(
    db.watchlist.getExcluded().map(w => (w.name || '').toLowerCase().trim()).filter(Boolean)
  );

  // Also check venue names for photo reuse
  const allVenues = db.venues.getAll();
  const venuesByName = new Map();
  for (const v of allVenues) {
    venuesByName.set(v.name?.toLowerCase(), v);
  }

  let inserted = 0;
  const insertedNames = [];

  for (const venue of grokVenues) {
    if (existingTitles.has(venue.name.toLowerCase())) continue;
    if (excludedNames.has(venue.name.toLowerCase())) {
      log(`  SKIP (watchlist excluded): ${venue.name}`);
      continue;
    }

    // Try venue match for photo/coords reuse
    const existingVenue = venuesByName.get(venue.name.toLowerCase());
    let lat, lng, placeId, photoUrl;

    if (existingVenue && excludedIds.has(existingVenue.id)) {
      log(`  SKIP (venue watchlisted): ${venue.name}`);
      continue;
    }

    if (existingVenue) {
      lat = existingVenue.lat;
      lng = existingVenue.lng;
      placeId = existingVenue.id;
      if (existingVenue.photo_url) {
        const fullPath = path.join(__dirname, '..', 'public', existingVenue.photo_url);
        photoUrl = fs.existsSync(fullPath) ? existingVenue.photo_url : null;
      }
      log(`  REUSE: ${venue.name}`);
    } else {
      if (process.env.GOOGLE_PLACES_ENABLED !== 'true') {
        log(`  SKIP (no geocoding): ${venue.name}`);
        continue;
      }
      const geo = await geocode(venue.name, venue.address);
      if (!geo) {
        log(`  SKIP (geocode failed): ${venue.name}`);
        continue;
      }
      lat = geo.lat;
      lng = geo.lng;
      placeId = geo.placeId;
      log(`  GEOCODED: ${venue.name} → ${lat}, ${lng}`);
      await sleep(250);
    }

    const area = venue.area || (existingVenue?.area) || 'Downtown Charleston';

    const spotId = db.spots.insert({
      venue_id: existingVenue?.id || null,
      title: venue.name,
      type: 'Live Music',
      source: 'automated',
      status: 'approved',
      description: venue.description,
      promotion_time: venue.schedule,
      source_url: venue.website,
      lat,
      lng,
      area,
      last_update_date: TODAY,
    });

    if (!photoUrl && placeId) {
      try {
        photoUrl = await fetchPlacePhoto(placeId, spotId);
        if (photoUrl) {
          database.prepare("UPDATE spots SET photo_url = ? WHERE id = ?").run(photoUrl, spotId);
        }
        await sleep(300);
      } catch (e) {
        log(`  Photo failed for ${venue.name}: ${e.message}`);
      }
    } else if (photoUrl) {
      database.prepare("UPDATE spots SET photo_url = ? WHERE id = ?").run(photoUrl, spotId);
    }

    log(`  INSERT #${spotId}: ${venue.name} (${area})`);
    inserted++;
    insertedNames.push(venue.name);
    existingTitles.add(venue.name.toLowerCase());
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`\nDone: ${inserted} new venues added, ${grokVenues.length} checked. Elapsed: ${elapsed}s`);

  const msg = [
    '🎵 <b>Live Music Discovery</b>',
    '',
    `Grok found: ${grokVenues.length} venues`,
    `New additions: ${inserted}`,
    inserted > 0 ? `\nNew: ${insertedNames.join(', ')}` : '',
    `\nElapsed: ${elapsed}s`,
  ].filter(Boolean).join('\n');
  await sendTelegram(msg);

  releaseLock();
  db.closeDb();
}

main().catch(e => {
  console.error('Fatal:', e);
  try { require('./utils/pipeline-lock').release(); } catch {}
  process.exit(1);
});
