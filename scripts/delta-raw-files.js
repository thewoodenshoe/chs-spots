#!/usr/bin/env node

/**
 * Delta Raw Files - Find Changes Between Days
 * 
 * Compares raw/today/ (today) vs raw/previous/ (yesterday) to find:
 * - New venues (exist in today/ but not in previous/)
 * - Changed files (different content/hash)
 * 
 * Only changed/new files are copied to raw/incremental/ for processing.
 * This ensures silver and gold only process a small batch of changes per day.
 * 
 * Run with: node scripts/delta-raw-files.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Logging setup
const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logPath = path.join(logDir, 'delta-raw-files.log');

fs.writeFileSync(logPath, '', 'utf8');

function log(message) {
  const ts = new Date().toISOString();
  console.log(message);
  fs.appendFileSync(logPath, `[${ts}] ${message}\n`);
}

// Paths
const RAW_TODAY_DIR = path.join(__dirname, '../data/raw/today');
const RAW_PREVIOUS_DIR = path.join(__dirname, '../data/raw/previous');
const RAW_INCREMENTAL_DIR = path.join(__dirname, '../data/raw/incremental');

// Ensure incremental directory exists
if (!fs.existsSync(RAW_INCREMENTAL_DIR)) {
  fs.mkdirSync(RAW_INCREMENTAL_DIR, { recursive: true });
}

/**
 * Calculate MD5 hash of file content
 */
function getFileHash(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return crypto.createHash('md5').update(content).digest('hex');
}

/**
 * Get all HTML files for a venue directory
 */
function getVenueHtmlFiles(venueDir) {
  if (!fs.existsSync(venueDir)) {
    return [];
  }
  return fs.readdirSync(venueDir)
    .filter(file => file.endsWith('.html'))
    .map(file => ({
      file,
      path: path.join(venueDir, file)
    }));
}

/**
 * Compare two files by hash
 */
function filesAreDifferent(file1Path, file2Path) {
  if (!fs.existsSync(file1Path) || !fs.existsSync(file2Path)) {
    return true;
  }
  const hash1 = getFileHash(file1Path);
  const hash2 = getFileHash(file2Path);
  return hash1 !== hash2;
}

/**
 * Copy file to incremental directory
 */
function copyToIncremental(venueId, file, sourcePath) {
  const incrementalVenueDir = path.join(RAW_INCREMENTAL_DIR, venueId);
  if (!fs.existsSync(incrementalVenueDir)) {
    fs.mkdirSync(incrementalVenueDir, { recursive: true });
  }
  const destPath = path.join(incrementalVenueDir, file);
  fs.copyFileSync(sourcePath, destPath);
}

/**
 * Copy metadata file if it exists
 */
function copyMetadataIfExists(venueId, sourceDir) {
  const metadataPath = path.join(sourceDir, 'metadata.json');
  if (fs.existsSync(metadataPath)) {
    const incrementalVenueDir = path.join(RAW_INCREMENTAL_DIR, venueId);
    if (!fs.existsSync(incrementalVenueDir)) {
      fs.mkdirSync(incrementalVenueDir, { recursive: true });
    }
    const destPath = path.join(incrementalVenueDir, 'metadata.json');
    fs.copyFileSync(metadataPath, destPath);
  }
}

/**
 * Get last download date
 */
function getLastDownloadDate() {
  const LAST_DOWNLOAD_PATH = path.join(__dirname, '../data/raw/.last-download');
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
 * Get today's date string (YYYY-MM-DD)
 */
function getTodayDateString() {
  const today = new Date();
  return today.toISOString().split('T')[0];
}

/**
 * Main function
 */
function main() {
  log('🔍 Starting Delta Comparison\n');
  
  // Check if raw/today/ exists
  if (!fs.existsSync(RAW_TODAY_DIR)) {
    log(`❌ Raw directory not found: ${RAW_TODAY_DIR}`);
    log(`   Run download-raw-html.js first.`);
    process.exit(1);
  }
  
  // Check if this is a new day - delta only needed on new day
  // On same day, new venues are already saved to incremental during download
  const today = getTodayDateString();
  const lastDownload = getLastDownloadDate();
  
  // Check if previous/ directory exists and has data to compare
  const hasPreviousData = fs.existsSync(RAW_PREVIOUS_DIR) && 
    fs.readdirSync(RAW_PREVIOUS_DIR).length > 0;
  
  if (lastDownload && lastDownload === today && !hasPreviousData) {
    log(`⏭️  Same day as last download (${today})`);
    log(`   New venues were already saved to incremental during download.`);
    log(`   Delta comparison not needed on same day (no previous data to compare).`);
    log(`\n✨ Skipped delta (same day - incremental already populated)`);
    return;
  }
  
  // If same day but previous data exists, this means we're comparing against yesterday's data
  // This can happen if the download updated the date but we still want to compare
  if (lastDownload && lastDownload === today && hasPreviousData) {
    log(`📅 Same day as last download (${today}), but previous data exists`);
    log(`   Running delta comparison against previous day's data...\n`);
  }
  
  log(`📅 New day detected (${today} vs ${lastDownload || 'Never'})`);
  log(`   Running delta comparison to find changes...\n`);
  
  // Clear incremental folder at start
  if (fs.existsSync(RAW_INCREMENTAL_DIR)) {
    const existingDirs = fs.readdirSync(RAW_INCREMENTAL_DIR);
    existingDirs.forEach(dir => {
      const dirPath = path.join(RAW_INCREMENTAL_DIR, dir);
      if (fs.statSync(dirPath).isDirectory()) {
        fs.rmSync(dirPath, { recursive: true, force: true });
      }
    });
    log(`🧹 Cleared incremental folder\n`);
  }
  
  // Get all venue directories from raw/today/
  const todayVenueDirs = fs.readdirSync(RAW_TODAY_DIR).filter(item => {
    const itemPath = path.join(RAW_TODAY_DIR, item);
    return fs.statSync(itemPath).isDirectory();
  });
  
  log(`📁 Found ${todayVenueDirs.length} venue(s) in raw/today/\n`);
  
  let newVenues = 0;
  let changedVenues = 0;
  let unchangedVenues = 0;
  let totalChangedFiles = 0;
  
  // Process each venue
  for (const venueId of todayVenueDirs) {
    const todayVenueDir = path.join(RAW_TODAY_DIR, venueId);
    const previousVenueDir = path.join(RAW_PREVIOUS_DIR, venueId);
    
    const todayFiles = getVenueHtmlFiles(todayVenueDir);
    
    // Check if venue is new (doesn't exist in previous/)
    if (!fs.existsSync(previousVenueDir)) {
      // New venue - copy all files
      log(`  ✨ New venue: ${venueId} (${todayFiles.length} file(s))`);
      for (const fileInfo of todayFiles) {
        copyToIncremental(venueId, fileInfo.file, fileInfo.path);
        totalChangedFiles++;
      }
      copyMetadataIfExists(venueId, todayVenueDir);
      newVenues++;
      continue;
    }
    
    // Venue exists in both - check for changes
    const previousFiles = getVenueHtmlFiles(previousVenueDir);
    const previousFileMap = new Map(previousFiles.map(f => [f.file, f.path]));
    
    let venueHasChanges = false;
    let venueChangedFiles = 0;
    
    for (const fileInfo of todayFiles) {
      const previousPath = previousFileMap.get(fileInfo.file);
      
      // New file or changed file
      if (!previousPath || filesAreDifferent(fileInfo.path, previousPath)) {
        copyToIncremental(venueId, fileInfo.file, fileInfo.path);
        venueHasChanges = true;
        venueChangedFiles++;
        totalChangedFiles++;
      }
    }
    
    if (venueHasChanges) {
      log(`  🔄 Changed venue: ${venueId} (${venueChangedFiles} file(s) changed)`);
      copyMetadataIfExists(venueId, todayVenueDir);
      changedVenues++;
    } else {
      unchangedVenues++;
    }
  }
  
  // Summary
  log(`\n📊 Delta Summary:`);
  log(`   ✨ New venues: ${newVenues}`);
  log(`   🔄 Changed venues: ${changedVenues}`);
  log(`   ⏭️  Unchanged venues: ${unchangedVenues}`);
  log(`   📄 Total changed files: ${totalChangedFiles}`);
  log(`\n✨ Done! Changed files copied to: ${path.resolve(RAW_INCREMENTAL_DIR)}`);
  
  // If no changes, log warning
  if (totalChangedFiles === 0) {
    log(`\n⚠️  No changes detected - incremental folder is empty`);
    log(`   Silver and gold steps will skip processing.`);
  }
}

try {
  main();
  process.exit(0);
} catch (error) {
  log(`❌ Fatal error: ${error.message || error}`);
  console.error(error);
  process.exit(1);
}
