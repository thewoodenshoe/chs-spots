#!/usr/bin/env node
/**
 * Backfill photos for spots that have no photo (and whose venue also has no photo).
 * Uses Google Places Text Search to find the place, then downloads the photo.
 *
 * Usage:
 *   GOOGLE_PLACES_API_KEY=... node scripts/backfill-photos.js [--confirm] [--type "Must-See Spots"]
 *
 * Without --confirm, runs in dry-run mode (no changes).
 */

const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', 'data', 'chs-spots.db');
const Database = require('better-sqlite3');
const db = new Database(DB_PATH);

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const dryRun = !process.argv.includes('--confirm');
const typeFilter = (() => {
  const idx = process.argv.indexOf('--type');
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

const PHOTO_DIR = path.resolve(__dirname, '..', 'public', 'spots');
const MAX_WIDTH = 800;
const DELAY_MS = 300;

if (!API_KEY) {
  console.log('Set GOOGLE_PLACES_API_KEY env var');
  process.exit(1);
}

if (!fs.existsSync(PHOTO_DIR)) fs.mkdirSync(PHOTO_DIR, { recursive: true });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function searchPlace(query) {
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.results && data.results.length > 0) {
    const place = data.results[0];
    return {
      photoRef: place.photos?.[0]?.photo_reference || null,
      name: place.name,
    };
  }
  return null;
}

async function downloadPhoto(photoRef, destPath) {
  const url = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${MAX_WIDTH}&photo_reference=${photoRef}&key=${API_KEY}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Photo API HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
  return buf.length;
}

async function main() {
  let query = `
    SELECT s.id, s.title, s.type, s.area, s.venue_id, v.name as venue_name, v.area as venue_area
    FROM spots s
    LEFT JOIN venues v ON s.venue_id = v.id
    WHERE (s.source = 'automated' OR s.status = 'approved' OR s.status IS NULL)
      AND (s.photo_url IS NULL OR s.photo_url = '')
      AND (v.photo_url IS NULL OR v.photo_url = '' OR v.id IS NULL)
  `;
  if (typeFilter) query += ` AND s.type = '${typeFilter.replace(/'/g, "''")}'`;
  query += ' ORDER BY s.type, s.id';

  const spots = db.prepare(query).all();
  console.log(`Found ${spots.length} spots without photos${typeFilter ? ` (type: ${typeFilter})` : ''}`);
  if (dryRun) console.log('DRY RUN — add --confirm to save\n');

  let success = 0, failed = 0, noMatch = 0;

  for (let i = 0; i < spots.length; i++) {
    const s = spots[i];
    const area = s.area || s.venue_area || 'Charleston SC';
    const searchQuery = `${s.title} ${area} Charleston SC`;
    const progress = `[${i + 1}/${spots.length}]`;

    try {
      const place = await searchPlace(searchQuery);
      if (!place || !place.photoRef) {
        console.log(`${progress} ⚠ No photo: ${s.title} (${s.type})`);
        noMatch++;
        await sleep(DELAY_MS);
        continue;
      }

      if (dryRun) {
        console.log(`${progress} Would download: ${s.title} → ${place.name}`);
        success++;
        await sleep(100);
        continue;
      }

      const photoPath = path.join(PHOTO_DIR, `${s.id}.jpg`);
      const bytes = await downloadPhoto(place.photoRef, photoPath);
      db.prepare("UPDATE spots SET photo_url = ? WHERE id = ?").run(`/spots/${s.id}.jpg`, s.id);
      console.log(`${progress} ✅ ${s.title} (${(bytes / 1024).toFixed(0)} KB)`);
      success++;
    } catch (err) {
      console.log(`${progress} ❌ ${s.title}: ${err.message}`);
      failed++;
    }

    await sleep(DELAY_MS);
  }

  console.log(`\nDone: ${success} photos${dryRun ? ' (would download)' : ''}, ${noMatch} no match, ${failed} failed`);
}

main().catch(console.error);
