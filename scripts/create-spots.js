/**
 * Create Spots from Gold Extracted Data
 * 
 * Reads gold/<venue-id>.json files and venues.json to create spots.json entries.
 * Only creates spots for venues with happyHour.found === true.
 * 
 * Input:
 * - data/gold/<venue-id>.json (extracted happy hour data)
 * - data/venues.json (venue coordinates and metadata)
 * 
 * Output:
 * - data/spots.json (spots array for frontend)
 * 
 * Run with: node scripts/create-spots.js
 */

const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./utils/config');

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

// Paths
const GOLD_DIR = path.join(__dirname, '../data/gold');
// Check both locations for venues.json
const VENUES_PATH = fs.existsSync(path.join(__dirname, '../data/venues.json')) 
  ? path.join(__dirname, '../data/venues.json')
  : path.join(__dirname, '../data/reporting/venues.json');
const AREAS_PATH = path.join(__dirname, '../data/config/areas.json');
const REPORTING_DIR = path.join(__dirname, '../data/reporting');
const SPOTS_PATH = path.join(REPORTING_DIR, 'spots.json');
const REPORTING_VENUES_PATH = path.join(REPORTING_DIR, 'venues.json');
const REPORTING_AREAS_PATH = path.join(REPORTING_DIR, 'areas.json');
const REPORTING_INDEXES_DIR = path.join(REPORTING_DIR, 'indexes');
const REPORTING_AREA_INDEXES_DIR = path.join(REPORTING_INDEXES_DIR, 'by-area');

// Pipeline directory paths
const RAW_PREVIOUS_DIR = path.join(__dirname, '../data/raw/previous');
const RAW_TODAY_DIR = path.join(__dirname, '../data/raw/today');
// Note: raw/incremental/ and silver_merged/incremental/ are no longer used
// Comparison now happens at silver_trimmed layer only
const SILVER_MERGED_PREVIOUS_DIR = path.join(__dirname, '../data/silver_merged/previous');
const SILVER_MERGED_TODAY_DIR = path.join(__dirname, '../data/silver_merged/today');
const SILVER_TRIMMED_PREVIOUS_DIR = path.join(__dirname, '../data/silver_trimmed/previous');
const SILVER_TRIMMED_TODAY_DIR = path.join(__dirname, '../data/silver_trimmed/today');
const SILVER_TRIMMED_INCREMENTAL_DIR = path.join(__dirname, '../data/silver_trimmed/incremental');

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
      sourceUrl: sourceUrl,
      lastUpdateDate: goldData.processedAt || null,
      type: activityType,
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
  
  // Check if gold directory exists
  if (!fs.existsSync(GOLD_DIR)) {
    log(`❌ Gold directory not found: ${GOLD_DIR}`);
    log(`   Run extract-promotions.js first`);
    process.exit(1);
  }
  
  // Check if venues.json exists
  if (!fs.existsSync(VENUES_PATH)) {
    log(`❌ Venues file not found: ${VENUES_PATH}`);
    log(`   Run seed-venues.js first`);
    process.exit(1);
  }
  
  // Check if areas.json exists
  if (!fs.existsSync(AREAS_PATH)) {
    log(`❌ Areas file not found: ${AREAS_PATH}`);
    log(`   Run create-areas.js first`);
    process.exit(1);
  }
  
  // Ensure reporting directory exists
  if (!fs.existsSync(REPORTING_DIR)) {
    fs.mkdirSync(REPORTING_DIR, { recursive: true });
    log(`📁 Created reporting directory: ${REPORTING_DIR}\n`);
  }
  if (!fs.existsSync(REPORTING_AREA_INDEXES_DIR)) {
    fs.mkdirSync(REPORTING_AREA_INDEXES_DIR, { recursive: true });
  }
  
  // Load venues
  let venues;
  try {
    const venuesContent = fs.readFileSync(VENUES_PATH, 'utf8');
    venues = JSON.parse(venuesContent);
    
    if (!Array.isArray(venues)) {
      log('❌ venues.json does not contain an array');
      process.exit(1);
    }
  } catch (error) {
    log(`❌ Error reading venues.json: ${error.message}`);
    process.exit(1);
  }
  
  // Create venue lookup by id
  const venueMap = new Map();
  for (const venue of venues) {
    const venueId = venue.id || venue.place_id;
    if (venueId) {
      venueMap.set(venueId, venue);
    }
  }
  
  log(`📁 Loaded ${venues.length} venue(s) from venues.json\n`);
  
  // Get all gold files
  const goldFiles = fs.readdirSync(GOLD_DIR)
    .filter(f => f.endsWith('.json') && f !== 'bulk-results.json' && f !== '.bulk-complete')
    .map(f => path.join(GOLD_DIR, f));
  
  log(`📁 Found ${goldFiles.length} gold file(s)\n`);
  
  if (goldFiles.length === 0) {
    log('⚠️  No gold files found. Creating empty spots.json');
    fs.writeFileSync(SPOTS_PATH, JSON.stringify([], null, 2), 'utf8');
    log('\n✨ Done! Created empty spots.json');
    return;
  }
  
  // Load existing spots.json to preserve manual spots only (automated spots will be regenerated)
  let existingSpots = [];
  let manualSpotsCount = 0;
  if (fs.existsSync(SPOTS_PATH)) {
    try {
      const existingContent = fs.readFileSync(SPOTS_PATH, 'utf8');
      existingSpots = JSON.parse(existingContent);
      if (!Array.isArray(existingSpots)) {
        existingSpots = [];
      }
      // Only preserve manual spots - automated spots will be regenerated with new labeled fields
      manualSpotsCount = existingSpots.filter(s => s.source === 'manual').length;
      if (manualSpotsCount > 0) {
        log(`📋 Found ${manualSpotsCount} manual spot(s) - will be preserved\n`);
      }
    } catch (error) {
      log(`  ⚠️  Error reading existing spots.json: ${error.message}`);
      existingSpots = [];
    }
  }
  
  // Extract manual spots (should never be removed)
  const manualSpots = existingSpots.filter(s => s.source === 'manual');
  
  // Process gold files and create spots
  // Start with manual spots only - automated spots will be regenerated from gold
  const spots = [...manualSpots]; // Start with manual spots only
  let processed = 0;
  let skipped = 0;
  let missingVenue = 0;
  let noHappyHour = 0;
  let incompleteData = 0;
  
  for (const goldPath of goldFiles) {
    try {
      const goldContent = fs.readFileSync(goldPath, 'utf8');
      const goldData = JSON.parse(goldContent);
      
      const venueId = goldData.venueId;
      if (!venueId) {
        skipped++;
        log(`  ⚠️  Skipping: Missing venueId in ${path.basename(goldPath)}`);
        continue;
      }
      
      const venueData = venueMap.get(venueId);
      if (!venueData) {
        missingVenue++;
        log(`  ⚠️  Skipping: Venue not found in venues.json: ${venueId}`);
        continue;
      }
      
      // Only create spots for venues with promotions found
      const promoData = goldData.promotions || goldData.happyHour || {};
      if (!promoData.found) {
        noHappyHour++;
        continue;
      }
      
      // Check which activity types this venue already has in spots we're building
      const existingTypes = new Set(
        spots
          .filter(s => s.source === 'automated' && s.venueId === venueId)
          .map(s => s.type)
      );
      
      if (existingTypes.size > 0) {
        // Some activity types already present — createSpots will handle dedup below
      }
      
      // Calculate next ID (max of existing spots + 1)
      const maxId = spots.length > 0 
        ? Math.max(...spots.map(s => s.id || 0))
        : 0;
      const nextId = maxId + 1;
      
      const newSpots = createSpots(goldData, venueData, nextId);
      
      if (newSpots.length > 0) {
        for (const spot of newSpots) {
          // Skip if this venue+type combo already exists
          if (existingTypes.has(spot.type)) {
            skipped++;
            continue;
          }
          
          // Validate spot has required fields
          if (!spot.lat || !spot.lng) {
            log(`  ⚠️  Skipping: Missing coordinates for ${goldData.venueName} (${venueId})`);
            skipped++;
            continue;
          }
          
          spots.push(spot);
          processed++;
          log(`  ✅ Created spot: ${spot.title} [${spot.type}] (${spot.id})`);
        }
      } else {
        // No valid spots created - likely incomplete data
        incompleteData++;
      }
      
    } catch (error) {
      log(`  ❌ Error processing ${path.basename(goldPath)}: ${error.message}`);
      skipped++;
    }
  }
  
  // Write spots.json to reporting folder
  fs.writeFileSync(SPOTS_PATH, JSON.stringify(spots, null, 2), 'utf8');
  log(`\n✅ Created ${SPOTS_PATH}`);
  
  // Copy venues.json to reporting folder
  if (fs.existsSync(VENUES_PATH)) {
    fs.copyFileSync(VENUES_PATH, REPORTING_VENUES_PATH);
    log(`✅ Copied venues.json to ${REPORTING_VENUES_PATH}`);
  }
  
  // Copy areas.json to reporting folder
  if (fs.existsSync(AREAS_PATH)) {
    fs.copyFileSync(AREAS_PATH, REPORTING_AREAS_PATH);
    log(`✅ Copied areas.json to ${REPORTING_AREAS_PATH}`);
  }

  // Build per-area indexes (venueId-keyed, not canonical storage)
  const automatedSpots = spots.filter(s => s.source === 'automated' && s.venueId);
  const areaIndex = {};
  for (const spot of automatedSpots) {
    const venue = venueMap.get(spot.venueId);
    const area = (venue && venue.area) ? venue.area : 'Unknown';
    if (!areaIndex[area]) {
      areaIndex[area] = {
        area,
        venueIds: new Set(),
        spotIds: [],
        byType: {}
      };
    }
    areaIndex[area].venueIds.add(spot.venueId);
    areaIndex[area].spotIds.push(spot.id);
    areaIndex[area].byType[spot.type] = (areaIndex[area].byType[spot.type] || 0) + 1;
  }

  // Clear existing area index files to avoid stale indexes
  const oldIndexFiles = fs.readdirSync(REPORTING_AREA_INDEXES_DIR).filter(f => f.endsWith('.json'));
  for (const file of oldIndexFiles) {
    fs.unlinkSync(path.join(REPORTING_AREA_INDEXES_DIR, file));
  }

  const summary = {};
  for (const [area, data] of Object.entries(areaIndex)) {
    const areaSlug = area.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const record = {
      area,
      venueIds: Array.from(data.venueIds).sort(),
      spotIds: data.spotIds.sort((a, b) => a - b),
      byType: data.byType
    };
    fs.writeFileSync(
      path.join(REPORTING_AREA_INDEXES_DIR, `${areaSlug || 'unknown'}.json`),
      JSON.stringify(record, null, 2),
      'utf8'
    );
    summary[area] = {
      venueCount: record.venueIds.length,
      spotCount: record.spotIds.length,
      byType: record.byType
    };
  }
  fs.writeFileSync(
    path.join(REPORTING_AREA_INDEXES_DIR, '_index.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), areas: summary }, null, 2),
    'utf8'
  );
  log(`✅ Wrote per-area indexes to ${REPORTING_AREA_INDEXES_DIR}`);
  
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
  log(`   👤 Manual spots preserved: ${manualSpotsCount}`);
  log(`   ⚠️  Skipped (already exists): ${skipped}`);
  log(`   ❌ Missing venue data: ${missingVenue}`);
  log(`   ℹ️  No happy hour: ${noHappyHour}`);
  log(`   📋 Incomplete data: ${incompleteData} (time only, no days/specials)`);
  log(`   📄 Total spots in spots.json: ${spots.length} (${manualSpotsCount} manual + ${totalAutomatedCount} automated)`);
  log(`\n✨ Done! Updated reporting folder with spots.json, venues.json, and areas.json`);
  log(`   Total spots: ${spots.length} (${manualSpotsCount} manual + ${totalAutomatedCount} automated)`);
}

try {
  main();
} catch (error) {
  log(`❌ Fatal error: ${error.message || error}`);
  console.error(error);
  process.exit(1);
}
