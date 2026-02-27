/**
 * backfill-venue-photos.js — Download Google Places photos for venues
 *
 * Downloads the primary photo for each venue referenced by active spots
 * and saves it to public/venues/. Updates the venues.photo_url column
 * so photos flow to spots automatically via the API fallback chain.
 *
 * Usage: GOOGLE_PLACES_ENABLED=true node scripts/backfill-venue-photos.js --confirm
 *        Add --all to include venues not referenced by any spot (~$24)
 *
 * Cost: ~$5 for spot-referenced venues, ~$24 for all venues
 */

const fs = require('fs');
const path = require('path');
const db = require('./utils/db');

const REQUIRED_FLAG = '--confirm';
if (!process.argv.includes(REQUIRED_FLAG)) {
  console.log('Usage: GOOGLE_PLACES_ENABLED=true node scripts/backfill-venue-photos.js --confirm');
  console.log('       Add --all to include ALL venues (not just spot-referenced)');
  console.log('Cost: ~$5 for spot-referenced, ~$24 for all venues.');
  process.exit(1);
}

if (process.env.GOOGLE_PLACES_ENABLED !== 'true') {
  console.log('Set GOOGLE_PLACES_ENABLED=true to run this script.');
  process.exit(1);
}

const INCLUDE_ALL = process.argv.includes('--all');

try {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local') });
} catch {
  try { require('dotenv').config(); } catch { /* env vars set externally */ }
}

const API_KEY =
  process.env.GOOGLE_PLACES_SERVER_KEY ||
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ||
  process.env.GOOGLE_PLACES_KEY;
if (!API_KEY) {
  console.error('GOOGLE_PLACES_SERVER_KEY or NEXT_PUBLIC_GOOGLE_MAPS_KEY must be set');
  process.exit(1);
}

const PHOTO_DIR = path.join(__dirname, '..', 'public', 'venues');
const LOG_DIR = path.join(__dirname, '..', 'logs');
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
  if (!fs.existsSync(PHOTO_DIR)) fs.mkdirSync(PHOTO_DIR, { recursive: true });
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

  const logFile = path.join(LOG_DIR, `backfill-photos-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.log`);
  function log(msg) { console.log(msg); fs.appendFileSync(logFile, `${msg}\n`); }

  const allVenues = db.venues.getAll();

  const d = db.getDb();
  const spotVenueIds = new Set(
    d.prepare("SELECT DISTINCT venue_id FROM spots WHERE venue_id IS NOT NULL AND status = 'approved'")
      .all().map(r => r.venue_id),
  );

  const candidateVenues = INCLUDE_ALL
    ? allVenues.filter(v => !v.photo_url)
    : allVenues.filter(v => !v.photo_url && spotVenueIds.has(v.id));

  log(`\n📷 Venue photo backfill`);
  log(`  Total venues: ${allVenues.length}`);
  log(`  Referenced by spots: ${spotVenueIds.size}`);
  log(`  Already have photo: ${allVenues.length - allVenues.filter(v => !v.photo_url).length}`);
  log(`  Will download: ${candidateVenues.length}${INCLUDE_ALL ? ' (--all)' : ' (spot-referenced only)'}`);
  log(`  Estimated cost: ~$${(candidateVenues.length * 0.024).toFixed(2)}\n`);

  const venues = candidateVenues;

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
      log(`${progress} ⏭  ${venue.name} (file exists, DB updated)`);
      continue;
    }

    try {
      const photoRef = await fetchPhotoReference(venue.id);
      if (!photoRef) {
        skippedNoPhoto++;
        log(`${progress} ⬜ ${venue.name} — no photo in Google Places`);
        await delay(DELAY_MS);
        continue;
      }

      const bytes = await downloadPhoto(photoRef, destFile);
      const relPath = `/venues/${venue.id}.jpg`;
      db.venues.updatePhotoUrl(venue.id, relPath);

      totalBytes += bytes;
      downloaded++;
      log(`${progress} ✅ ${venue.name} (${(bytes / 1024).toFixed(0)} KB)`);
    } catch (err) {
      failed++;
      log(`${progress} ❌ ${venue.name}: ${err.message}`);
    }

    await delay(DELAY_MS);
  }

  log(`\n✨ Done!`);
  log(`  Downloaded: ${downloaded}`);
  log(`  No photo available: ${skippedNoPhoto}`);
  log(`  Failed: ${failed}`);
  log(`  Total size: ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
  log(`  Log: ${logFile}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
