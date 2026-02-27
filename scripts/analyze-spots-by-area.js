#!/usr/bin/env node
/**
 * Analyze spots by area - Happy Hour and Brunch coverage
 * Usage: node scripts/analyze-spots-by-area.js
 */

const fs = require('fs');
const path = require('path');
const { reportingPath } = require('./utils/data-dir');
const db = require('./utils/db');

const SPOTS_PATH = reportingPath('spots.json');
const VENUES_PATH = reportingPath('venues.json');

function main() {
  let spots, venues;
  try {
    db.ensureSchema();
    const dbSpots = db.spots.getAll();
    const dbVenues = db.venues.getAll();
    if (dbSpots.length > 0 && dbVenues.length > 0) {
      spots = dbSpots.map(s => ({
        ...s,
        venueId: s.venue_id,
        activity: s.type,
        promotionList: s.promotion_list ? JSON.parse(s.promotion_list) : null,
      }));
      venues = dbVenues.map(v => ({
        ...v,
        types: v.types ? JSON.parse(v.types) : [],
      }));
      console.log(`(Using SQLite: ${spots.length} spots, ${venues.length} venues)`);
    } else {
      throw new Error('DB empty, falling back to JSON');
    }
  } catch (e) {
    spots = JSON.parse(fs.readFileSync(SPOTS_PATH, 'utf8'));
    venues = JSON.parse(fs.readFileSync(VENUES_PATH, 'utf8'));
    console.log(`(Using JSON files: ${spots.length} spots, ${venues.length} venues)`);
  }

  const venueById = new Map(venues.map((v) => [v.id, v]));

  const byArea = {};
  for (const spot of spots) {
    if (spot.source === 'manual' && !spot.venueId) continue;
    const venueId = spot.venueId;
    const venue = venueById.get(venueId);
    const area = venue?.area || 'Unknown';
    if (!byArea[area]) {
      byArea[area] = { happyHour: 0, brunch: 0, other: 0, total: 0 };
    }
    byArea[area].total++;
    const type = (spot.type || spot.activity || '').trim();
    if (type === 'Happy Hour') byArea[area].happyHour++;
    else if (type === 'Brunch') byArea[area].brunch++;
    else byArea[area].other++;
  }

  const areas = [
    'Daniel Island',
    'Mount Pleasant',
    'Downtown Charleston',
    "Sullivan's & IOP",
    'North Charleston',
    'West Ashley',
    'James Island'
  ];

  console.log('\n📊 Spots by Area (Happy Hour & Brunch)\n');
  console.log('─'.repeat(60));
  let hasAllHH = true;
  let hasAllBrunch = true;
  for (const area of areas) {
    const stats = byArea[area] || { happyHour: 0, brunch: 0, other: 0, total: 0 };
    const hh = stats.happyHour;
    const br = stats.brunch;
    const tot = stats.total;
    if (hh === 0) hasAllHH = false;
    if (br === 0) hasAllBrunch = false;
    const hhOk = hh > 0 ? '✓' : '✗';
    const brOk = br > 0 ? '✓' : '✗';
    console.log(
      `${area.padEnd(22)} | HH: ${String(hh).padStart(3)} ${hhOk} | Brunch: ${String(br).padStart(3)} ${brOk} | Total: ${tot}`
    );
  }
  console.log('─'.repeat(60));
  console.log(`\n✅ All areas have Happy Hour spots: ${hasAllHH ? 'Yes' : 'No'}`);
  console.log(`✅ All areas have Brunch spots:     ${hasAllBrunch ? 'Yes' : 'No'}`);

  const totalHH = Object.values(byArea).reduce((s, a) => s + a.happyHour, 0);
  const totalBr = Object.values(byArea).reduce((s, a) => s + a.brunch, 0);
  console.log(`\n📈 Grand totals: Happy Hour ${totalHH} | Brunch ${totalBr}`);
  console.log('');
}

main();
