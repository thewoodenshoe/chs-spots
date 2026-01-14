/**
 * Merge Raw Files - Step 2 of Happy Hour Pipeline
 * 
 * Merges all raw HTML files per venue into a single JSON file.
 * Saves to data/silver_merged/<venue-id>.json
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

// Paths
const RAW_DIR = path.join(__dirname, '../data/raw');
const SILVER_MERGED_DIR = path.join(__dirname, '../data/silver_merged');
const VENUES_PATH = path.join(__dirname, '../data/venues.json');

// Ensure directories exist
if (!fs.existsSync(SILVER_MERGED_DIR)) {
  fs.mkdirSync(SILVER_MERGED_DIR, { recursive: true });
}

/**
 * Get all HTML files for a venue
 */
function getVenueRawFiles(venueId) {
  const venueDir = path.join(RAW_DIR, venueId);
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
 * Load URL metadata
 */
function loadMetadata(venueId) {
  const metadataPath = path.join(RAW_DIR, venueId, 'metadata.json');
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
  
  // Save merged file
  const mergedPath = path.join(SILVER_MERGED_DIR, `${venueId}.json`);
  fs.writeFileSync(mergedPath, JSON.stringify(mergedData, null, 2), 'utf8');
  
  return {
    venueId,
    venueName: venue.name,
    pages: pages.length,
    success: true
  };
}

/**
 * Generate hash from URL (same as download-raw-html.js)
 */
function urlToHash(url) {
  const crypto = require('crypto');
  return crypto.createHash('md5').update(url).digest('hex').substring(0, 12);
}

/**
 * Main function
 */
function main() {
  log('🔗 Starting Raw Files Merge\n');
  
  // Parse command-line arguments
  const args = process.argv.slice(2);
  let areaFilter = null;
  
  if (args.length > 0) {
    areaFilter = args[0];
    log(`📍 Filtering by area: ${areaFilter}\n`);
  }
  
  // Load venues
  if (!fs.existsSync(VENUES_PATH)) {
    log(`❌ Venues file not found: ${VENUES_PATH}`);
    process.exit(1);
  }
  
  const venues = JSON.parse(fs.readFileSync(VENUES_PATH, 'utf8'));
  log(`📖 Loaded ${venues.length} venue(s) from venues.json\n`);
  
  // Check raw directory
  if (!fs.existsSync(RAW_DIR)) {
    log(`❌ Raw directory not found: ${RAW_DIR}`);
    log(`   Run download-raw-html.js first`);
    process.exit(1);
  }
  
  // Get all venue directories
  let venueDirs = fs.readdirSync(RAW_DIR).filter(item => {
    const itemPath = path.join(RAW_DIR, item);
    return fs.statSync(itemPath).isDirectory() && item !== 'previous';
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
  const successful = results.filter(r => r.success).length;
  const totalPages = results.reduce((sum, r) => sum + (r.pages || 0), 0);
  
  log(`\n📊 Summary:`);
  log(`   ✅ Merged: ${successful} venue(s)`);
  log(`   📄 Total pages: ${totalPages}`);
  log(`\n✨ Done! Merged files saved to: ${path.resolve(SILVER_MERGED_DIR)}`);
}

try {
  main();
} catch (error) {
  log(`❌ Fatal error: ${error.message || error}`);
  console.error(error);
  process.exit(1);
}
