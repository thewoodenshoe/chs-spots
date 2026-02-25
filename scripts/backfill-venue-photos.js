/**
 * backfill-venue-photos.js — One-off script to download Google Places photos
 *
 * Downloads the primary photo for each venue and saves it to public/venues/.
 * Updates the venues.photo_url column so photos flow to spots automatically.
 *
 * Usage: GOOGLE_PLACES_ENABLED=true node scripts/backfill-venue-photos.js --confirm
 *
 * Cost: ~$24 one-time (Details API + Photo API for ~991 venues)
 */

const fs = require('fs');
const path = require('path');
const db = require('./utils/db');

const REQUIRED_FLAG = '--confirm';
if (!process.argv.includes(REQUIRED_FLAG)) {
  console.log('Usage: GOOGLE_PLACES_ENABLED=true node scripts/backfill-venue-photos.js --confirm');
  console.log('This script calls Google Places API and will incur ~$24 in costs.');
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

const PHOTO_DIR = path.join(__dirname, '..', 'public', 'venues');
const DELAY_MS = 250;
const MAX_WIDTH = 800;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchPhotoReference(placeId) {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=photos&key=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Details API HTTP ${res.status}`);
  const data = await res.json();
  if (data.status !== 'OK' || !data.result?.photos?.length) return null;
  return data.result.photos[0].photo_reference;
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
  if (!fs.existsSync(PHOTO_DIR)) {
    fs.mkdirSync(PHOTO_DIR, { recursive: true });
    console.log(`Created ${PHOTO_DIR}`);
  }

  const allVenues = db.venues.getAll();
  const venues = allVenues.filter(v => !v.photo_url);

  console.log(`\nVenue photo backfill`);
  console.log(`  Total venues: ${allVenues.length}`);
  console.log(`  Already have photo: ${allVenues.length - venues.length}`);
  console.log(`  Need photo: ${venues.length}\n`);

  let downloaded = 0;
  let skippedNoPhoto = 0;
  let failed = 0;
  let totalBytes = 0;

  for (let i = 0; i < venues.length; i++) {
    const venue = venues[i];
    const progress = `[${i + 1}/${venues.length}]`;
    const destFile = path.join(PHOTO_DIR, `${venue.id}.jpg`);

    if (fs.existsSync(destFile)) {
      const relPath = `/venues/${venue.id}.jpg`;
      db.venues.updatePhotoUrl(venue.id, relPath);
      downloaded++;
      console.log(`${progress} ⏭  ${venue.name} (file exists, DB updated)`);
      continue;
    }

    try {
      const photoRef = await fetchPhotoReference(venue.id);
      if (!photoRef) {
        skippedNoPhoto++;
        console.log(`${progress} ⬜ ${venue.name} — no photo in Google Places`);
        await delay(DELAY_MS);
        continue;
      }

      const bytes = await downloadPhoto(photoRef, destFile);
      const relPath = `/venues/${venue.id}.jpg`;
      db.venues.updatePhotoUrl(venue.id, relPath);

      totalBytes += bytes;
      downloaded++;
      console.log(`${progress} ✅ ${venue.name} (${(bytes / 1024).toFixed(0)} KB)`);
    } catch (err) {
      failed++;
      console.error(`${progress} ❌ ${venue.name}: ${err.message}`);
    }

    await delay(DELAY_MS);
  }

  console.log(`\nDone!`);
  console.log(`  Downloaded: ${downloaded}`);
  console.log(`  No photo available: ${skippedNoPhoto}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total size: ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
