/**
 * seed-activity-spots.js — Reusable script to seed spots for any activity.
 *
 * Reads a JSON config of curated spots, resolves precise coordinates and
 * photos via Google Places APIs, and inserts into the DB as approved spots.
 *
 * Usage:
 *   GOOGLE_PLACES_ENABLED=true node scripts/seed-activity-spots.js \
 *     --activity "Rooftop Bars" --file data/seeds/rooftop-bars.json --confirm
 *
 * Config format (JSON array):
 *   [{ "title": "...", "description": "...", "area": "...", "searchHint": "..." }]
 *
 * The script:
 *   - Skips spots whose title already exists for the given activity type
 *   - Uses Google Places Text Search for precise lat/lng
 *   - Downloads primary photo via Google Places Photo API
 *   - Saves photo to public/spots/{spot_id}.jpg
 *   - Inserts with status='approved', source='manual', submitter_name='Orion'
 */

const fs = require('fs');
const path = require('path');
const db = require('./utils/db');

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(name);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}

const activityType = getArg('--activity');
const seedFile = getArg('--file');
const dryRun = !args.includes('--confirm');

if (!activityType || !seedFile) {
  console.log('Usage: GOOGLE_PLACES_ENABLED=true node scripts/seed-activity-spots.js \\');
  console.log('  --activity "Rooftop Bars" --file data/seeds/rooftop-bars.json --confirm');
  process.exit(1);
}

if (process.env.GOOGLE_PLACES_ENABLED !== 'true') {
  console.log('Set GOOGLE_PLACES_ENABLED=true to run this script.');
  process.exit(1);
}

try {
  require('dotenv').config({ path: '.env.local' });
} catch {
  try { require('dotenv').config(); } catch { /* env vars set externally */ }
}

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || process.env.GOOGLE_PLACES_KEY;
if (!API_KEY) {
  console.error('NEXT_PUBLIC_GOOGLE_MAPS_KEY or GOOGLE_PLACES_KEY must be set');
  process.exit(1);
}

const PHOTO_DIR = path.join(__dirname, '..', 'public', 'spots');
const DELAY_MS = 300;
const MAX_WIDTH = 800;
const SUBMITTER = 'John';

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function searchPlace(query) {
  const params = new URLSearchParams({
    query,
    key: API_KEY,
  });
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Text Search HTTP ${res.status}`);
  const data = await res.json();
  if (data.status !== 'OK' || !data.results?.length) return null;
  const place = data.results[0];
  return {
    placeId: place.place_id,
    lat: place.geometry.location.lat,
    lng: place.geometry.location.lng,
    address: place.formatted_address,
    name: place.name,
    photoReference: place.photos?.[0]?.photo_reference || null,
  };
}

async function downloadPhoto(photoRef, destPath) {
  const url = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${MAX_WIDTH}&photo_reference=${photoRef}&key=${API_KEY}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Photo API HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
  return buffer.length;
}

async function main() {
  const seedPath = path.resolve(seedFile);
  if (!fs.existsSync(seedPath)) {
    console.error(`Seed file not found: ${seedPath}`);
    process.exit(1);
  }

  const seeds = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  console.log(`\n🌱 Seed Activity Spots`);
  console.log(`  Activity: ${activityType}`);
  console.log(`  Seed file: ${seedFile} (${seeds.length} spots)`);
  console.log(`  Mode: ${dryRun ? 'DRY RUN (add --confirm to insert)' : 'LIVE'}\n`);

  if (!fs.existsSync(PHOTO_DIR)) {
    fs.mkdirSync(PHOTO_DIR, { recursive: true });
  }

  const existingSpots = db.spots.getAll({ type: activityType });
  const existingTitles = new Set(existingSpots.map(s => s.title.toLowerCase()));

  let inserted = 0;
  let skipped = 0;
  let noMatch = 0;
  let photoFailed = 0;
  const report = [];

  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i];
    const progress = `[${i + 1}/${seeds.length}]`;

    if (existingTitles.has(seed.title.toLowerCase())) {
      console.log(`${progress} ⏭  ${seed.title} (already exists)`);
      skipped++;
      continue;
    }

    const searchQuery = seed.searchHint || `${seed.title} Charleston SC`;
    const place = await searchPlace(searchQuery);

    if (!place) {
      console.log(`${progress} ⚠️  ${seed.title} — no Google Places match for "${searchQuery}"`);
      noMatch++;
      report.push({ title: seed.title, status: 'NO_MATCH', query: searchQuery });

      if (!dryRun) {
        const spotId = db.spots.insert({
          title: seed.title,
          type: activityType,
          source: 'manual',
          status: 'approved',
          description: seed.description || null,
          submitter_name: SUBMITTER,
          submitted_at: new Date().toISOString(),
          lat: null,
          lng: null,
          area: seed.area || null,
        });
        console.log(`  → Inserted without coords (id=${spotId})`);
        inserted++;
      }
      await delay(DELAY_MS);
      continue;
    }

    let photoPath = null;
    let photoBytes = 0;
    const tempSpotId = `temp_${Date.now()}_${i}`;

    if (place.photoReference) {
      try {
        const tempDest = path.join(PHOTO_DIR, `${tempSpotId}.jpg`);
        photoBytes = await downloadPhoto(place.photoReference, tempDest);
        photoPath = tempDest;
      } catch (err) {
        console.log(`  ⚠️  Photo download failed: ${err.message}`);
        photoFailed++;
      }
    }

    if (dryRun) {
      console.log(`${progress} ✅ ${seed.title}`);
      console.log(`     Google: "${place.name}" @ ${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}`);
      console.log(`     Photo: ${photoPath ? `${(photoBytes / 1024).toFixed(0)} KB` : 'none'}`);
      if (photoPath) fs.unlinkSync(photoPath);
    } else {
      const spotId = db.spots.insert({
        title: seed.title,
        type: activityType,
        source: 'manual',
        status: 'approved',
        description: seed.description || null,
        submitter_name: SUBMITTER,
        submitted_at: new Date().toISOString(),
        lat: place.lat,
        lng: place.lng,
        area: seed.area || null,
      });

      if (photoPath) {
        const finalDest = path.join(PHOTO_DIR, `${spotId}.jpg`);
        fs.renameSync(photoPath, finalDest);
        const relPath = `/spots/${spotId}.jpg`;
        db.spots.update(spotId, { photo_url: relPath });
        console.log(`${progress} ✅ ${seed.title} (id=${spotId}, ${(photoBytes / 1024).toFixed(0)} KB)`);
      } else {
        console.log(`${progress} ✅ ${seed.title} (id=${spotId}, no photo)`);
      }
      inserted++;
    }

    report.push({
      title: seed.title,
      status: 'OK',
      googleName: place.name,
      lat: place.lat,
      lng: place.lng,
      hasPhoto: !!photoPath,
    });

    await delay(DELAY_MS);
  }

  console.log(`\n📊 Summary`);
  console.log(`  Inserted: ${inserted}`);
  console.log(`  Skipped (existing): ${skipped}`);
  console.log(`  No Google match: ${noMatch}`);
  console.log(`  Photo failures: ${photoFailed}`);

  if (report.length > 0) {
    const reportPath = path.join(__dirname, '..', 'data', 'seeds', `${activityType.toLowerCase().replace(/\s+/g, '-')}-report.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`  Report: ${reportPath}`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
