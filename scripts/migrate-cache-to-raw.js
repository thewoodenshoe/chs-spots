/**
 * Migrate Cache to Raw - Migrates existing cache files to new raw structure
 * 
 * This script:
 * 1. Reads all HTML files from data/cache/
 * 2. Maps them to venues by matching URLs
 * 3. Organizes them into data/raw/<venue-id>/ structure
 * 4. Creates metadata.json files
 * 
 * Run with: node scripts/migrate-cache-to-raw.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

// Logging setup
const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logPath = path.join(logDir, 'migrate-cache-to-raw.log');

fs.writeFileSync(logPath, '', 'utf8');

function log(message) {
  const ts = new Date().toISOString();
  console.log(message);
  fs.appendFileSync(logPath, `[${ts}] ${message}\n`);
}

// Paths
const CACHE_DIR = path.join(__dirname, '../data/cache');
const RAW_DIR = path.join(__dirname, '../data/raw');
const VENUES_PATH = path.join(__dirname, '../data/venues.json');

// Ensure raw directory exists
if (!fs.existsSync(RAW_DIR)) {
  fs.mkdirSync(RAW_DIR, { recursive: true });
}

/**
 * Reverse the cache filename to URL
 * Cache format: hostname-pathname.html
 * Example: agavescantinawestashley-com-charleston-agave-cantina-west-ashley-drink-menu.html
 * -> https://agavescantinawestashley.com/charleston/agave-cantina-west-ashley/drink-menu
 */
function cacheFilenameToUrl(filename) {
  // Remove .html extension
  const name = filename.replace('.html', '');
  const parts = name.split('-');
  
  // Find TLD (com, org, net, etc.)
  const tlds = ['com', 'org', 'net', 'io', 'co', 'edu', 'gov', 'us', 'info', 'biz'];
  const tldIndex = parts.findIndex(p => tlds.includes(p));
  
  if (tldIndex > 0) {
    // Reconstruct hostname: parts before TLD + TLD
    const hostnameParts = parts.slice(0, tldIndex + 1);
    const hostname = hostnameParts.join('.');
    
    // Reconstruct pathname: parts after TLD
    const pathnameParts = parts.slice(tldIndex + 1);
    const pathname = pathnameParts.length > 0 ? '/' + pathnameParts.join('/') : '/';
    
    return `https://${hostname}${pathname}`;
  }
  
  // Fallback: try simple pattern (hostname-com or hostname-org)
  const simpleTldMatch = name.match(/^(.+?)-(com|org|net|io|co|edu|gov|us|info|biz)(.*)$/);
  if (simpleTldMatch) {
    const hostname = simpleTldMatch[1].replace(/-/g, '.') + '.' + simpleTldMatch[2];
    const pathname = simpleTldMatch[3] ? '/' + simpleTldMatch[3].replace(/-/g, '/') : '/';
    return `https://${hostname}${pathname}`;
  }
  
  return null;
}

/**
 * Generate hash from URL (same as download-raw-html.js)
 */
function urlToHash(url) {
  return crypto.createHash('md5').update(url).digest('hex').substring(0, 12);
}

/**
 * Find venue by website URL
 */
function findVenueByUrl(url, venues) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    
    // Try exact match first
    let venue = venues.find(v => {
      if (!v.website) return false;
      try {
        const vUrl = new URL(v.website);
        return vUrl.hostname === hostname;
      } catch (e) {
        return false;
      }
    });
    
    if (venue) return venue;
    
    // Try partial match (hostname without www)
    const hostnameNoWww = hostname.replace(/^www\./, '');
    venue = venues.find(v => {
      if (!v.website) return false;
      try {
        const vUrl = new URL(v.website);
        return vUrl.hostname.replace(/^www\./, '') === hostnameNoWww;
      } catch (e) {
        return false;
      }
    });
    
    return venue || null;
  } catch (e) {
    return null;
  }
}

/**
 * Main function
 */
function main() {
  log('🔄 Starting Cache to Raw Migration\n');
  
  // Check cache directory
  if (!fs.existsSync(CACHE_DIR)) {
    log(`❌ Cache directory not found: ${CACHE_DIR}`);
    process.exit(1);
  }
  
  // Load venues
  if (!fs.existsSync(VENUES_PATH)) {
    log(`❌ Venues file not found: ${VENUES_PATH}`);
    process.exit(1);
  }
  
  const venues = JSON.parse(fs.readFileSync(VENUES_PATH, 'utf8'));
  log(`📖 Loaded ${venues.length} venue(s) from venues.json\n`);
  
  // Get all cache files
  const cacheFiles = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.html'));
  log(`📁 Found ${cacheFiles.length} cache file(s)\n`);
  
  // Process each cache file
  const venueMap = new Map(); // venueId -> { files: [], metadata: {} }
  let processed = 0;
  let matched = 0;
  let unmatched = 0;
  
  for (const cacheFile of cacheFiles) {
    const cachePath = path.join(CACHE_DIR, cacheFile);
    
    try {
      // Try to reconstruct URL from filename
      const url = cacheFilenameToUrl(cacheFile);
      
      if (!url) {
        log(`  ⚠️  Could not reconstruct URL from: ${cacheFile}`);
        unmatched++;
        continue;
      }
      
      // Find venue
      const venue = findVenueByUrl(url, venues);
      
      if (!venue) {
        log(`  ⚠️  No venue found for URL: ${url} (${cacheFile})`);
        unmatched++;
        continue;
      }
      
      const venueId = venue.id || venue.place_id;
      if (!venueId) {
        log(`  ⚠️  Venue has no ID: ${venue.name}`);
        unmatched++;
        continue;
      }
      
      // Add to venue map
      if (!venueMap.has(venueId)) {
        venueMap.set(venueId, {
          venueId,
          venueName: venue.name,
          files: [],
          metadata: {}
        });
      }
      
      const venueData = venueMap.get(venueId);
      
      // Read HTML
      const html = fs.readFileSync(cachePath, 'utf8');
      const hash = urlToHash(url);
      
      // Create venue directory
      const venueDir = path.join(RAW_DIR, venueId);
      if (!fs.existsSync(venueDir)) {
        fs.mkdirSync(venueDir, { recursive: true });
      }
      
      // Save HTML file
      const rawFilePath = path.join(venueDir, `${hash}.html`);
      fs.writeFileSync(rawFilePath, html, 'utf8');
      
      // Store metadata
      venueData.metadata[hash] = url;
      venueData.files.push({ url, hash, cacheFile });
      
      processed++;
      if (processed % 100 === 0) {
        log(`  📊 Processed ${processed}/${cacheFiles.length} files...`);
      }
    } catch (error) {
      log(`  ❌ Error processing ${cacheFile}: ${error.message}`);
      unmatched++;
    }
  }
  
  // Save metadata files
  log(`\n💾 Saving metadata files...\n`);
  for (const [venueId, venueData] of venueMap.entries()) {
    const metadataPath = path.join(RAW_DIR, venueId, 'metadata.json');
    fs.writeFileSync(metadataPath, JSON.stringify(venueData.metadata, null, 2), 'utf8');
    matched++;
  }
  
  // Summary
  log(`\n📊 Summary:`);
  log(`   ✅ Processed: ${processed} file(s)`);
  log(`   🎯 Matched to venues: ${matched} venue(s)`);
  log(`   ⚠️  Unmatched: ${unmatched} file(s)`);
  log(`   📁 Total venues with raw files: ${venueMap.size}`);
  
  // List unmatched files
  if (unmatched > 0) {
    log(`\n⚠️  ${unmatched} file(s) could not be matched to venues`);
    log(`   These files remain in ${CACHE_DIR} and can be manually reviewed`);
  }
  
  log(`\n✨ Migration complete!`);
  log(`   Raw files saved to: ${path.resolve(RAW_DIR)}`);
  log(`   Cache directory can be removed after verification`);
}

try {
  main();
} catch (error) {
  log(`❌ Fatal error: ${error.message || error}`);
  console.error(error);
  process.exit(1);
}
