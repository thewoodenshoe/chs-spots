#!/usr/bin/env node
/**
 * seed-live-music.js - One-time insert of Live Music venues
 *
 * For each venue:
 *   1. Check if we already have it in the venues table (reuse photo)
 *   2. If not, geocode via Google Places Text Search to get lat/lng
 *   3. Download a photo from Google Places if needed
 *   4. Insert as a "Live Music" spot
 *
 * Usage: GOOGLE_PLACES_ENABLED=true node scripts/seed-live-music.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const db = require('./utils/db');

// dotenv is optional — env vars may already be set by the shell or PM2
try {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local') });
} catch { /* dotenv not installed in production; env vars set by PM2 */ }

const GOOGLE_MAPS_API_KEY =
  process.env.GOOGLE_PLACES_SERVER_KEY ||
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ||
  process.env.GOOGLE_PLACES_KEY;

const DRY_RUN = process.argv.includes('--dry-run');
const TODAY = new Date().toISOString().split('T')[0];

function log(msg) { console.log(`[seed-live-music] ${msg}`); }

const VENUES = [
  { name: "Charleston Music Hall", address: "37 John St, Charleston, SC 29403", area: "Downtown Charleston", description: "Beautiful historic hall hosting indie, Americana, jazz, symphonic tributes, and comedy.", schedule: "Almost nightly events", website: "https://charlestonmusichall.com" },
  { name: "Music Farm", address: "32 Ann St, Charleston, SC 29403", area: "Downtown Charleston", description: "Rock/indie/electronic focused venue with 650 capacity, hosting mid-tier touring artists.", schedule: "Weekly shows", website: "https://musicfarm.com" },
  { name: "Credit One Stadium", address: "161 Seven Farms Dr, Daniel Island, SC 29492", area: "Daniel Island", description: "Outdoor amphitheater for big pop, country, hip-hop concerts.", schedule: "Seasonal summer series and events", website: "https://creditonestadium.com" },
  { name: "North Charleston Coliseum & PAC", address: "5001 Coliseum Dr, North Charleston, SC 29418", area: "North Charleston", description: "Large arena for big name concerts and intimate performances in the PAC.", schedule: "Year-round events", website: "https://northcharlestoncoliseumpac.com" },
  { name: "Charleston Gaillard Center", address: "95 Calhoun St, Charleston, SC 29401", area: "Downtown Charleston", description: "High-end venue for classical, symphony, international acts, and theater.", schedule: "Year-round performances", website: "https://gaillardcenter.org" },
  { name: "The Riviera", address: "227 King St, Charleston, SC 29401", area: "Downtown Charleston", description: "Intimate 600-seat theater for music, arts, and comedy.", schedule: "Regular shows", website: "https://therivierachs.com" },
  { name: "Charleston Pour House", address: "1977 Maybank Hwy, Charleston, SC 29412", area: "James Island", description: "Independent venue with main room and outdoor deck for daily concerts, jam bands, bluegrass.", schedule: "7 nights a week", website: "https://charlestonpourhouse.com" },
  { name: "The Royal American", address: "970 Morrison Dr, Charleston, SC 29403", area: "Downtown Charleston", description: "Dive bar venue central to local scene, with great food and indie/rock acts.", schedule: "Weekends mainly", website: "https://theroyalamerican.com" },
  { name: "Firefly Distillery", address: "4201 Spruill Ave, North Charleston, SC 29405", area: "North Charleston", description: "Distillery with outdoor concerts, food trucks, and cocktails.", schedule: "Saturdays and big events", website: "https://fireflydistillery.com" },
  { name: "Groovers Charleston", address: "139 Calhoun St Suite A, Charleston, SC 29401", area: "Downtown Charleston", description: "Listening bar with cocktails, live music, and vinyl DJs, reviving 90s scene.", schedule: "Most nights", website: "https://grooverschs.com" },
  { name: "Uptown Social", address: "587 King St, Charleston, SC 29403", area: "Downtown Charleston", description: "Vibrant bar with rooftop, live music or DJs, and bar food.", schedule: "Every night", website: "https://uptownsocialchs.com" },
  { name: "Prohibition", address: "547 King St, Charleston, SC 29403", area: "Downtown Charleston", description: "Speakeasy-style bar with live jazz, singer-songwriters, bluegrass.", schedule: "Daily, brunch and evenings", website: "https://prohibitioncharleston.com" },
  { name: "The Commodore", address: "504 Meeting St, Charleston, SC 29403", area: "Downtown Charleston", description: "Jazz club vibe with live music for dancing, house bands.", schedule: "Tue-Sun evenings", website: "https://thecommodorechs.com" },
  { name: "Henry's on the Market", address: "54 N Market St, Charleston, SC 29401", area: "Downtown Charleston", description: "Historic bar with rooftop, live music in music hall.", schedule: "Nightly", website: "https://henrysonthemarket.com" },
  { name: "Burns Alley Tavern", address: "354 King St, Charleston, SC 29401", area: "Downtown Charleston", description: "Dive bar with occasional rock concerts.", schedule: "Frequent acoustic/jam sets", website: "https://burnsalley.com" },
  { name: "Bar Mash", address: "701 E Bay St, Charleston, SC 29403", area: "Downtown Charleston", description: "Bar with Mash Music Mondays featuring local talent.", schedule: "Mondays + patio shows", website: "https://instagram.com/barmashchs" },
  { name: "The Select", address: "465 Meeting St Suite 120, Charleston, SC 29403", area: "Downtown Charleston", description: "Venue for live music and events.", schedule: "Fri/Sat", website: "https://theselectcharleston.com" },
  { name: "John King Grill & Dueling Pianos", address: "428 King St, Charleston, SC 29403", area: "Downtown Charleston", description: "Bar with dueling pianos and grill.", schedule: "Wed-Sat late", website: "https://johnkinggrill.com" },
  { name: "High Cotton", address: "199 E Bay St, Charleston, SC 29401", area: "Downtown Charleston", description: "Fine dining with nightly jazz/blues.", schedule: "Nightly", website: "https://highcottoncharleston.com" },
  { name: "Forte Jazz Lounge", address: "475 King St, Charleston, SC 29403", area: "Downtown Charleston", description: "New York-style jazz venue with big city sound and southern hospitality.", schedule: "Most nights", website: "https://fortejazzlounge.com" },
  { name: "Hall's Chophouse", address: "434 King St, Charleston, SC 29403", area: "Downtown Charleston", description: "Steakhouse with Sunday Gospel Brunch featuring live music.", schedule: "Sunday brunch", website: "https://hallschophousecharleston.com" },
  { name: "Commonhouse Aleworks", address: "4831 O'Hear Ave, North Charleston, SC 29405", area: "North Charleston", description: "Brewery in Park Circle with rotating local bands.", schedule: "Rotating schedule", website: "https://commonhousealeworks.com" },
  { name: "Iron Rose", address: "75 Wentworth St, Charleston, SC 29401", area: "Downtown Charleston", description: "Restaurant with live music on Thursdays and weekend brunch.", schedule: "Thu + weekends", website: "https://ironroserestaurant.com" },
  { name: "Whiskey Jack's", address: "2199 Savannah Hwy, Charleston, SC 29407", area: "West Ashley", description: "Bar with live music.", schedule: "Tue/Fri/Sat", website: null },
  { name: "Martin's BBQ", address: "1622 Highland Ave, Charleston, SC 29412", area: "James Island", description: "BBQ joint with live music.", schedule: "Friday evenings", website: "https://martinsbbqjoint.com" },
  { name: "Awendaw Green", address: "4853 US-17 N, Awendaw, SC 29429", area: "Mount Pleasant", description: "Outdoor barn/field venue with free shows, family-friendly.", schedule: "Wednesday nights", website: "https://awendawgreen.com" },
  { name: "Dockery's", address: "880 Island Park Dr, Daniel Island, SC 29492", area: "Daniel Island", description: "Brewery with live music most weekends.", schedule: "Most weekends", website: "https://dockerysdi.com" },
  { name: "New Realm Brewing", address: "880 Island Park Dr, Daniel Island, SC 29492", area: "Daniel Island", description: "Brewery with patio shows.", schedule: "Regular events", website: "https://newrealmbrewing.com" },
  { name: "The Windjammer", address: "1008 Ocean Blvd, Isle of Palms, SC 29451", area: "Sullivan's & IOP", description: "Beach bar with live music.", schedule: "Almost every night", website: "https://the-windjammer.com" },
];

// ── Google Places helpers ──────────────────────────────────────

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
  const query = encodeURIComponent(`${name} ${address}`);
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&key=${GOOGLE_MAPS_API_KEY}`;
  const data = await fetchJson(url);
  if (!data.results || data.results.length === 0) return null;
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

// ── Main ───────────────────────────────────────────────────────

async function main() {
  const database = db.getDb();

  // Ensure Live Music activity exists
  db.activities.upsert({ name: 'Live Music', icon: 'Music', emoji: '🎵', color: '#e11d48', community_driven: 0 });
  log('Activity "Live Music" ensured in database');

  // Load existing venues for photo reuse
  const allVenues = db.venues.getAll();
  const venuesByName = new Map();
  for (const v of allVenues) {
    venuesByName.set(v.name?.toLowerCase(), v);
  }

  // Check for existing Live Music spots to avoid duplicates
  const existingSpots = database.prepare(
    "SELECT title FROM spots WHERE type = 'Live Music' AND status = 'approved'"
  ).all();
  const existingTitles = new Set(existingSpots.map(s => s.title.toLowerCase()));

  let inserted = 0;
  let skipped = 0;
  let photoCount = 0;

  for (const venue of VENUES) {
    if (existingTitles.has(venue.name.toLowerCase())) {
      log(`  SKIP (exists): ${venue.name}`);
      skipped++;
      continue;
    }

    // Try to find existing venue for photo reuse
    const existingVenue = venuesByName.get(venue.name.toLowerCase());
    let lat, lng, placeId, photoUrl;

    if (existingVenue) {
      lat = existingVenue.lat;
      lng = existingVenue.lng;
      placeId = existingVenue.id;
      if (existingVenue.photo_url) {
        const fullPath = path.join(__dirname, '..', 'public', existingVenue.photo_url);
        photoUrl = fs.existsSync(fullPath) ? existingVenue.photo_url : null;
      }
      log(`  REUSE venue: ${venue.name} (${existingVenue.id})`);
    } else {
      if (!GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_ENABLED !== 'true') {
        log(`  SKIP (no API): ${venue.name}`);
        skipped++;
        continue;
      }
      const geo = await geocode(venue.name, venue.address);
      if (!geo) {
        log(`  SKIP (geocode failed): ${venue.name}`);
        skipped++;
        continue;
      }
      lat = geo.lat;
      lng = geo.lng;
      placeId = geo.placeId;
      log(`  GEOCODED: ${venue.name} → ${lat}, ${lng}`);
      await sleep(200);
    }

    if (DRY_RUN) {
      log(`  DRY RUN: would insert ${venue.name} at ${lat}, ${lng}`);
      inserted++;
      continue;
    }

    const spotId = db.spots.insert({
      venue_id: existingVenue?.id || null,
      title: venue.name,
      type: 'Live Music',
      source: 'manual',
      status: 'approved',
      description: venue.description,
      promotion_time: venue.schedule,
      source_url: venue.website,
      lat,
      lng,
      area: venue.area,
      last_update_date: TODAY,
    });

    // Download photo if we don't have one yet
    if (!photoUrl && placeId) {
      try {
        photoUrl = await fetchPlacePhoto(placeId, spotId);
        if (photoUrl) {
          database.prepare("UPDATE spots SET photo_url = ? WHERE id = ?").run(photoUrl, spotId);
          photoCount++;
        }
        await sleep(300);
      } catch (e) {
        log(`  Photo download failed for ${venue.name}: ${e.message}`);
      }
    } else if (photoUrl) {
      database.prepare("UPDATE spots SET photo_url = ? WHERE id = ?").run(photoUrl, spotId);
      photoCount++;
    }

    log(`  INSERT #${spotId}: ${venue.name} (${venue.area})`);
    inserted++;
  }

  log(`\nDone: ${inserted} inserted, ${skipped} skipped, ${photoCount} photos`);
  if (DRY_RUN) log('(DRY RUN — nothing was written)');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
