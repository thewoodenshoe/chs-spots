/**
 * Create Spots from Gold Extracted Data
 * 
 * Reads gold extractions and venues from the SQLite database to create spots.
 * Only creates spots for venues with promotions.found === true.
 * 
 * Input:
 * - gold_extractions table (extracted happy hour data)
 * - venues table (venue coordinates and metadata)
 * 
 * Output:
 * - spots table (spots for frontend)
 * - data/reporting/spots.json (dual-write for backward compat)
 * 
 * Run with: node scripts/create-spots.js
 */

const fs = require('fs');
const path = require('path');
const db = require('./utils/db');
const { loadConfig } = require('./utils/config');
const { dataPath, reportingPath, configPath, getDataRoot } = require('./utils/data-dir');

// Logging setup
const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logPath = path.join(logDir, 'create-spots.log');

fs.writeFileSync(logPath, '', 'utf8');

function log(message) {
  const ts = new Date().toISOString();
  console.log(message);
  fs.appendFileSync(logPath, `[${ts}] ${message}\n`);
}

// Paths — dual-write destinations, kept for backward compat during transition
const REPORTING_VENUES_PATH = reportingPath('venues.json');
const LEGACY_VENUES_PATH = dataPath('venues.json');
const VENUES_PATH = fs.existsSync(REPORTING_VENUES_PATH) ? REPORTING_VENUES_PATH : LEGACY_VENUES_PATH;
const AREAS_PATH = configPath('areas.json');
const REPORTING_DIR = path.join(getDataRoot(), 'reporting');
const SPOTS_PATH = reportingPath('spots.json');
const REPORTING_AREAS_PATH = reportingPath('areas.json');

const RAW_PREVIOUS_DIR = dataPath('raw', 'previous');
const RAW_TODAY_DIR = dataPath('raw', 'today');
const SILVER_MERGED_PREVIOUS_DIR = dataPath('silver_merged', 'previous');
const SILVER_MERGED_TODAY_DIR = dataPath('silver_merged', 'today');
const SILVER_TRIMMED_PREVIOUS_DIR = dataPath('silver_trimmed', 'previous');
const SILVER_TRIMMED_TODAY_DIR = dataPath('silver_trimmed', 'today');
const SILVER_TRIMMED_INCREMENTAL_DIR = dataPath('silver_trimmed', 'incremental');

/**
 * Format happy hour description from gold data
 * Creates a structured description with proper formatting for display
 */
function formatHappyHourDescription(happyHour) {
  const lines = [];
  
  // Time and days together on first line
  if (happyHour.times || happyHour.days) {
    const timeDayParts = [];
    if (happyHour.times && happyHour.times.trim()) {
      timeDayParts.push(happyHour.times.trim());
    }
    if (happyHour.days && happyHour.days.trim()) {
      timeDayParts.push(happyHour.days.trim());
    }
    if (timeDayParts.length > 0) {
      lines.push(timeDayParts.join(' • '));
    }
  }
  
  // Specials as separate lines (one per special)
  if (happyHour.specials && happyHour.specials.length > 0) {
    for (const special of happyHour.specials) {
      if (special && special.trim()) {
        lines.push(special.trim());
      }
    }
  }
  
  // If we only have a time with no days or specials, it's incomplete data
  // Don't create a meaningless description like "2pm"
  if (lines.length === 1 && happyHour.times && !happyHour.days && 
      (!happyHour.specials || happyHour.specials.length === 0)) {
    // This is incomplete - return null to indicate we shouldn't create a spot
    return null;
  }
  
  // If no content but has source, add placeholder
  if (lines.length === 0 && happyHour.source) {
    lines.push('Happy Hour details available');
  }
  
  // Join with newlines (will be preserved in display)
  return lines.length > 0 ? lines.join('\n') : 'Happy Hour available';
}

/**
 * Build time/specials/source from a group of entries for one activity type.
 */
/**
 * Normalize LLM placeholder strings to null.
 */
function normalizeField(val) {
  if (!val || typeof val !== 'string') return null;
  const lower = val.trim().toLowerCase();
  if (lower === 'not specified' || lower === 'unknown' || lower === 'n/a' || lower === '') return null;
  return val.trim();
}

function buildSpotFields(entries) {
  let promotionTime = null;
  let promotionList = [];
  let sourceUrl = null;

  if (entries.length === 1) {
    const entry = entries[0];
    const times = normalizeField(entry.times);
    const days = normalizeField(entry.days);
    if (times) {
      promotionTime = days ? `${times} • ${days}` : times;
    } else if (days) {
      promotionTime = days;
    }
    promotionList = entry.specials || [];
    sourceUrl = entry.source || null;
  } else if (entries.length > 1) {
    const timeParts = [];
    const allSpecials = [];
    const sources = [];

    for (const entry of entries) {
      const times = normalizeField(entry.times);
      const days = normalizeField(entry.days);
      if (times || days) {
        const label = entry.label ? `${entry.label}: ` : '';
        const timeStr = days
          ? `${label}${times || ''} • ${days}`.replace(/^\s*•\s*/, '')
          : `${label}${times}`;
        if (!timeParts.includes(timeStr)) {
          timeParts.push(timeStr);
        }
      }
      if (entry.specials && Array.isArray(entry.specials)) {
        const prefix = entries.length > 1 && entry.label ? `[${entry.label}] ` : '';
        allSpecials.push(...entry.specials.map(s => `${prefix}${s}`));
      }
      if (entry.source && !sources.includes(entry.source)) {
        sources.push(entry.source);
      }
    }

    promotionTime = timeParts.length > 0 ? timeParts.join(', ') : null;
    promotionList = allSpecials;
    sourceUrl = sources.length > 0 ? sources[0] : null;
  }

  return { promotionTime, promotionList, sourceUrl };
}

/**
 * Create spots from gold data and venue data.
 * Returns an ARRAY of spots — one per activity type found.
 * A single venue can produce both a "Happy Hour" spot and a "Brunch" spot.
 *
 * Handles:
 *  - New format with entries[] and activityType per entry
 *  - Old format without activityType (defaults to "Happy Hour")
 *  - Legacy format with direct properties (no entries array)
 */
function createSpots(goldData, venueData, startId) {
  const happyHour = goldData.promotions || goldData.happyHour || {};

  if (!happyHour.found) {
    return [];
  }

  // Normalize all formats into an entries array
  let entries = [];
  if (happyHour.entries && Array.isArray(happyHour.entries) && happyHour.entries.length > 0) {
    entries = happyHour.entries;
  } else if (happyHour.times || happyHour.days || happyHour.specials) {
    // Legacy format: direct properties
    entries = [{
      activityType: 'Happy Hour',
      times: happyHour.times,
      days: happyHour.days,
      specials: happyHour.specials || [],
      source: happyHour.source
    }];
  } else {
    return [];
  }

  // Filter out very low-confidence entries and entries with no usable data
  entries = entries.filter(entry => {
    // Skip very low confidence (< 40) — these are almost always false positives
    if (entry.confidence !== undefined && entry.confidence < 40) {
      return false;
    }
    // Normalize "Not specified" / empty strings to null for filtering
    const times = entry.times && entry.times !== 'Not specified' ? entry.times : null;
    const days = entry.days && entry.days !== 'Not specified' ? entry.days : null;
    const specials = entry.specials && Array.isArray(entry.specials) && entry.specials.length > 0 ? entry.specials : null;
    // Need at least one usable field
    if (!times && !days && !specials) {
      return false;
    }
    return true;
  });

  if (entries.length === 0) {
    return [];
  }

  // Group entries by activityType (default to "Happy Hour" for backwards compat)
  const grouped = {};
  for (const entry of entries) {
    const activityType = entry.activityType || 'Happy Hour';
    if (!grouped[activityType]) {
      grouped[activityType] = [];
    }
    grouped[activityType].push(entry);
  }

  // Create one spot per activity type
  const spots = [];
  let idOffset = 0;

  for (const [activityType, groupEntries] of Object.entries(grouped)) {
    const { promotionTime, promotionList, sourceUrl } = buildSpotFields(groupEntries);

    // Need at least time or specials to create a spot
    if (!promotionTime && (!promotionList || promotionList.length === 0)) {
      continue;
    }

    // Build backwards-compatible description
    let description = null;
    if (groupEntries.length === 1) {
      description = formatHappyHourDescription(groupEntries[0]);
    } else if (groupEntries.length > 1) {
      const entryDescriptions = groupEntries
        .map(entry => formatHappyHourDescription(entry))
        .filter(desc => desc !== null);
      if (entryDescriptions.length > 0) {
        description = entryDescriptions.join('\n\n---\n\n');
      }
    }

    const spot = {
      id: startId + idOffset,
      lat: venueData.lat || venueData.geometry?.location?.lat,
      lng: venueData.lng || venueData.geometry?.location?.lng,
      title: goldData.venueName || venueData.name || 'Unknown Venue',
      description: description,
      // Generic fields
      promotionTime: promotionTime,
      promotionList: promotionList,
      // Legacy fields (backwards compat)
      happyHourTime: promotionTime,
      happyHourList: promotionList,
      sourceUrl: sourceUrl || venueData.website || null,
      lastUpdateDate: goldData.processedAt || null,
      type: activityType,
      area: venueData.area || 'Unknown',
      source: 'automated',
      venueId: goldData.venueId || undefined,
    };

    // Add photoUrl if available from venue
    if (venueData.photoUrl) {
      spot.photoUrl = venueData.photoUrl;
    } else if (venueData.photos && venueData.photos.length > 0) {
      spot.photoUrl = venueData.photos[0].photo_reference;
    }

    spots.push(spot);
    idOffset++;
  }

  return spots;
}

/**
 * Main function
 */
function main() {
  log('🔄 Creating Spots from Gold Data\n');

  db.ensureSchema();

  // Ensure reporting directory exists (for dual-write during transition)
  if (!fs.existsSync(REPORTING_DIR)) {
    fs.mkdirSync(REPORTING_DIR, { recursive: true });
    log(`📁 Created reporting directory: ${REPORTING_DIR}\n`);
  }

  // ── Load venues from DB ───────────────────────────────────────
  const venueRows = db.venues.getAll();
  if (venueRows.length === 0) {
    log('❌ No venues found in database');
    log('   Run seed-venues.js first');
    process.exit(1);
  }

  const venueMap = new Map();
  for (const row of venueRows) {
    venueMap.set(row.id, { ...row, photoUrl: row.photo_url });
  }
  log(`📁 Loaded ${venueRows.length} venue(s) from database\n`);

  // Helper: map a DB spot row to the camelCase shape the pipeline expects
  function mapSpotFromDb(row) {
    const venue = venueMap.get(row.venue_id);
    return {
      id: row.id,
      lat: venue?.lat,
      lng: venue?.lng,
      venueId: row.venue_id,
      title: row.title,
      type: row.type,
      source: row.source,
      status: row.status,
      area: venue?.area || 'Unknown',
      description: row.description,
      promotionTime: row.promotion_time,
      promotionList: row.promotion_list ? JSON.parse(row.promotion_list) : [],
      happyHourTime: row.promotion_time,
      happyHourList: row.promotion_list ? JSON.parse(row.promotion_list) : [],
      sourceUrl: row.source_url,
      manualOverride: !!row.manual_override,
      photoUrl: row.photo_url || venue?.photo_url,
      lastUpdateDate: row.last_update_date,
    };
  }

  // ── Load gold extractions from DB ─────────────────────────────
  const goldRows = db.gold.getAll();
  log(`📁 Found ${goldRows.length} gold extraction(s) in database\n`);

  if (goldRows.length === 0) {
    log('⚠️  No gold extractions found.');
    db.spots.deleteAutomated();
    const remaining = db.spots.getAll().map(mapSpotFromDb);
    fs.writeFileSync(SPOTS_PATH, JSON.stringify(remaining, null, 2), 'utf8');
    log('\n✨ Done! No automated spots created.');
    return;
  }

  // ── Load existing spots from DB for comparison / preservation ─
  const existingSpotRows = db.spots.getAll();
  const existingSpots = existingSpotRows.map(mapSpotFromDb);

  const manualSpots = existingSpots.filter(s => s.source === 'manual');
  const overriddenSpots = existingSpots.filter(s => s.source === 'automated' && s.manualOverride);
  const overriddenKeys = new Set(overriddenSpots.map(s => `${s.venueId}::${s.type}`));

  if (manualSpots.length > 0) {
    log(`📋 Found ${manualSpots.length} manual spot(s) — will be preserved`);
  }
  if (overriddenSpots.length > 0) {
    log(`✏️  Found ${overriddenSpots.length} user-edited automated spot(s) — will be preserved\n`);
  }

  // ── Build new automated spots ─────────────────────────────────
  const newAutomatedSpots = [];
  let processed = 0;
  let skipped = 0;
  let missingVenue = 0;
  let noHappyHour = 0;
  let incompleteData = 0;

  const excludedIds = db.watchlist.getExcludedIds();
  let excludedCount = 0;

  const seenKeys = new Set(overriddenKeys);

  for (const row of goldRows) {
    try {
      const goldData = {
        venueId: row.venue_id,
        venueName: row.venue_name,
        promotions: typeof row.promotions === 'string' ? JSON.parse(row.promotions) : row.promotions,
        processedAt: row.processed_at,
      };

      const venueId = goldData.venueId;
      if (!venueId) {
        skipped++;
        log('  ⚠️  Skipping: Missing venueId in gold extraction');
        continue;
      }

      const venueData = venueMap.get(venueId);
      if (!venueData) {
        missingVenue++;
        log(`  ⚠️  Skipping: Venue not found in database: ${venueId}`);
        continue;
      }

      if (excludedIds.has(venueId)) {
        excludedCount++;
        continue;
      }

      const promoData = goldData.promotions || {};
      if (!promoData.found) {
        noHappyHour++;
        continue;
      }

      const newSpots = createSpots(goldData, venueData, 0);

      if (newSpots.length > 0) {
        for (const spot of newSpots) {
          const key = `${venueId}::${spot.type}`;

          if (seenKeys.has(key)) {
            skipped++;
            if (overriddenKeys.has(key)) {
              log(`  ⏭️  Skipping ${spot.title} [${spot.type}] — user-edited override preserved`);
            }
            continue;
          }

          if (!spot.lat || !spot.lng) {
            log(`  ⚠️  Skipping: Missing coordinates for ${goldData.venueName} (${venueId})`);
            skipped++;
            continue;
          }

          seenKeys.add(key);
          newAutomatedSpots.push(spot);
          processed++;
          log(`  ✅ Created spot: ${spot.title} [${spot.type}]`);
        }
      } else {
        incompleteData++;
      }

    } catch (error) {
      log(`  ❌ Error processing gold extraction for ${row.venue_id}: ${error.message}`);
      skipped++;
    }
  }

  // ── Detect content changes vs previous spots (streak tracking) ─
  const oldSpotMap = new Map();
  for (const s of existingSpots) {
    if (s.source === 'automated' && s.venueId) {
      oldSpotMap.set(`${s.venueId}::${s.type}`, s);
    }
  }

  const todayStr = new Date().toISOString().split('T')[0];
  const updatedSpotNames = [];

  for (const spot of newAutomatedSpots) {
    if (!spot.venueId) continue;
    const key = `${spot.venueId}::${spot.type}`;
    const old = oldSpotMap.get(key);
    const isContentChange = !old
      || spot.promotionTime !== old.promotionTime
      || JSON.stringify(spot.promotionList) !== JSON.stringify(old.promotionList);

    if (isContentChange) {
      const prev = db.streaks.get(spot.venueId, spot.type);
      let newStreak = 1;
      if (prev && prev.last_date) {
        const prevDate = new Date(prev.last_date);
        const today = new Date(todayStr);
        const diffDays = Math.round((today - prevDate) / 86400000);
        newStreak = diffDays <= 1 ? (prev.streak || 0) + 1 : 1;
      }
      db.streaks.upsert(spot.venueId, spot.type, `${spot.title} [${spot.type}]`, todayStr, newStreak);
      updatedSpotNames.push(`${spot.title} [${spot.type}]`);
      log(`  🔄 Updated spot: ${spot.title} [${spot.type}]`);
    }
  }

  log(`\n📈 Content changes this run: ${updatedSpotNames.length}`);

  // ── Write to DB: delete old automated spots, insert new ones ──
  const deletedCount = db.spots.deleteAutomated();
  log(`🗑️  Cleared ${deletedCount} old automated spot(s) from database`);

  for (const spot of newAutomatedSpots) {
    const newId = db.spots.insert(spot);
    spot.id = newId;
  }
  log(`💾 Inserted ${newAutomatedSpots.length} automated spot(s) into database`);

  // Complete in-memory spots array (manual + overridden preserved in DB, new automated just inserted)
  const spots = [...manualSpots, ...overriddenSpots, ...newAutomatedSpots];

  // ── Dual-write: spots.json (backward compat during transition) ─
  fs.writeFileSync(SPOTS_PATH, JSON.stringify(spots, null, 2), 'utf8');
  log(`\n✅ Created ${SPOTS_PATH}`);

  // Dual-write: copy venues.json and areas.json to reporting folder
  if (fs.existsSync(VENUES_PATH)) {
    fs.copyFileSync(VENUES_PATH, REPORTING_VENUES_PATH);
    log(`✅ Copied venues.json to ${REPORTING_VENUES_PATH}`);
  }
  if (fs.existsSync(AREAS_PATH)) {
    fs.copyFileSync(AREAS_PATH, REPORTING_AREAS_PATH);
    log(`✅ Copied areas.json to ${REPORTING_AREAS_PATH}`);
  }

  // Summary
  const existingAutomatedCount = existingSpots.filter(s => s.source === 'automated').length;
  const totalAutomatedCount = spots.filter(s => s.source === 'automated').length;
  
  // Get pipeline state and file counts
  const config = loadConfig();
  const todayDate = config.run_date || 'N/A';
  const previousDate = config.last_raw_processed_date || 'N/A';
  
  // Helper function to count directories (for raw) or files (for silver layers)
  function countDirectories(dirPath) {
    if (!fs.existsSync(dirPath)) return 0;
    try {
      return fs.readdirSync(dirPath).filter(item => {
        const itemPath = path.join(dirPath, item);
        return fs.statSync(itemPath).isDirectory();
      }).length;
    } catch {
      return 0;
    }
  }
  
  function countFiles(dirPath) {
    if (!fs.existsSync(dirPath)) return 0;
    try {
      return fs.readdirSync(dirPath).filter(item => {
        const itemPath = path.join(dirPath, item);
        return fs.statSync(itemPath).isFile() && item.endsWith('.json');
      }).length;
    } catch {
      return 0;
    }
  }
  
  const rawPreviousCount = countDirectories(RAW_PREVIOUS_DIR);
  const rawTodayCount = countDirectories(RAW_TODAY_DIR);
  // Note: raw/incremental/ and silver_merged/incremental/ are no longer used
  const rawIncrementalCount = 0; // Obsolete - not used anymore
  const silverMergedPreviousCount = countFiles(SILVER_MERGED_PREVIOUS_DIR);
  const silverMergedTodayCount = countFiles(SILVER_MERGED_TODAY_DIR);
  const silverMergedIncrementalCount = 0; // Obsolete - not used anymore
  const silverTrimmedPreviousCount = countFiles(SILVER_TRIMMED_PREVIOUS_DIR);
  const silverTrimmedTodayCount = countFiles(SILVER_TRIMMED_TODAY_DIR);
  const silverTrimmedIncrementalCount = countFiles(SILVER_TRIMMED_INCREMENTAL_DIR);
  
  log(`\n📅 Pipeline State:`);
  log(`   📆 Today's date: ${todayDate}`);
  log(`   📆 Previous date: ${previousDate}`);
  log(`   📁 Raw previous count: ${rawPreviousCount}`);
  log(`   📁 Raw today count: ${rawTodayCount}`);
  log(`   📁 Raw incremental count: ${rawIncrementalCount}`);
  log(`   📦 Silver merged previous count: ${silverMergedPreviousCount}`);
  log(`   📦 Silver merged today count: ${silverMergedTodayCount}`);
  log(`   📦 Silver merged incremental count: ${silverMergedIncrementalCount}`);
  log(`   ✂️  Silver trimmed previous count: ${silverTrimmedPreviousCount}`);
  log(`   ✂️  Silver trimmed today count: ${silverTrimmedTodayCount}`);
  log(`   ✂️  Silver trimmed incremental count: ${silverTrimmedIncrementalCount}`);
  
  log(`\n📊 Summary:`);
  log(`   ✅ New automated spots created: ${processed}`);
  log(`   📋 Existing automated spots preserved: ${existingAutomatedCount}`);
  log(`   👤 Manual spots preserved: ${manualSpots.length}`);
  log(`   ⚠️  Skipped (already exists): ${skipped}`);
  if (excludedCount > 0) log(`   🚫 Excluded (watchlist): ${excludedCount}`);
  log(`   ❌ Missing venue data: ${missingVenue}`);
  log(`   ℹ️  No happy hour: ${noHappyHour}`);
  log(`   📋 Incomplete data: ${incompleteData} (time only, no days/specials)`);
  log(`   📄 Total spots in spots.json: ${spots.length} (${manualSpots.length} manual + ${totalAutomatedCount} automated)`);
  log(`\n✨ Done! Updated reporting folder with spots.json, venues.json, and areas.json`);
  log(`   Total spots: ${spots.length} (${manualSpots.length} manual + ${totalAutomatedCount} automated)`);
}

try {
  main();
} catch (error) {
  log(`❌ Fatal error: ${error.message || error}`);
  console.error(error);
  process.exit(1);
}
