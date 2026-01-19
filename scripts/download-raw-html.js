/**
 * Download Raw HTML - Step 1 of Happy Hour Pipeline
 * 
 * Downloads raw, untouched HTML from venue websites and subpages.
 * Saves to data/raw/all/<venue-id>/<url-hash>.html
 * 
 * This is the source of truth - simple curl/wget equivalent.
 * No processing, no extraction, just raw HTML.
 * 
 * Run with: node scripts/download-raw-html.js [area-filter]
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
const logPath = path.join(logDir, 'download-raw-html.log');

fs.writeFileSync(logPath, '', 'utf8');

function log(message) {
  const ts = new Date().toISOString();
  console.log(message);
  fs.appendFileSync(logPath, `[${ts}] ${message}\n`);
}

// Paths - New structure: raw/all/ and raw/previous/
// Try reporting/venues.json first (primary), fallback to data/venues.json (backwards compatibility)
const REPORTING_VENUES_PATH = path.join(__dirname, '../data/reporting/venues.json');
const VENUES_PATH = path.join(__dirname, '../data/venues.json');
const RAW_DIR = path.join(__dirname, '../data/raw');
const RAW_ALL_DIR = path.join(__dirname, '../data/raw/all');
const RAW_PREVIOUS_DIR = path.join(__dirname, '../data/raw/previous');
const RAW_INCREMENTAL_DIR = path.join(__dirname, '../data/raw/incremental');
const LAST_DOWNLOAD_PATH = path.join(__dirname, '../data/raw/.last-download');

// Ensure raw directories exist
if (!fs.existsSync(RAW_DIR)) {
  fs.mkdirSync(RAW_DIR, { recursive: true });
}
if (!fs.existsSync(RAW_ALL_DIR)) {
  fs.mkdirSync(RAW_ALL_DIR, { recursive: true });
}
if (!fs.existsSync(RAW_PREVIOUS_DIR)) {
  fs.mkdirSync(RAW_PREVIOUS_DIR, { recursive: true });
}
if (!fs.existsSync(RAW_INCREMENTAL_DIR)) {
  fs.mkdirSync(RAW_INCREMENTAL_DIR, { recursive: true });
}

// Constants
const MAX_SUBPAGES = 10;
const PARALLEL_WORKERS = 15; // Increased from 5 to speed up downloads
const SUBMENU_KEYWORDS_PATH = path.join(__dirname, '../data/config/submenu-keywords.json');

// Load submenu keywords from config file
let SUBPAGE_KEYWORDS;
try {
    const keywordsData = fs.readFileSync(SUBMENU_KEYWORDS_PATH, 'utf8');
    SUBPAGE_KEYWORDS = JSON.parse(keywordsData);
    if (!Array.isArray(SUBPAGE_KEYWORDS)) {
        throw new Error('submenu-keywords.json must contain an array');
    }
} catch (error) {
    console.error(`Error reading submenu keywords from ${SUBMENU_KEYWORDS_PATH}: ${error.message}`);
    process.exit(1);
}

/**
 * Generate hash from URL for filename
 */
function urlToHash(url) {
  return crypto.createHash('md5').update(url).digest('hex').substring(0, 12);
}

/**
 * Get raw HTML file path (now in raw/all/<venue-id>/)
 */
function getRawFilePath(venueId, url) {
  const venueDir = path.join(RAW_ALL_DIR, venueId);
  if (!fs.existsSync(venueDir)) {
    fs.mkdirSync(venueDir, { recursive: true });
  }
  const hash = urlToHash(url);
  return path.join(venueDir, `${hash}.html`);
}

/**
 * Get metadata file path (now in raw/all/<venue-id>/)
 */
function getMetadataPath(venueId) {
  const venueDir = path.join(RAW_ALL_DIR, venueId);
  if (!fs.existsSync(venueDir)) {
    fs.mkdirSync(venueDir, { recursive: true });
  }
  return path.join(venueDir, 'metadata.json');
}

/**
 * Load URL metadata
 */
function loadMetadata(venueId) {
  const metadataPath = getMetadataPath(venueId);
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
 * Save URL metadata
 */
function saveMetadata(venueId, url, hash) {
  const metadata = loadMetadata(venueId);
  metadata[hash] = url;
  const metadataPath = getMetadataPath(venueId);
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
  
  // Also save to incremental folder
  const incrementalDir = path.join(RAW_INCREMENTAL_DIR, venueId);
  if (!fs.existsSync(incrementalDir)) {
    fs.mkdirSync(incrementalDir, { recursive: true });
  }
  const incrementalMetadataPath = path.join(incrementalDir, 'metadata.json');
  fs.writeFileSync(incrementalMetadataPath, JSON.stringify(metadata, null, 2), 'utf8');
}

/**
 * Get today's date string (YYYY-MM-DD)
 */
function getTodayDateString() {
  const today = new Date();
  return today.toISOString().split('T')[0];
}

/**
 * Get last download date from metadata
 */
function getLastDownloadDate() {
  if (!fs.existsSync(LAST_DOWNLOAD_PATH)) {
    return null;
  }
  try {
    return fs.readFileSync(LAST_DOWNLOAD_PATH, 'utf8').trim();
  } catch (e) {
    return null;
  }
}

/**
 * Save last download date
 */
function saveLastDownloadDate() {
  const today = getTodayDateString();
  fs.writeFileSync(LAST_DOWNLOAD_PATH, today, 'utf8');
}

/**
 * Check if file was downloaded today
 */
function isFileFromToday(filePath) {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  
  try {
    const stats = fs.statSync(filePath);
    const fileDate = new Date(stats.mtime);
    const today = new Date();
    
    return fileDate.getDate() === today.getDate() &&
           fileDate.getMonth() === today.getMonth() &&
           fileDate.getFullYear() === today.getFullYear();
  } catch (e) {
    return false;
  }
}

/**
 * Archive current raw/all directory to raw/previous
 */
function archivePreviousDay() {
  const today = getTodayDateString();
  const lastDownload = getLastDownloadDate();
  
  // If no previous download or same day, no need to archive
  if (!lastDownload || lastDownload === today) {
    log(`📅 Same day (${today}) - no archiving needed`);
    return false;
  }
  
  log(`📅 New day detected (${today}, previous: ${lastDownload})`);
  log(`📦 Archiving previous day's data...`);
  
  // Move all venue directories from raw/all/ to raw/previous/
  if (!fs.existsSync(RAW_ALL_DIR)) {
    return false;
  }
  
  const venueDirs = fs.readdirSync(RAW_ALL_DIR).filter(item => {
    const itemPath = path.join(RAW_ALL_DIR, item);
    return fs.statSync(itemPath).isDirectory();
  });
  
  let archived = 0;
  for (const venueDir of venueDirs) {
    try {
      const sourcePath = path.join(RAW_ALL_DIR, venueDir);
      const destPath = path.join(RAW_PREVIOUS_DIR, venueDir);
      
      // Remove existing archive for this venue if it exists
      if (fs.existsSync(destPath)) {
        fs.rmSync(destPath, { recursive: true, force: true });
      }
      
      // Move to previous
      fs.renameSync(sourcePath, destPath);
      archived++;
    } catch (error) {
      log(`  ⚠️  Failed to archive ${venueDir}: ${error.message}`);
    }
  }
  
  log(`  ✅ Archived ${archived} venue(s) to raw/previous/`);
  return true;
}

/**
 * Check if raw file exists and was downloaded today
 */
function rawFileExists(venueId, url) {
  const filePath = getRawFilePath(venueId, url);
  if (!fs.existsSync(filePath)) {
    return false;
  }
  
  // Check if file was downloaded today
  return isFileFromToday(filePath);
}

/**
 * Save raw HTML to file (saves to both all/ and incremental/)
 */
function saveRawHtml(venueId, url, html) {
  // Save to raw/all/ (main storage)
  const filePath = getRawFilePath(venueId, url);
  fs.writeFileSync(filePath, html, 'utf8');
  
  // Also copy to raw/incremental/ for incremental processing
  const incrementalDir = path.join(RAW_INCREMENTAL_DIR, venueId);
  if (!fs.existsSync(incrementalDir)) {
    fs.mkdirSync(incrementalDir, { recursive: true });
  }
  const hash = urlToHash(url);
  const incrementalPath = path.join(incrementalDir, `${hash}.html`);
  fs.writeFileSync(incrementalPath, html, 'utf8');
  
  return filePath;
}

/**
 * Read raw HTML from file
 */
function readRawHtml(venueId, url) {
  const filePath = getRawFilePath(venueId, url);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return fs.readFileSync(filePath, 'utf8');
}

/**
 * Fetch URL with retries
 */
async function fetchUrl(url, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        redirect: 'follow',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const html = await response.text();
      return { html, fromCache: false };
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      if (i === retries) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
}

/**
 * Find subpage links from HTML
 */
function findSubpageLinks(html, baseUrl) {
  const cheerio = require('cheerio');
  const $ = cheerio.load(html);
  const links = new Set();
  const baseUrlObj = new URL(baseUrl);
  
  $('a[href]').each((i, elem) => {
    const href = $(elem).attr('href');
    if (!href) return;
    
    try {
      const resolvedUrl = new URL(href, baseUrl).href;
      const urlObj = new URL(resolvedUrl);
      
      // Only include links from the same domain
      if (urlObj.hostname === baseUrlObj.hostname) {
        const hrefLower = href.toLowerCase();
        const linkText = $(elem).text().toLowerCase();
        
        // Check if link contains keywords
        const matchesKeyword = SUBPAGE_KEYWORDS.some(keyword => 
          hrefLower.includes(keyword) || linkText.includes(keyword)
        );
        
        if (matchesKeyword) {
          links.add(resolvedUrl);
        }
      }
    } catch (e) {
      // Skip invalid URLs
    }
  });
  
  return Array.from(links).slice(0, MAX_SUBPAGES);
}

/**
 * Process a single venue
 */
async function processVenue(venue) {
  const venueId = venue.id || venue.place_id;
  const website = venue.website;
  
  if (!website) {
    log(`  ⏭️  Skipping ${venue.name}: No website`);
    return { venue: venue.name, skipped: true, reason: 'no_website' };
  }
  
  try {
    log(`  📥 Processing ${venue.name} (${venueId})`);
    
    // Check if homepage already downloaded today
    const homepageExists = rawFileExists(venueId, website);
    let homepageHtml;
    let homepageDownloaded = false;
    
    if (homepageExists) {
      log(`  💾 Using today's raw file for homepage: ${website}`);
      homepageHtml = readRawHtml(venueId, website);
    } else {
      log(`  🔄 Downloading homepage: ${website}`);
      const result = await fetchUrl(website);
      homepageHtml = result.html;
      const hash = urlToHash(website);
      saveRawHtml(venueId, website, homepageHtml);
      saveMetadata(venueId, website, hash);
      homepageDownloaded = true;
      log(`  ✅ Saved homepage: ${getRawFilePath(venueId, website)}`);
    }
    
    // Find subpage links
    const subpageUrls = findSubpageLinks(homepageHtml, website);
    log(`  🔗 Found ${subpageUrls.length} subpage(s)`);
    
    // Download subpages
    let downloadedSubpages = 0;
    let skippedSubpages = 0;
    
    for (const subpageUrl of subpageUrls) {
      if (rawFileExists(venueId, subpageUrl)) {
        skippedSubpages++;
        log(`  💾 Using today's raw file for subpage: ${subpageUrl}`);
      } else {
        try {
          log(`  🔄 Downloading subpage: ${subpageUrl}`);
          const result = await fetchUrl(subpageUrl);
          const hash = urlToHash(subpageUrl);
          saveRawHtml(venueId, subpageUrl, result.html);
          saveMetadata(venueId, subpageUrl, hash);
          downloadedSubpages++;
          log(`  ✅ Saved subpage: ${getRawFilePath(venueId, subpageUrl)}`);
          
          // Rate limiting
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
          log(`  ❌ Failed to download subpage ${subpageUrl}: ${error.message}`);
        }
      }
    }
    
    // Count homepage
    const downloaded = (homepageDownloaded ? 1 : 0) + downloadedSubpages;
    const skipped = (homepageExists ? 1 : 0) + skippedSubpages;
    
    return {
      venue: venue.name,
      venueId,
      homepage: website,
      subpages: subpageUrls.length,
      downloaded,
      skipped: skipped + (homepageExists ? 1 : 0), // Include homepage in skipped count
      success: true
    };
  } catch (error) {
    log(`  ❌ Error processing ${venue.name}: ${error.message}`);
    return { venue: venue.name, error: error.message };
  }
}

/**
 * Main function
 */
async function main() {
  log('📥 Starting Raw HTML Download\n');
  
  const today = getTodayDateString();
  const lastDownload = getLastDownloadDate();
  
  log(`📅 Today: ${today}`);
  log(`📅 Last download: ${lastDownload || 'Never'}\n`);
  
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
    log(`📖 Loading venues from: ${path.relative(process.cwd(), venuesPath)}\n`);
  } else if (!fs.existsSync(VENUES_PATH)) {
    log(`❌ Venues file not found in either location:`);
    log(`   ${REPORTING_VENUES_PATH}`);
    log(`   ${VENUES_PATH}`);
    log(`\n   Please run 'node scripts/seed-venues.js' first.`);
    process.exit(1);
  }
  
  const venues = JSON.parse(fs.readFileSync(venuesPath, 'utf8'));
  log(`📖 Loaded ${venues.length} venue(s) from venues.json\n`);
  
  // CRITICAL: If same day, only check for NEW venues (venues without raw files)
  // Also check for REMOVED venues (venues with raw files but not in venues.json)
  // If no new venues found, abort to minimize API calls
  if (lastDownload && lastDownload === today) {
    log(`⏭️  Same day as last download (${today}) - checking for new and removed venues`);
    
    // Get all venue IDs from venues.json
    const venuesInJson = new Set();
    venues.forEach(v => {
      const venueId = v.id || v.place_id;
      if (venueId) venuesInJson.add(venueId);
    });
    
    // Check for new venues (venues not in raw/all/)
    const existingVenueDirs = new Set();
    if (fs.existsSync(RAW_ALL_DIR)) {
      const dirs = fs.readdirSync(RAW_ALL_DIR).filter(item => {
        const itemPath = path.join(RAW_ALL_DIR, item);
        return fs.statSync(itemPath).isDirectory();
      });
      dirs.forEach(dir => existingVenueDirs.add(dir));
    }
    
    // Check for removed venues (venues with raw files but not in venues.json)
    const removedVenues = [];
    existingVenueDirs.forEach(venueId => {
      if (!venuesInJson.has(venueId)) {
        removedVenues.push(venueId);
      }
    });
    
    if (removedVenues.length > 0) {
      log(`   ⚠️  Found ${removedVenues.length} removed venue(s) (have raw files but not in venues.json):`);
      removedVenues.slice(0, 10).forEach(venueId => {
        log(`      - ${venueId}`);
      });
      if (removedVenues.length > 10) {
        log(`      ... and ${removedVenues.length - 10} more`);
      }
      log(`   💡 These venues were removed from venues.json but still have raw files.`);
      log(`   💡 Raw files are preserved but won't be processed in the pipeline.\n`);
    }
    
    // Filter to only new venues (venues with websites that don't have raw files)
    let newVenues = venues.filter(v => {
      const venueId = v.id || v.place_id;
      return v.website && !existingVenueDirs.has(venueId);
    });
    
    // Apply area filter if specified
    if (areaFilter && newVenues.length > 0) {
      newVenues = newVenues.filter(v => 
        (v.area && v.area.toLowerCase() === areaFilter.toLowerCase()) ||
        (v.addressComponents && v.addressComponents.some(ac => 
          ac.types.includes('sublocality') && ac.long_name.toLowerCase() === areaFilter.toLowerCase()
        ))
      );
    }
    
    if (newVenues.length === 0) {
      if (removedVenues.length > 0) {
        log(`   No new venues found. All venues in venues.json already have raw files.`);
        log(`\n✨ Skipped download (incremental mode - no new venues, ${removedVenues.length} removed venue(s) detected)`);
      } else {
        log(`   No new venues found. All venues already have raw files.`);
        log(`\n✨ Skipped download (incremental mode - no new venues)`);
      }
      return;
    }
    
    log(`   Found ${newVenues.length} new venue(s) to download\n`);
    
    // Process only new venues
    const results = [];
    for (let i = 0; i < newVenues.length; i += PARALLEL_WORKERS) {
      const batch = newVenues.slice(i, i + PARALLEL_WORKERS);
      const batchPromises = batch.map(venue => processVenue(venue));
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      log(`\n📊 Progress: ${results.length}/${newVenues.length} processed\n`);
    }
    
    // Summary for new venues only
    const successful = results.filter(r => r.success).length;
    const skipped = results.filter(r => r.skipped).length;
    const errors = results.filter(r => r.error).length;
    const totalDownloaded = results.reduce((sum, r) => sum + (r.downloaded || 0), 0);
    const totalSkipped = results.reduce((sum, r) => sum + (r.skipped || 0), 0);
    
    // Save last download date
    saveLastDownloadDate();
    
    log(`\n📊 Summary:`);
    log(`   ✅ Successful: ${successful}`);
    log(`   ⏭️  Skipped: ${skipped}`);
    log(`   ❌ Errors: ${errors}`);
    log(`   📥 Files downloaded today: ${totalDownloaded}`);
    log(`   💾 Files skipped (already downloaded today): ${totalSkipped}`);
    log(`   📅 Download date: ${today}`);
    log(`\n✨ Done! Raw HTML saved to: ${path.resolve(RAW_ALL_DIR)}`);
    log(`   Previous day's data: ${path.resolve(RAW_PREVIOUS_DIR)}`);
    return;
  }
  
  // NEW DAY: Download all venues (full batch)
  // Archive previous day if it's a new day
  const archived = archivePreviousDay();
  if (archived) {
    log(`\n📦 Previous day's data archived to raw/previous/\n`);
  }
  
  // Filter by area if specified
  let venuesToProcess = venues;
  if (areaFilter) {
    venuesToProcess = venues.filter(v => 
      (v.area && v.area.toLowerCase() === areaFilter.toLowerCase()) ||
      (v.addressComponents && v.addressComponents.some(ac => 
        ac.types.includes('sublocality') && ac.long_name.toLowerCase() === areaFilter.toLowerCase()
      ))
    );
    log(`📍 Filtered to ${venuesToProcess.length} venue(s) in ${areaFilter}\n`);
  }
  
  // Filter venues with websites
  venuesToProcess = venuesToProcess.filter(v => v.website);
  log(`🌐 Processing ${venuesToProcess.length} venue(s) with websites\n`);
  
  // Process venues with parallel workers
  const results = [];
  const workers = [];
  
  for (let i = 0; i < venuesToProcess.length; i += PARALLEL_WORKERS) {
    const batch = venuesToProcess.slice(i, i + PARALLEL_WORKERS);
    const batchPromises = batch.map(venue => processVenue(venue));
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    
    log(`\n📊 Progress: ${results.length}/${venuesToProcess.length} processed\n`);
  }
  
  // Summary
  const successful = results.filter(r => r.success).length;
  const skipped = results.filter(r => r.skipped).length;
  const errors = results.filter(r => r.error).length;
  const totalDownloaded = results.reduce((sum, r) => sum + (r.downloaded || 0), 0);
  const totalSkipped = results.reduce((sum, r) => sum + (r.skipped || 0), 0);
  
  // Save last download date
  saveLastDownloadDate();
  
  log(`\n📊 Summary:`);
  log(`   ✅ Successful: ${successful}`);
  log(`   ⏭️  Skipped: ${skipped}`);
  log(`   ❌ Errors: ${errors}`);
  log(`   📥 Files downloaded today: ${totalDownloaded}`);
  log(`   💾 Files skipped (already downloaded today): ${totalSkipped}`);
  log(`   📅 Download date: ${today}`);
  log(`\n✨ Done! Raw HTML saved to: ${path.resolve(RAW_ALL_DIR)}`);
  log(`   Previous day's data: ${path.resolve(RAW_PREVIOUS_DIR)}`);
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
