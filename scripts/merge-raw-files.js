/**
 * Merge Raw Files - Step 2 of Happy Hour Pipeline
 * 
 * Merges all raw HTML files per venue into a single JSON file.
 * Saves to data/silver_merged/all/<venue-id>.json
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

// Paths - New structure: raw/all/ and silver_merged/all/
const RAW_ALL_DIR = path.join(__dirname, '../data/raw/all');
const RAW_PREVIOUS_DIR = path.join(__dirname, '../data/raw/previous');
const SILVER_MERGED_DIR = path.join(__dirname, '../data/silver_merged');
const SILVER_MERGED_ALL_DIR = path.join(__dirname, '../data/silver_merged/all');
const SILVER_MERGED_PREVIOUS_DIR = path.join(__dirname, '../data/silver_merged/previous');
const SILVER_MERGED_INCREMENTAL_DIR = path.join(__dirname, '../data/silver_merged/incremental');
// Try reporting/venues.json first (primary), fallback to data/venues.json (backwards compatibility)
const REPORTING_VENUES_PATH = path.join(__dirname, '../data/reporting/venues.json');
const VENUES_PATH = path.join(__dirname, '../data/venues.json');

// Ensure directories exist
if (!fs.existsSync(SILVER_MERGED_DIR)) {
  fs.mkdirSync(SILVER_MERGED_DIR, { recursive: true });
}
if (!fs.existsSync(SILVER_MERGED_ALL_DIR)) {
  fs.mkdirSync(SILVER_MERGED_ALL_DIR, { recursive: true });
}
if (!fs.existsSync(SILVER_MERGED_PREVIOUS_DIR)) {
  fs.mkdirSync(SILVER_MERGED_PREVIOUS_DIR, { recursive: true });
}
if (!fs.existsSync(SILVER_MERGED_INCREMENTAL_DIR)) {
  fs.mkdirSync(SILVER_MERGED_INCREMENTAL_DIR, { recursive: true });
}

/**
 * Generate hash from URL (same as download-raw-html.js)
 */
function urlToHash(url) {
  const crypto = require('crypto');
  return crypto.createHash('md5').update(url).digest('hex').substring(0, 12);
}

/**
 * Get all HTML files for a venue (now from raw/all/<venue-id>/)
 */
function getVenueRawFiles(venueId) {
  const venueDir = path.join(RAW_ALL_DIR, venueId);
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
 * Load URL metadata (now from raw/all/<venue-id>/)
 */
function loadMetadata(venueId) {
  const metadataPath = path.join(RAW_ALL_DIR, venueId, 'metadata.json');
  if (!fs.existsSync(metadataPath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  } catch (e) {
    return {};
  }
}

/**
 * Check if merged file needs update (incremental check)
 */
function needsUpdate(venueId, rawFiles) {
  const mergedPath = path.join(SILVER_MERGED_ALL_DIR, `${venueId}.json`);
  
  // If merged file doesn't exist, needs update
  if (!fs.existsSync(mergedPath)) {
    return true;
  }
  
  // Check if any raw file is newer than merged file
  try {
    const mergedStats = fs.statSync(mergedPath);
    const mergedMtime = mergedStats.mtime;
    
    // If any raw file is newer, needs update
    for (const rawFile of rawFiles) {
      if (rawFile.modifiedAt > mergedMtime) {
        return true;
      }
    }
    
    return false; // No changes detected
  } catch (error) {
    // If can't read merged file, assume needs update
    return true;
  }
}

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
  
  // INCREMENTAL: Skip if no changes detected
  if (!needsUpdate(venueId, rawFiles)) {
    log(`  ⏭️  Skipping ${venue.name} (${venueId}): No changes detected`);
    return { venueId, venueName: venue.name, pages: 0, success: true, skipped: true };
  }
  
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
  
  // Save merged file to silver_merged/all/
  const mergedPath = path.join(SILVER_MERGED_ALL_DIR, `${venueId}.json`);
  fs.writeFileSync(mergedPath, JSON.stringify(mergedData, null, 2), 'utf8');
  
  return {
    venueId,
    venueName: venue.name,
    pages: pages.length,
    success: true
  };
}

/**
 * Archive previous day's merged files
 */
function archivePreviousDay() {
  if (!fs.existsSync(SILVER_MERGED_ALL_DIR)) {
    return false;
  }
  
  const today = new Date().toISOString().split('T')[0];
  const files = fs.readdirSync(SILVER_MERGED_ALL_DIR).filter(f => f.endsWith('.json'));
  
  if (files.length === 0) {
    return false;
  }
  
  let archived = 0;
  for (const file of files) {
    try {
      const sourcePath = path.join(SILVER_MERGED_ALL_DIR, file);
      const destPath = path.join(SILVER_MERGED_PREVIOUS_DIR, file);
      
      // Remove existing archive if it exists
      if (fs.existsSync(destPath)) {
        fs.unlinkSync(destPath);
      }
      
      // Move to previous
      fs.renameSync(sourcePath, destPath);
      archived++;
    } catch (error) {
      log(`  ⚠️  Failed to archive ${file}: ${error.message}`);
    }
  }
  
  if (archived > 0) {
    log(`  ✅ Archived ${archived} merged file(s) to silver_merged/previous/`);
  }
  
  return archived > 0;
}

/**
 * Main function
 */
function main() {
  log('🔗 Starting Raw Files Merge\n');
  
  // Archive previous day's merged files (if they exist)
  archivePreviousDay();
  
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
    venuesPath = REPORTING_VENUES_PATH;
  } else if (!fs.existsSync(VENUES_PATH)) {
    log(`❌ Venues file not found in either location:`);
    log(`   ${REPORTING_VENUES_PATH}`);
    log(`   ${VENUES_PATH}`);
    log(`\n   Please run 'node scripts/seed-venues.js' first.`);
    process.exit(1);
  }
  
  const venues = JSON.parse(fs.readFileSync(venuesPath, 'utf8'));
  log(`📖 Loaded ${venues.length} venue(s) from venues.json\n`);
  
  // Check raw directory
  if (!fs.existsSync(RAW_ALL_DIR)) {
    log(`❌ Raw directory not found: ${RAW_ALL_DIR}`);
    log(`   Run download-raw-html.js first`);
    process.exit(1);
  }
  
  // Get all venue directories from raw/all/
  let venueDirs = fs.readdirSync(RAW_ALL_DIR).filter(item => {
    const itemPath = path.join(RAW_ALL_DIR, item);
    return fs.statSync(itemPath).isDirectory();
  });
  
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
  log(`\n✨ Done! Merged files saved to: ${path.resolve(SILVER_MERGED_ALL_DIR)}`);
  log(`   Previous day's data: ${path.resolve(SILVER_MERGED_PREVIOUS_DIR)}`);
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
