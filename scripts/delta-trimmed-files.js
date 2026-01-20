#!/usr/bin/env node

/**
 * Delta Trimmed Files - Find Changes in Trimmed Content
 * 
 * Compares silver_trimmed/all/ (today) vs silver_trimmed/previous/ (yesterday) to find:
 * - New venues (exist in all/ but not in previous/)
 * - Changed files (different trimmed content hash)
 * 
 * Only changed/new files are copied to silver_trimmed/incremental/ for LLM processing.
 * This ensures LLM only processes files where actual visible content changed,
 * ignoring dynamic noise like ads, timestamps, tracking cookies, etc.
 * 
 * Run with: node scripts/delta-trimmed-files.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Logging setup
const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logPath = path.join(logDir, 'delta-trimmed-files.log');

fs.writeFileSync(logPath, '', 'utf8');

function log(message) {
  const ts = new Date().toISOString();
  console.log(message);
  fs.appendFileSync(logPath, `[${ts}] ${message}\n`);
}

// Paths
const SILVER_TRIMMED_ALL_DIR = path.join(__dirname, '../data/silver_trimmed/all');
const SILVER_TRIMMED_PREVIOUS_DIR = path.join(__dirname, '../data/silver_trimmed/previous');
const SILVER_TRIMMED_INCREMENTAL_DIR = path.join(__dirname, '../data/silver_trimmed/incremental');
const LAST_TRIM_PATH = path.join(__dirname, '../data/silver_trimmed/.last-trim');

// Ensure directories exist
if (!fs.existsSync(SILVER_TRIMMED_INCREMENTAL_DIR)) {
  fs.mkdirSync(SILVER_TRIMMED_INCREMENTAL_DIR, { recursive: true });
}
if (!fs.existsSync(SILVER_TRIMMED_PREVIOUS_DIR)) {
  fs.mkdirSync(SILVER_TRIMMED_PREVIOUS_DIR, { recursive: true });
}

/**
 * Normalize text (same logic as trim-silver-html.js)
 */
function normalizeTextForHash(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }
  
  let normalized = text;
  
  // Remove ISO timestamps (e.g., "2026-01-20T15:34:58.724Z" or "2026-01-20")
  normalized = normalized.replace(/\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?)?/g, '');
  
  // Remove common month-day patterns (e.g., "Jan 20", "Jan 20, 2026", "January 20, 2026")
  normalized = normalized.replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(,\s+\d{4})?\b/gi, '');
  
  // Remove "Loading..." or placeholder phrases
  normalized = normalized.replace(/Loading\s+product\s+options\.\.\.|Loading\.\.\./gi, '');
  
  // Collapse all whitespace to single spaces and trim
  normalized = normalized.replace(/\s+/g, ' ').trim();
  
  return normalized;
}

/**
 * Get trimmed content hash from a trimmed JSON file
 * Always normalizes text before hashing to ensure consistent comparison
 * Uses page.hash if it looks normalized (32 char hex), otherwise normalizes text
 */
function getTrimmedContentHash(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const pages = data.pages || [];
    
    // Always normalize and compute hash from text to ensure consistency
    // This handles both old files (with raw HTML hash) and new files (with normalized hash)
    const pagesContent = pages.map(p => {
      const text = p.text || '';
      // Normalize text (same as trim-silver-html.js)
      return normalizeTextForHash(text);
    }).join('\n');
    
    return crypto.createHash('md5').update(pagesContent).digest('hex');
  } catch (error) {
    log(`  ⚠️  Error reading file ${filePath}: ${error.message}`);
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
 * Get last trim date from metadata
 */
function getLastTrimDate() {
  if (!fs.existsSync(LAST_TRIM_PATH)) {
    return null;
  }
  try {
    return fs.readFileSync(LAST_TRIM_PATH, 'utf8').trim();
  } catch (e) {
    return null;
  }
}

/**
 * Archive current trimmed/all/ to trimmed/previous/ on new day
 */
function archivePreviousDay() {
  const today = getTodayDateString();
  const lastTrim = getLastTrimDate();
  
  // If no previous trim or same day, no need to archive
  if (!lastTrim || lastTrim === today) {
    return false;
  }
  
  log(`📅 New day detected (${today}, previous: ${lastTrim})`);
  log(`📦 Archiving previous day's trimmed data...`);
  
  // Remove existing previous/ directory
  if (fs.existsSync(SILVER_TRIMMED_PREVIOUS_DIR)) {
    fs.rmSync(SILVER_TRIMMED_PREVIOUS_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(SILVER_TRIMMED_PREVIOUS_DIR, { recursive: true });
  
  // Copy all files from all/ to previous/
  if (!fs.existsSync(SILVER_TRIMMED_ALL_DIR)) {
    return false;
  }
  
  const files = fs.readdirSync(SILVER_TRIMMED_ALL_DIR).filter(f => f.endsWith('.json'));
  let archived = 0;
  
  for (const file of files) {
    try {
      const sourcePath = path.join(SILVER_TRIMMED_ALL_DIR, file);
      const destPath = path.join(SILVER_TRIMMED_PREVIOUS_DIR, file);
      fs.copyFileSync(sourcePath, destPath);
      archived++;
    } catch (error) {
      log(`  ⚠️  Failed to archive ${file}: ${error.message}`);
    }
  }
  
  log(`  ✅ Archived ${archived} file(s) to silver_trimmed/previous/`);
  return true;
}

/**
 * Main function
 */
function main() {
  log('🔍 Starting Delta Comparison (Trimmed Content)\n');
  
  // Check if silver_trimmed/all/ exists
  if (!fs.existsSync(SILVER_TRIMMED_ALL_DIR)) {
    log(`❌ Trimmed directory not found: ${SILVER_TRIMMED_ALL_DIR}`);
    log(`   Run trim-silver-html.js first.`);
    process.exit(1);
  }
  
  // Check if this is a new day - archive previous day's data
  const today = getTodayDateString();
  const lastTrim = getLastTrimDate();
  
  // Check if previous/ directory exists and has files
  const previousFiles = fs.existsSync(SILVER_TRIMMED_PREVIOUS_DIR) 
    ? fs.readdirSync(SILVER_TRIMMED_PREVIOUS_DIR).filter(f => f.endsWith('.json'))
    : [];
  const allFiles = fs.existsSync(SILVER_TRIMMED_ALL_DIR)
    ? fs.readdirSync(SILVER_TRIMMED_ALL_DIR).filter(f => f.endsWith('.json'))
    : [];
  
  // If previous/ is empty but all/ has files, we need to archive all/ to previous/ first
  // This handles the case where trim ran and populated all/ but previous/ wasn't archived yet
  if (previousFiles.length === 0 && allFiles.length > 0) {
    if (lastTrim && lastTrim !== today) {
      // New day - archive current all/ to previous/ (this is yesterday's data)
      log(`📅 New day detected (${today}, previous: ${lastTrim})`);
      log(`📦 Archiving current all/ to previous/ (yesterday's data)...`);
      archivePreviousDay();
    } else if (!lastTrim) {
      log(`📅 First run - no previous data to compare\n`);
    } else {
      // Same day but previous/ is empty - this shouldn't happen normally
      // But if it does, archive all/ to previous/ to establish baseline
      log(`⚠️  Same day but previous/ is empty - archiving all/ to previous/ to establish baseline`);
      archivePreviousDay();
    }
  } else if (lastTrim && lastTrim !== today) {
    // New day and previous/ already has data - archive it (refresh)
    log(`📅 New day detected (${today}, previous: ${lastTrim})`);
    log(`📦 Archiving previous day's trimmed data...`);
    archivePreviousDay();
  } else if (!lastTrim) {
    log(`📅 First run - no previous data to compare\n`);
  } else {
    log(`📅 Same day as last trim (${today}) - comparing against previous day's data\n`);
  }
  
  // Clear incremental folder at start
  if (fs.existsSync(SILVER_TRIMMED_INCREMENTAL_DIR)) {
    const existingFiles = fs.readdirSync(SILVER_TRIMMED_INCREMENTAL_DIR).filter(f => f.endsWith('.json'));
    existingFiles.forEach(file => {
      const filePath = path.join(SILVER_TRIMMED_INCREMENTAL_DIR, file);
      fs.unlinkSync(filePath);
    });
    if (existingFiles.length > 0) {
      log(`🧹 Cleared ${existingFiles.length} file(s) from incremental folder\n`);
    }
  }
  
  // Refresh allFiles list after potential archive (in case archive modified all/)
  const allFilesList = fs.existsSync(SILVER_TRIMMED_ALL_DIR)
    ? fs.readdirSync(SILVER_TRIMMED_ALL_DIR).filter(f => f.endsWith('.json'))
    : [];
  
  log(`📁 Found ${allFilesList.length} venue file(s) in silver_trimmed/all/\n`);
  
  let newVenues = 0;
  let changedVenues = 0;
  let unchangedVenues = 0;
  
  // Process each file
  for (const file of allFilesList) {
    const venueId = path.basename(file, '.json');
    const allFilePath = path.join(SILVER_TRIMMED_ALL_DIR, file);
    const previousFilePath = path.join(SILVER_TRIMMED_PREVIOUS_DIR, file);
    const incrementalFilePath = path.join(SILVER_TRIMMED_INCREMENTAL_DIR, file);
    
    // Check if venue is new (doesn't exist in previous/)
    if (!fs.existsSync(previousFilePath)) {
      // New venue - copy to incremental
      fs.copyFileSync(allFilePath, incrementalFilePath);
      log(`  ✨ New venue: ${venueId}`);
      newVenues++;
      continue;
    }
    
    // Venue exists in both - check for changes in trimmed content
    const allHash = getTrimmedContentHash(allFilePath);
    const previousHash = getTrimmedContentHash(previousFilePath);
    
    if (!allHash || !previousHash) {
      // Error reading hashes - treat as changed to be safe
      fs.copyFileSync(allFilePath, incrementalFilePath);
      log(`  ⚠️  Changed venue (hash error): ${venueId}`);
      changedVenues++;
      continue;
    }
    
    if (allHash !== previousHash) {
      // Trimmed content changed - copy to incremental
      fs.copyFileSync(allFilePath, incrementalFilePath);
      log(`  🔄 Changed venue: ${venueId}`);
      changedVenues++;
    } else {
      // No change in trimmed content
      unchangedVenues++;
    }
  }
  
  // Summary
  log(`\n📊 Delta Summary (Trimmed Content):`);
  log(`   ✨ New venues: ${newVenues}`);
  log(`   🔄 Changed venues: ${changedVenues}`);
  log(`   ⏭️  Unchanged venues: ${unchangedVenues}`);
  log(`   📄 Total files ready for LLM: ${newVenues + changedVenues}`);
  log(`\n✨ Done! Changed files copied to: ${path.resolve(SILVER_TRIMMED_INCREMENTAL_DIR)}`);
  
  // If no changes, log warning
  if (newVenues + changedVenues === 0) {
    log(`\n⚠️  No changes detected - incremental folder is empty`);
    log(`   LLM extraction step will skip processing.`);
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
