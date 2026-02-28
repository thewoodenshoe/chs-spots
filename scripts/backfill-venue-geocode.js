#!/usr/bin/env node
/**
 * backfill-venue-geocode.js - Create venue records for unlinked spots
 *
 * For each spot with venue_id IS NULL, looks up the place via Google Places
 * Text Search + Place Details, creates a venue record with operating hours,
 * and links the spot. This enables "Open Now" badges for all activity types.
 *
 * Cost: ~$0.05 per spot (Text Search + Place Details)
 *
 * Usage:
 *   GOOGLE_PLACES_ENABLED=true node scripts/backfill-venue-geocode.js
 *   GOOGLE_PLACES_ENABLED=true node scripts/backfill-venue-geocode.js --dry-run
 *   GOOGLE_PLACES_ENABLED=true node scripts/backfill-venue-geocode.js --type "Coffee Shops"
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });
const db = require('./utils/db');

if (process.env.GOOGLE_PLACES_ENABLED !== 'true') {
  console.log('Set GOOGLE_PLACES_ENABLED=true to run this script.');
  process.exit(1);
}

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || process.env.GOOGLE_PLACES_KEY;
if (!API_KEY) {
  console.log('Missing NEXT_PUBLIC_GOOGLE_MAPS_KEY or GOOGLE_PLACES_KEY.');
  process.exit(1);
}

const DRY_RUN = process.argv.includes('--dry-run');
const TYPE_FILTER = (() => {
  const idx = process.argv.indexOf('--type');
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : null;
})();
const SKIP_TYPES = new Set(['Coming Soon', 'Recently Opened']);
const DELAY_MS = 600;
const MAX_DISTANCE_M = 1000;

const DAY_MAP = { 0: 'sun', 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat' };

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseGoogleHours(periods) {
  if (!periods || !Array.isArray(periods)) return null;
  const hours = {};
  for (const p of periods) {
    if (!p.open) continue;
    const dayKey = DAY_MAP[p.open.day];
    if (!dayKey) continue;
    const openTime = p.open.time.replace(/(\d{2})(\d{2})/, '$1:$2');
    const closeTime = p.close ? p.close.time.replace(/(\d{2})(\d{2})/, '$1:$2') : '23:59';
    hours[dayKey] = { open: openTime, close: closeTime };
  }
  const allDays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  for (const d of allDays) {
    if (!hours[d]) hours[d] = 'closed';
  }
  return Object.keys(hours).length > 0 ? hours : null;
}

async function textSearch(query) {
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${API_KEY}`;
  const resp = await fetch(url);
  const data = await resp.json();
  if (data.status === 'OK' && data.results?.length > 0) return data.results[0];
  return null;
}

async function placeDetails(placeId) {
  const fields = 'name,formatted_address,formatted_phone_number,website,opening_hours,photos,address_components,geometry';
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${fields}&key=${API_KEY}`;
  const resp = await fetch(url);
  const data = await resp.json();
  if (data.status === 'OK' && data.result) return data.result;
  return null;
}

function findArea(lat, lng, address) {
  const addressLower = (address || '').toLowerCase();
  const areas = [
    { name: 'Daniel Island', keywords: ['daniel island'], lat: 32.862, lng: -79.913, radius: 5000 },
    { name: "Sullivan's & IOP", keywords: ["sullivan's island", 'sullivans island', 'isle of palms'], lat: 32.764, lng: -79.838, radius: 8000 },
    { name: 'Mount Pleasant', keywords: ['mount pleasant', 'mt pleasant', 'mt. pleasant'], lat: 32.825, lng: -79.860, radius: 10000 },
    { name: 'James Island', keywords: ['james island'], lat: 32.731, lng: -79.942, radius: 8000 },
    { name: 'West Ashley', keywords: ['west ashley'], lat: 32.784, lng: -80.014, radius: 8000 },
    { name: 'North Charleston', keywords: ['north charleston', 'n charleston'], lat: 32.908, lng: -80.069, radius: 10000 },
    { name: 'Downtown Charleston', keywords: ['downtown', 'charleston'], lat: 32.783, lng: -79.937, radius: 5000 },
  ];
  for (const a of areas) {
    for (const kw of a.keywords) {
      if (addressLower.includes(kw)) return a.name;
    }
  }
  let closest = null;
  let closestDist = Infinity;
  for (const a of areas) {
    const d = haversine(lat, lng, a.lat, a.lng);
    if (d < a.radius && d < closestDist) {
      closest = a.name;
      closestDist = d;
    }
  }
  return closest || 'Downtown Charleston';
}

async function main() {
  const d = db.getDb();

  let sql = "SELECT id, title, type, lat, lng, area FROM spots WHERE venue_id IS NULL AND status = 'approved' AND lat IS NOT NULL AND lng IS NOT NULL";
  const params = [];
  if (TYPE_FILTER) {
    sql += ' AND type = ?';
    params.push(TYPE_FILTER);
  }
  sql += ' ORDER BY type, title';
  const orphans = d.prepare(sql).all(...params);

  const filtered = orphans.filter(s => !SKIP_TYPES.has(s.type));
  console.log(`[backfill-venue-geocode] Found ${filtered.length} unlinked spots (excluded ${orphans.length - filtered.length} Coming Soon/Recently Opened)`);
  if (DRY_RUN) console.log('  (DRY RUN — no DB writes)\n');

  let created = 0;
  let linked = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < filtered.length; i++) {
    const spot = filtered[i];
    const progress = `[${i + 1}/${filtered.length}]`;

    const existing = d.prepare("SELECT id FROM venues WHERE name = ? AND ABS(lat - ?) < 0.005 AND ABS(lng - ?) < 0.005").get(spot.title, spot.lat, spot.lng);
    if (existing) {
      if (!DRY_RUN) {
        d.prepare('UPDATE spots SET venue_id = ?, area = COALESCE(area, (SELECT area FROM venues WHERE id = ?)) WHERE id = ?').run(existing.id, existing.id, spot.id);
      }
      console.log(`${progress} ${spot.type.padEnd(22)} ${spot.title} → existing venue ${existing.id}`);
      linked++;
      continue;
    }

    await delay(DELAY_MS);
    const searchResult = await textSearch(`"${spot.title}" Charleston SC`);
    if (!searchResult) {
      console.log(`${progress} ${spot.type.padEnd(22)} ${spot.title} → NOT FOUND`);
      failed++;
      continue;
    }

    const dist = haversine(spot.lat, spot.lng, searchResult.geometry.location.lat, searchResult.geometry.location.lng);
    if (dist > MAX_DISTANCE_M) {
      console.log(`${progress} ${spot.type.padEnd(22)} ${spot.title} → too far (${Math.round(dist)}m) "${searchResult.name}"`);
      skipped++;
      continue;
    }

    await delay(DELAY_MS);
    const details = await placeDetails(searchResult.place_id);
    if (!details) {
      console.log(`${progress} ${spot.type.padEnd(22)} ${spot.title} → details fetch failed`);
      failed++;
      continue;
    }

    const hours = parseGoogleHours(details.opening_hours?.periods);
    const phone = details.formatted_phone_number || null;
    const website = details.website || null;
    const address = details.formatted_address || searchResult.formatted_address || null;
    const area = findArea(searchResult.geometry.location.lat, searchResult.geometry.location.lng, address) || spot.area;

    if (!DRY_RUN) {
      db.venues.upsert({
        id: searchResult.place_id,
        name: details.name || searchResult.name,
        address,
        lat: searchResult.geometry.location.lat,
        lng: searchResult.geometry.location.lng,
        area,
        website,
        types: searchResult.types || [],
      });

      if (phone) {
        d.prepare('UPDATE venues SET phone = ? WHERE id = ? AND phone IS NULL').run(phone, searchResult.place_id);
      }
      if (hours) {
        d.prepare("UPDATE venues SET operating_hours = ?, hours_source = 'google-places', hours_updated_at = datetime('now') WHERE id = ?")
          .run(JSON.stringify(hours), searchResult.place_id);
      }

      d.prepare('UPDATE spots SET venue_id = ?, area = ? WHERE id = ?').run(searchResult.place_id, area, spot.id);
    }

    const hoursTag = hours ? 'HAS_HOURS' : 'NO_HOURS';
    const phoneTag = phone ? 'HAS_PHONE' : '';
    console.log(`${progress} ${spot.type.padEnd(22)} ${spot.title} → ${details.name || searchResult.name} (${Math.round(dist)}m) ${hoursTag} ${phoneTag}`);
    created++;
    linked++;
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Venues created: ${created}`);
  console.log(`  Spots linked:   ${linked}`);
  console.log(`  Skipped (far):  ${skipped}`);
  console.log(`  Not found:      ${failed}`);

  db.closeDb();
}

main().catch(err => { console.error(err); process.exit(1); });
