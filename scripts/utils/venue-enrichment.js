/**
 * Venue enrichment helpers — photo downloads and operating hours backfill.
 * Called from enrich-venues.js during the nightly pipeline.
 */

const fs = require('fs');
const path = require('path');
const db = require('./db');
const { chat, getApiKey } = require('./llm-client');
const { loadPrompt } = require('./load-prompt');

const PHOTO_DIR = path.join(__dirname, '..', '..', 'public', 'venues');
const DELAY_MS = 300;
const PHOTO_LIMIT = 200;
const HOURS_LIMIT = 30;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getGoogleApiKey() {
  return process.env.GOOGLE_PLACES_SERVER_KEY
    || process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY
    || process.env.GOOGLE_PLACES_KEY;
}

async function fetchPhotoReference(placeId, apiKey) {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=photos&key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Details API HTTP ${res.status}`);
  const data = await res.json();
  if (data.status !== 'OK' || !data.result?.photos?.length) return null;
  return data.result.photos[0].photo_reference;
}

async function downloadPhoto(photoRef, destPath, apiKey) {
  const url = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${photoRef}&key=${apiKey}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Photo API HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
  return buffer.length;
}

async function enrichPhotos(dryRun = false) {
  const apiKey = getGoogleApiKey();
  if (!apiKey) {
    console.log('\n📷 Photo enrichment: skipped (no Google API key)');
    return { downloaded: 0, skipped: 0, failed: 0 };
  }

  if (!fs.existsSync(PHOTO_DIR)) fs.mkdirSync(PHOTO_DIR, { recursive: true });

  const database = db.getDb();
  const venues = database.prepare(`
    SELECT v.id, v.name, COALESCE(v.google_place_id, v.id) AS place_id
    FROM venues v
    INNER JOIN spots s ON s.venue_id = v.id AND s.status = 'approved'
    WHERE (v.photo_url IS NULL OR v.photo_url = '')
      AND (
        (v.google_place_id IS NOT NULL AND v.google_place_id != '')
        OR v.id LIKE 'ChIJ%'
      )
    GROUP BY v.id
    ORDER BY v.created_at DESC
    LIMIT ?
  `).all(PHOTO_LIMIT);

  console.log(`\n📷 Photo enrichment: ${venues.length} venue(s) to process`);
  let downloaded = 0, skipped = 0, failed = 0;

  for (const venue of venues) {
    const placeId = venue.place_id;
    const destFile = path.join(PHOTO_DIR, `${venue.id}.jpg`);

    if (fs.existsSync(destFile)) {
      const relPath = `/venues/${venue.id}.jpg`;
      if (!dryRun) db.venues.updatePhotoUrl(venue.id, relPath);
      downloaded++;
      continue;
    }

    try {
      const photoRef = await fetchPhotoReference(placeId, apiKey);
      if (!photoRef) { skipped++; await sleep(DELAY_MS); continue; }

      if (dryRun) {
        console.log(`   [DRY] ${venue.name}: would download photo`);
        downloaded++;
      } else {
        await downloadPhoto(photoRef, destFile, apiKey);
        db.venues.updatePhotoUrl(venue.id, `/venues/${venue.id}.jpg`);
        console.log(`   ✅ ${venue.name}: photo downloaded`);
        downloaded++;
      }
    } catch (err) {
      console.log(`   ❌ ${venue.name}: ${err.message}`);
      failed++;
    }
    await sleep(DELAY_MS);
  }

  console.log(`   Photos — downloaded: ${downloaded}, no photo: ${skipped}, failed: ${failed}`);
  return { downloaded, skipped, failed };
}

async function enrichHours(dryRun = false) {
  if (!getApiKey()) {
    console.log('\n🕐 Hours enrichment: skipped (no LLM API key)');
    return { updated: 0, failed: 0 };
  }

  const database = db.getDb();
  const venues = database.prepare(`
    SELECT id, name, address, area
    FROM venues
    WHERE (operating_hours IS NULL OR operating_hours = '')
      AND venue_status = 'active'
    ORDER BY created_at DESC
    LIMIT ?
  `).all(HOURS_LIMIT);

  console.log(`\n🕐 Hours enrichment: ${venues.length} venue(s) to process`);
  if (venues.length === 0) return { updated: 0, failed: 0 };

  let updated = 0, failed = 0;
  const batchSize = 10;

  for (let i = 0; i < venues.length; i += batchSize) {
    const batch = venues.slice(i, i + batchSize);
    const prompt = batch.map((v, idx) =>
      `${idx}. ${v.name} — ${v.address || 'N/A'}, ${v.area || 'Charleston, SC'}`,
    ).join('\n');

    try {
      const result = await chat({
        messages: [
          { role: 'system', content: loadPrompt('shared/venue-hours') },
          { role: 'user', content: `Find operating hours for these Charleston, SC venues:\n${prompt}` },
        ],
        temperature: 0.1,
        timeoutMs: 60000,
      });

      if (!result?.parsed || !Array.isArray(result.parsed)) {
        console.log(`   ❌ Batch ${Math.floor(i / batchSize) + 1}: could not parse LLM response`);
        failed += batch.length;
        continue;
      }

      for (const item of result.parsed) {
        const venue = batch[item.index];
        if (!venue || !item.hours) continue;

        const hoursJson = typeof item.hours === 'string' ? item.hours : JSON.stringify(item.hours);
        if (dryRun) {
          console.log(`   [DRY] ${venue.name}: ${hoursJson.slice(0, 80)}...`);
          updated++;
        } else {
          db.venues.update(venue.id, {
            operating_hours: hoursJson,
            hours_source: 'llm-knowledge',
            hours_updated_at: new Date().toISOString(),
          });
          console.log(`   ✅ ${venue.name}: hours set`);
          updated++;
        }
      }
    } catch (err) {
      console.log(`   ❌ Hours batch failed: ${err.message}`);
      failed += batch.length;
    }

    if (i + batchSize < venues.length) await sleep(2000);
  }

  console.log(`   Hours — updated: ${updated}, failed: ${failed}`);
  return { updated, failed };
}

module.exports = { enrichPhotos, enrichHours };
