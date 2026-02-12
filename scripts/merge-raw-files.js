/**
 * Merge Raw Files - Step 2 of Happy Hour Pipeline
 * 
 * Merges all raw HTML files per venue into a single JSON file.
 * Saves to data/silver_merged/today/<venue-id>.json
 * 
 * Structure:
 * {
 *   "venueId": "ChIJ...",
 *   "venueName": "...",
 *   "venueArea": "...",
 *   "website": "http://...",
 *   "scrapedAt": "2026-01-12T15:33:13.976Z",
 *   "pages": [
 *     {
 *       "url": "http://...",
 *       "html": "<html>...</html>",
 *       "downloadedAt": "2026-01-12T15:33:13.976Z"
 *     }
 *   ]
 * }
 * 
 * Run with: node scripts/merge-raw-files.js [area-filter]
 * 
 * If area-filter is provided, only processes venues from that area.
 */

const fs = require('fs');
const path = require('path');

// Logging setup
const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logPath = path.join(logDir, 'merge-raw-files.log');

fs.writeFileSync(logPath, '', 'utf8');

function log(message) {
  const ts = new Date().toISOString();
  console.log(message);
  fs.appendFileSync(logPath, `[${ts}] ${message}\n`);
}

// Paths - New structure: raw/today/ and silver_merged/today/
const RAW_TODAY_DIR = path.join(__dirname, '../data/raw/today');
const RAW_PREVIOUS_DIR = path.join(__dirname, '../data/raw/previous');
const SILVER_MERGED_DIR = path.join(__dirname, '../data/silver_merged');
const SILVER_MERGED_TODAY_DIR = path.join(__dirname, '../data/silver_merged/today');
const SILVER_MERGED_PREVIOUS_DIR = path.join(__dirname, '../data/silver_merged/previous');
const SILVER_MERGED_INCREMENTAL_DIR = path.join(__dirname, '../data/silver_merged/incremental');
const { loadConfig, updateConfigField, getRunDate } = require('./utils/config');
// Try reporting/venues.json first (primary), fallback to data/venues.json (backwards compatibility)
const REPORTING_VENUES_PATH = path.join(__dirname, '../data/reporting/venues.json');
const VENUES_PATH = path.join(__dirname, '../data/venues.json');

// Ensure directories exist
if (!fs.existsSync(SILVER_MERGED_DIR)) {
  fs.mkdirSync(SILVER_MERGED_DIR, { recursive: true });
}
if (!fs.existsSync(SILVER_MERGED_TODAY_DIR)) {
  fs.mkdirSync(SILVER_MERGED_TODAY_DIR, { recursive: true });
}
if (!fs.existsSync(SILVER_MERGED_PREVIOUS_DIR)) {
  fs.mkdirSync(SILVER_MERGED_PREVIOUS_DIR, { recursive: true });
}
// Note: silver_merged/incremental/ directory is no longer needed

/**
 * Generate hash from URL (same as download-raw-html.js)
 */
function urlToHash(url) {
  const crypto = require('crypto');
  return crypto.createHash('md5').update(url).digest('hex').substring(0, 12);
}

/**
 * Get all HTML files for a venue from raw/today/<venue-id>/ (full mode)
 */
function getVenueRawFiles(venueId) {
  // FULL MODE: Read from raw/today/ (all files)
  const venueDir = path.join(RAW_TODAY_DIR, venueId);
  if (!fs.existsSync(venueDir)) {
    return [];
  }
  
  const files = fs.readdirSync(venueDir).filter(f => f.endsWith('.html'));
  return files.map(file => {
    const filePath = path.join(venueDir, file);
    const stats = fs.statSync(filePath);
    return {
      file,
      filePath,
      modifiedAt: stats.mtime
    };
  });
}

/**
 * Load URL metadata from raw/today/
 */
function loadMetadata(venueId) {
  // FULL MODE: Read from raw/today/
  const metadataPath = path.join(RAW_TODAY_DIR, venueId, 'metadata.json');
  if (!fs.existsSync(metadataPath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  } catch (e) {
    return {};
  }
}

// Note: needsUpdate() function removed - we now process all files in full mode

/**
 * Process a single venue
 */
function processVenue(venueId, venues) {
  const venue = venues.find(v => (v.id || v.place_id) === venueId);
  if (!venue) {
    log(`  ⚠️  Venue not found in venues.json: ${venueId}`);
    return null;
  }
  
  const rawFiles = getVenueRawFiles(venueId);
  if (rawFiles.length === 0) {
    log(`  ⏭️  No raw files found for ${venue.name} (${venueId})`);
    return null;
  }
  
  // FULL MODE: Process all files (no incremental skip)
  log(`  🔗 Merging ${rawFiles.length} file(s) for ${venue.name} (${venueId})`);
  
  // Load metadata
  const metadata = loadMetadata(venueId);
  
  // Read all HTML files
  const pages = [];
  for (const rawFile of rawFiles) {
    try {
      const html = fs.readFileSync(rawFile.filePath, 'utf8');
      const hash = rawFile.file.replace('.html', '');
      
      // Get URL from metadata
      const url = metadata[hash] || (hash === urlToHash(venue.website) ? venue.website : `unknown-${hash}`);
      
      pages.push({
        url,
        html,
        hash,
        downloadedAt: rawFile.modifiedAt.toISOString()
      });
    } catch (error) {
      log(`  ❌ Error reading ${rawFile.file}: ${error.message}`);
    }
  }
  
  // Create merged file
  const mergedData = {
    venueId,
    venueName: venue.name,
    venueArea: venue.area || null,
    website: venue.website || null,
    scrapedAt: new Date().toISOString(),
    pages
  };
  
  // Save merged file to silver_merged/today/ (main storage)
  // FULL MODE: No incremental/ needed - comparison happens at trimmed layer
  const mergedPath = path.join(SILVER_MERGED_TODAY_DIR, `${venueId}.json`);
  fs.writeFileSync(mergedPath, JSON.stringify(mergedData, null, 2), 'utf8');
  
  return {
    venueId,
    venueName: venue.name,
    pages: pages.length,
    success: true
  };
}

/**
 * Check if directory is empty
 */
function isDirectoryEmpty(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return true;
  }
  const items = fs.readdirSync(dirPath);
  return items.length === 0;
}

/**
 * Archive today/ to previous/ on new day
 */
function archiveTodayToPrevious() {
  log(`📅 New day detected: archiving silver_merged/today/ to silver_merged/previous/`);
  
  // Delete all files from previous/
  if (fs.existsSync(SILVER_MERGED_PREVIOUS_DIR)) {
    const previousFiles = fs.readdirSync(SILVER_MERGED_PREVIOUS_DIR).filter(f => f.endsWith('.json'));
    for (const file of previousFiles) {
      fs.unlinkSync(path.join(SILVER_MERGED_PREVIOUS_DIR, file));
    }
  }
  fs.mkdirSync(SILVER_MERGED_PREVIOUS_DIR, { recursive: true });
  log(`  🗑️  Deleted all files from silver_merged/previous/`);
  
  // Copy all files from today/ to previous/
  let copiedCount = 0;
  if (fs.existsSync(SILVER_MERGED_TODAY_DIR)) {
    const todayFiles = fs.readdirSync(SILVER_MERGED_TODAY_DIR).filter(f => f.endsWith('.json'));
    for (const file of todayFiles) {
      try {
        const sourcePath = path.join(SILVER_MERGED_TODAY_DIR, file);
        const destPath = path.join(SILVER_MERGED_PREVIOUS_DIR, file);
        fs.copyFileSync(sourcePath, destPath);
        copiedCount++;
      } catch (error) {
        log(`  ⚠️  Failed to copy ${file} from today/ to previous/: ${error.message}`);
      }
    }
  }
  log(`  ✅ Copied ${copiedCount} file(s) from silver_merged/today/ to silver_merged/previous/`);
  
  // Delete all files from today/
  if (fs.existsSync(SILVER_MERGED_TODAY_DIR)) {
    const todayFiles = fs.readdirSync(SILVER_MERGED_TODAY_DIR).filter(f => f.endsWith('.json'));
    for (const file of todayFiles) {
      fs.unlinkSync(path.join(SILVER_MERGED_TODAY_DIR, file));
    }
  }
  log(`  🗑️  Deleted all files from silver_merged/today/`);
}

/**
 * Main function
 */
function main() {
  log('🔗 Starting Raw Files Merge\n');
  
  // Load config for state management
  const config = loadConfig();
  const runDate = process.env.PIPELINE_RUN_DATE || config.run_date || getRunDate();
  const lastMergedDate = config.last_merged_processed_date || null;
  const todayEmpty = isDirectoryEmpty(SILVER_MERGED_TODAY_DIR);
  const isNewDayForMerged = !lastMergedDate || lastMergedDate !== runDate;
  
  log(`📊 State check:`);
  log(`   run_date: ${runDate}`);
  log(`   last_merged_processed_date: ${lastMergedDate || 'null'}`);
  log(`   silver_merged/today/ empty: ${todayEmpty}`);
  log(`   is_new_day_for_merged: ${isNewDayForMerged}`);
  
  // Archive only when the merged layer has crossed into a new run_date.
  // Same-day reruns (including AREA_FILTER reruns) should preserve today/.
  if (!todayEmpty && isNewDayForMerged) {
    log(`📅 silver_merged/today/ not empty - archiving to previous/`);
    archiveTodayToPrevious();
  } else if (!todayEmpty && !isNewDayForMerged) {
    log(`📅 Same-day merge rerun detected - preserving silver_merged/today/`);
  }
  
  updateConfigField('last_run_status', 'running_merged');
  
  // Parse command-line arguments
  const args = process.argv.slice(2);
  let areaFilter = null;
  
  if (args.length > 0) {
    areaFilter = args[0];
    log(`📍 Filtering by area: ${areaFilter}\n`);
  }
  
  // Load venues - try reporting/venues.json first, fallback to data/venues.json
  let venuesPath = VENUES_PATH;
  if (fs.existsSync(REPORTING_VENUES_PATH)) {
    // Try to parse reporting/venues.json, fallback to data/venues.json if invalid
    try {
      const testData = JSON.parse(fs.readFileSync(REPORTING_VENUES_PATH, 'utf8'));
      venuesPath = REPORTING_VENUES_PATH;
    } catch (error) {
      log(`⚠️  Warning: ${REPORTING_VENUES_PATH} has JSON errors: ${error.message}`);
      log(`   Falling back to ${VENUES_PATH}\n`);
      if (!fs.existsSync(VENUES_PATH)) {
        log(`❌ Venues file not found in either location:`);
        log(`   ${REPORTING_VENUES_PATH} (has errors)`);
        log(`   ${VENUES_PATH} (not found)`);
        log(`\n   Please fix venues.json or run 'node scripts/seed-venues.js' first.`);
        process.exit(1);
      }
      venuesPath = VENUES_PATH;
    }
  } else if (!fs.existsSync(VENUES_PATH)) {
    log(`❌ Venues file not found in either location:`);
    log(`   ${REPORTING_VENUES_PATH}`);
    log(`   ${VENUES_PATH}`);
    log(`\n   Please run 'node scripts/seed-venues.js' first.`);
    process.exit(1);
  }
  
  let venues;
  try {
    venues = JSON.parse(fs.readFileSync(venuesPath, 'utf8'));
  } catch (error) {
    log(`❌ Error parsing venues file ${venuesPath}: ${error.message}`);
    log(`   Please fix the JSON syntax in the venues file.`);
    process.exit(1);
  }
  log(`📖 Loaded ${venues.length} venue(s) from venues.json\n`);
  
  // FULL MODE: Get ALL venue directories from raw/today/
  let venueDirs = [];
  if (fs.existsSync(RAW_TODAY_DIR)) {
    venueDirs = fs.readdirSync(RAW_TODAY_DIR).filter(item => {
      const itemPath = path.join(RAW_TODAY_DIR, item);
      return fs.statSync(itemPath).isDirectory();
    });
  }
  
  // If today folder is empty, stop processing
  if (venueDirs.length === 0) {
    log(`⏭️  No venues found in ${RAW_TODAY_DIR}`);
    log(`   Raw today folder is empty - nothing to merge.`);
    log(`\n✨ Skipped merge (no raw files)`);
    return;
  }
  
  log(`📁 Found ${venueDirs.length} venue(s) in raw/today/\n`);
  
  // Filter by area if specified
  if (areaFilter) {
    const areaVenueIds = new Set(
      venues
        .filter(v => 
          (v.area && v.area.toLowerCase() === areaFilter.toLowerCase()) ||
          (v.addressComponents && v.addressComponents.some(ac => 
            ac.types.includes('sublocality') && ac.long_name.toLowerCase() === areaFilter.toLowerCase()
          ))
        )
        .map(v => v.id || v.place_id)
    );
    venueDirs = venueDirs.filter(venueId => areaVenueIds.has(venueId));
    log(`📍 Filtered to ${venueDirs.length} venue(s) in ${areaFilter}\n`);
  } else {
    log(`📁 Found ${venueDirs.length} venue(s) with raw files\n`);
  }
  
  // Process each venue
  const results = [];
  for (const venueId of venueDirs) {
    const result = processVenue(venueId, venues);
    if (result) {
      results.push(result);
    }
  }
  
  // Summary
  const successful = results.filter(r => r.success && !r.skipped).length;
  const skipped = results.filter(r => r.skipped).length;
  const totalPages = results.reduce((sum, r) => sum + (r.pages || 0), 0);
  
  log(`\n📊 Summary:`);
  log(`   ✅ Merged: ${successful}`);
  log(`   ⏭️  Skipped (no changes): ${skipped}`);
  log(`   📄 Total pages: ${totalPages}`);
  // Update status after successful merge
  updateConfigField('last_run_status', 'running_merged');
  updateConfigField('last_merged_processed_date', runDate);
  
  log(`\n✨ Done! Merged files saved to: ${path.resolve(SILVER_MERGED_TODAY_DIR)}`);
}

try {
  main();
  // Explicitly exit to ensure process terminates (important when called from pipeline)
  process.exit(0);
} catch (error) {
  log(`❌ Fatal error: ${error.message || error}`);
  console.error(error);
  process.exit(1);
}
