#!/usr/bin/env node

/**
 * Migrate existing JSON file data into the SQLite database.
 *
 * Reads from DATA_DIR (or project data/) and populates all tables.
 * Idempotent: safe to re-run (uses INSERT OR REPLACE / upserts).
 *
 * Usage: node scripts/migrate-to-sqlite.js
 */

const fs = require('fs');
const path = require('path');
const db = require('./utils/db');

const dataRoot = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
const configDir = path.join(dataRoot, 'config');
const reportingDir = path.join(dataRoot, 'reporting');
const goldDir = path.join(dataRoot, 'gold');

function log(msg) { console.log(msg); }

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function main() {
  log('=== CHS Spots: JSON → SQLite Migration ===\n');
  log(`Data root:  ${dataRoot}`);
  log(`DB path:    ${db.getDbPath()}\n`);

  // 1. Create schema
  log('1. Creating schema...');
  db.ensureSchema();
  log('   Done.\n');

  // 2. Migrate areas
  log('2. Migrating areas...');
  const areasData = readJson(path.join(configDir, 'areas.json'));
  let areasCount = 0;
  if (areasData && Array.isArray(areasData)) {
    for (const area of areasData) {
      db.areas.upsert(area);
      areasCount++;
    }
  }
  log(`   ${areasCount} area(s) migrated.\n`);

  // 3. Migrate activities
  log('3. Migrating activities...');
  const activitiesData = readJson(path.join(configDir, 'activities.json'));
  let activitiesCount = 0;
  if (activitiesData && Array.isArray(activitiesData)) {
    for (const activity of activitiesData) {
      db.activities.upsert(activity);
      activitiesCount++;
    }
  }
  log(`   ${activitiesCount} activity/ies migrated.\n`);

  // 4. Migrate venues
  log('4. Migrating venues...');
  const venuesPath = fs.existsSync(path.join(reportingDir, 'venues.json'))
    ? path.join(reportingDir, 'venues.json')
    : path.join(dataRoot, 'venues.json');
  const venuesData = readJson(venuesPath);
  let venuesCount = 0;
  if (venuesData && Array.isArray(venuesData)) {
    const txn = db.getDb().transaction(() => {
      for (const v of venuesData) {
        const venueId = v.id || v.place_id;
        if (!venueId) continue;
        db.venues.upsert({
          id: venueId,
          name: v.name,
          address: v.address || v.formatted_address || null,
          lat: v.lat || v.geometry?.location?.lat,
          lng: v.lng || v.geometry?.location?.lng,
          area: v.area || null,
          website: v.website || null,
          photo_url: v.photoUrl || (v.photos?.[0]?.photo_reference) || null,
          types: v.types || null,
          raw_google_data: v,
        });
        venuesCount++;
      }
    });
    txn();
  }
  log(`   ${venuesCount} venue(s) migrated. DB count: ${db.venues.count()}\n`);

  // 5. Migrate watchlist
  log('5. Migrating watchlist...');
  const watchlistData = readJson(path.join(configDir, 'venue-watchlist.json'));
  let watchlistCount = 0;
  if (watchlistData && watchlistData.venues) {
    const txn = db.getDb().transaction(() => {
      for (const [venueId, entry] of Object.entries(watchlistData.venues)) {
        db.watchlist.upsert({
          venue_id: venueId,
          name: entry.name || null,
          area: entry.area || null,
          status: entry.status,
          reason: entry.reason || null,
        });
        watchlistCount++;
      }
    });
    txn();
  }
  log(`   ${watchlistCount} watchlist entry/ies migrated. DB count: ${db.watchlist.count()}\n`);

  // 6. Migrate gold extractions
  log('6. Migrating gold extractions...');
  let goldCount = 0;
  if (fs.existsSync(goldDir)) {
    const goldFiles = fs.readdirSync(goldDir)
      .filter(f => f.endsWith('.json') && f !== 'bulk-results.json' && f !== '.bulk-complete');
    const txn = db.getDb().transaction(() => {
      for (const file of goldFiles) {
        try {
          const data = readJson(path.join(goldDir, file));
          if (!data || !data.venueId) continue;
          const promos = data.promotions || data.happyHour || {};
          db.gold.upsert({
            venue_id: data.venueId,
            venue_name: data.venueName || null,
            promotions: promos,
            source_hash: data.sourceHash || null,
            normalized_source_hash: data.normalizedSourceHash || null,
            processed_at: data.processedAt || null,
          });
          goldCount++;
        } catch (err) {
          log(`   Warning: skipping ${file}: ${err.message}`);
        }
      }
    });
    txn();
  }
  log(`   ${goldCount} gold extraction(s) migrated. DB count: ${db.gold.count()}\n`);

  // 7. Migrate spots
  log('7. Migrating spots...');
  const spotsData = readJson(path.join(reportingDir, 'spots.json'));
  let spotsCount = 0;
  if (spotsData && Array.isArray(spotsData)) {
    // Clear automated non-overridden spots first, then re-insert all
    db.getDb().prepare('DELETE FROM spots').run();

    const txn = db.getDb().transaction(() => {
      for (const s of spotsData) {
        db.getDb().prepare(`
          INSERT INTO spots (id, venue_id, title, type, source, status, description,
            promotion_time, promotion_list, source_url, submitter_name,
            manual_override, photo_url, last_update_date, pending_edit,
            pending_delete, submitted_at, edited_at, updated_at)
          VALUES (@id, @venue_id, @title, @type, @source, @status, @description,
            @promotion_time, @promotion_list, @source_url, @submitter_name,
            @manual_override, @photo_url, @last_update_date, @pending_edit,
            @pending_delete, @submitted_at, @edited_at, datetime('now'))
        `).run({
          id: s.id,
          venue_id: s.venueId || null,
          title: s.title,
          type: s.type || s.activity || 'Happy Hour',
          source: s.source || 'automated',
          status: s.status || 'approved',
          description: s.description || null,
          promotion_time: s.promotionTime || s.happyHourTime || null,
          promotion_list: s.promotionList || s.happyHourList
            ? JSON.stringify(s.promotionList || s.happyHourList)
            : null,
          source_url: s.sourceUrl || null,
          submitter_name: s.submitterName || null,
          manual_override: s.manualOverride ? 1 : 0,
          photo_url: s.photoUrl || null,
          last_update_date: s.lastUpdateDate || null,
          pending_edit: s.pendingEdit ? JSON.stringify(s.pendingEdit) : null,
          pending_delete: s.pendingDelete ? 1 : 0,
          submitted_at: s.submittedAt || null,
          edited_at: s.editedAt || null,
        });
        spotsCount++;
      }
    });
    txn();
  }
  log(`   ${spotsCount} spot(s) migrated. DB count: ${db.spots.count()}\n`);

  // 8. Migrate pipeline state (config.json)
  log('8. Migrating pipeline state...');
  const configData = readJson(path.join(configDir, 'config.json'));
  if (configData) {
    db.config.saveConfig(configData);
  }
  log(`   Done.\n`);

  // 9. Migrate update streaks
  log('9. Migrating update streaks...');
  const streaksData = readJson(path.join(reportingDir, 'update-streaks.json'));
  let streaksCount = 0;
  if (streaksData && typeof streaksData === 'object') {
    for (const [key, entry] of Object.entries(streaksData)) {
      const parts = key.split('::');
      if (parts.length === 2) {
        db.streaks.upsert(parts[0], parts[1], entry.name, entry.lastDate, entry.streak || 1);
        streaksCount++;
      }
    }
  }
  log(`   ${streaksCount} streak(s) migrated.\n`);

  // 10. Record schema version
  log('10. Recording schema version...');
  db.getDb().prepare(`
    INSERT OR REPLACE INTO schema_version (version, description)
    VALUES (1, 'Initial migration from JSON files')
  `).run();
  log(`    Version 1 recorded.\n`);

  // Summary
  log('=== Migration Complete ===');
  log(`  Venues:      ${db.venues.count()}`);
  log(`  Spots:       ${db.spots.count()}`);
  log(`  Gold:        ${db.gold.count()}`);
  log(`  Areas:       ${db.areas.getAll().length}`);
  log(`  Activities:  ${db.activities.getAll().length}`);
  log(`  Watchlist:   ${db.watchlist.count()}`);
  log(`  DB file:     ${db.getDbPath()}`);
  log(`  DB size:     ${(fs.statSync(db.getDbPath()).size / 1024 / 1024).toFixed(2)} MB`);

  db.closeDb();
}

main();
