#!/usr/bin/env node

/**
 * Delta Trimmed Files - Find Changes in Trimmed Content
 * 
 * Compares silver_trimmed/today/ (today) vs silver_trimmed/previous/ (yesterday) to find:
 * - New venues (exist in today/ but not in previous/)
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
const SILVER_TRIMMED_TODAY_DIR = path.join(__dirname, '../data/silver_trimmed/today');
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
  
  // Remove Google Analytics / GTM IDs (e.g., "gtm-abc123", "UA-123456-7", "G-[A-Z0-9]+")
  normalized = normalized.replace(/gtm-[a-z0-9]+/gi, '');
  normalized = normalized.replace(/UA-\d+-\d+/g, '');
  normalized = normalized.replace(/G-[A-Z0-9]+/g, '');
  
  // Remove common tracking parameters in URLs (even if they appear in text)
  normalized = normalized.replace(/[?&](sid|fbclid|utm_[^=\s&]+|gclid|_ga|_gid|ref|source|tracking|campaign)=[^\s&"']+/gi, '');
  
  // Remove dynamic footers: "Copyright © [year]", "All rights reserved", "Powered by ..."
  normalized = normalized.replace(/Copyright\s+©\s+\d{4}/gi, '');
  normalized = normalized.replace(/All\s+rights\s+reserved/gi, '');
  normalized = normalized.replace(/Powered\s+by\s+[^\s]+/gi, '');
  normalized = normalized.replace(/©\s+\d{4}\s+[^\n]+/gi, '');
  
  // Remove session IDs and tracking tokens
  normalized = normalized.replace(/\b(session|sid|token|tracking)[-_]?[a-z0-9]{8,}\b/gi, '');
  
  // More aggressive whitespace/newline collapse
  normalized = normalized.replace(/[\s\n\r\t]+/g, ' ').trim();
  
  return normalized;
}

/**
 * Get trimmed content hash from a trimmed JSON file
 * Always normalizes text before hashing to ensure consistent comparison
 * Uses venueHash if available (from new trim-silver-html.js), otherwise computes from pages
 * 
 * IMPORTANT: Always recomputes hash from normalized text to ensure consistency,
 * even if venueHash exists. This handles cases where files were created with
 * older normalization logic.
 */
function getTrimmedContentHash(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    // Always compute hash from normalized page texts for consistency
    // This ensures files created with older normalization logic are compared correctly
    const pages = data.pages || [];
    const pagesContent = pages.map(p => {
      const text = p.text || '';
      // Normalize text (same as trim-silver-html.js normalizeText function)
      return normalizeTextForHash(text);
    }).join('\n');
    
    const computedHash = crypto.createHash('md5').update(pagesContent).digest('hex');
    
    // If venueHash exists and differs from computed hash, log a warning
    // This helps identify normalization inconsistencies
    if (data.venueHash && data.venueHash !== computedHash) {
      const venueId = data.venueId || path.basename(filePath, '.json');
      log(`  ⚠️  Hash mismatch for ${venueId}: venueHash=${data.venueHash.substring(0, 8)}... vs computed=${computedHash.substring(0, 8)}... (using computed)`);
    }
    
    return computedHash;
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
  if (!fs.existsSync(SILVER_TRIMMED_TODAY_DIR)) {
    return false;
  }
  
  const files = fs.readdirSync(SILVER_TRIMMED_TODAY_DIR).filter(f => f.endsWith('.json'));
  let archived = 0;
  
  for (const file of files) {
    try {
      const sourcePath = path.join(SILVER_TRIMMED_TODAY_DIR, file);
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
  if (!fs.existsSync(SILVER_TRIMMED_TODAY_DIR)) {
    log(`❌ Trimmed directory not found: ${SILVER_TRIMMED_TODAY_DIR}`);
    log(`   Run trim-silver-html.js first.`);
    process.exit(1);
  }
  
  // Check if this is a new day - archive previous day's data
  const today = getTodayDateString();
  const lastTrim = getLastTrimDate();
  
  // Check if previous/ directory exists and has files
  let previousFiles = fs.existsSync(SILVER_TRIMMED_PREVIOUS_DIR) 
    ? fs.readdirSync(SILVER_TRIMMED_PREVIOUS_DIR).filter(f => f.endsWith('.json'))
    : [];
  let allFiles = fs.existsSync(SILVER_TRIMMED_TODAY_DIR)
    ? fs.readdirSync(SILVER_TRIMMED_TODAY_DIR).filter(f => f.endsWith('.json'))
    : [];
  
  // Debug logging: show file counts and sample filenames
  log(`📊 File counts: previous/ contains ${previousFiles.length} file(s), today/ contains ${allFiles.length} file(s)`);
  
  // Warn if counts mismatch on new day (should match after archive)
  if (lastTrim && lastTrim !== today && previousFiles.length > 0 && allFiles.length > 0) {
    if (previousFiles.length !== allFiles.length) {
      log(`   ⚠️  WARNING: Count mismatch on new day! previous/ has ${previousFiles.length} files but today/ has ${allFiles.length} files`);
      log(`     This may indicate incomplete archive. Expected counts to match.`);
    }
  }
  
  if (previousFiles.length > 0) {
    const firstFivePrevious = previousFiles.slice(0, 5);
    log(`   First 5 files in previous/: ${firstFivePrevious.join(', ')}`);
  } else {
    log(`   ⚠️  previous/ is empty`);
  }
  if (allFiles.length > 0) {
    const firstFiveAll = allFiles.slice(0, 5);
    log(`   First 5 files in today/: ${firstFiveAll.join(', ')}`);
  } else {
    log(`   ⚠️  today/ is empty`);
  }
  log('');
  
  // If previous/ is empty but today/ has files, we need to populate previous/ first
  // This handles the case where trim ran and populated today/ but previous/ wasn't archived yet
  if (previousFiles.length === 0 && allFiles.length > 0) {
    if (lastTrim && lastTrim !== today) {
      // New day - archive current today/ to previous/ (this is yesterday's data)
      log(`📅 New day detected (${today}, previous: ${lastTrim})`);
      log(`📦 Archiving current today/ to previous/ (yesterday's data)...`);
      const archived = archivePreviousDay();
      if (archived) {
        // Re-read previousFiles after archive
        previousFiles = fs.readdirSync(SILVER_TRIMMED_PREVIOUS_DIR).filter(f => f.endsWith('.json'));
        log(`   ✅ After archive: previous/ now contains ${previousFiles.length} file(s)\n`);
      } else {
        // Archive failed or returned false - force copy from today/ to previous/
        log(`⚠️  Archive returned false - forcing copy from today/ to previous/`);
        if (!fs.existsSync(SILVER_TRIMMED_PREVIOUS_DIR)) {
          fs.mkdirSync(SILVER_TRIMMED_PREVIOUS_DIR, { recursive: true });
        }
        let copied = 0;
        for (const file of allFiles) {
          try {
            const sourcePath = path.join(SILVER_TRIMMED_TODAY_DIR, file);
            const destPath = path.join(SILVER_TRIMMED_PREVIOUS_DIR, file);
            fs.copyFileSync(sourcePath, destPath);
            copied++;
          } catch (error) {
            log(`  ⚠️  Failed to copy ${file}: ${error.message}`);
          }
        }
        log(`  ✅ Copied ${copied} file(s) from today/ to previous/`);
        previousFiles = fs.readdirSync(SILVER_TRIMMED_PREVIOUS_DIR).filter(f => f.endsWith('.json'));
        log(`   ✅ After copy: previous/ now contains ${previousFiles.length} file(s)\n`);
      }
    } else if (!lastTrim) {
      log(`📅 First run - no previous data to compare\n`);
    } else {
      // Same day but previous/ is empty - force copy from today/ to previous/ for comparison
      log(`⚠️  Same day but previous/ is empty - Populating empty previous/ from today/ for same-day delta`);
      
      // Ensure previous/ directory exists
      if (!fs.existsSync(SILVER_TRIMMED_PREVIOUS_DIR)) {
        fs.mkdirSync(SILVER_TRIMMED_PREVIOUS_DIR, { recursive: true });
      }
      
      // Force copy all files from today/ to previous/ with exact filenames
      let copied = 0;
      for (const file of allFiles) {
        try {
          const sourcePath = path.join(SILVER_TRIMMED_TODAY_DIR, file);
          const destPath = path.join(SILVER_TRIMMED_PREVIOUS_DIR, file);
          fs.copyFileSync(sourcePath, destPath);
          copied++;
        } catch (error) {
          log(`  ⚠️  Failed to copy ${file}: ${error.message}`);
        }
      }
      
      log(`  ✅ Copied ${copied} file(s) from today/ to previous/ for same-day comparison`);
      
      // Re-read previousFiles after copy
      previousFiles = fs.readdirSync(SILVER_TRIMMED_PREVIOUS_DIR).filter(f => f.endsWith('.json'));
      log(`   ✅ After copy: previous/ now contains ${previousFiles.length} file(s)\n`);
    }
  } else if (lastTrim && lastTrim !== today && previousFiles.length > 0) {
    // New day and previous/ already has data - archive it (refresh)
    log(`📅 New day detected (${today}, previous: ${lastTrim})`);
    log(`📦 Archiving previous day's trimmed data...`);
    archivePreviousDay();
    // Re-read previousFiles after archive
    previousFiles = fs.readdirSync(SILVER_TRIMMED_PREVIOUS_DIR).filter(f => f.endsWith('.json'));
    log(`   ✅ After archive: previous/ now contains ${previousFiles.length} file(s)\n`);
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
  
  // Refresh todayFiles list after potential archive (in case archive modified today/)
  const todayFilesList = fs.existsSync(SILVER_TRIMMED_TODAY_DIR)
    ? fs.readdirSync(SILVER_TRIMMED_TODAY_DIR).filter(f => f.endsWith('.json'))
    : [];
  
  // Refresh previousFiles list as well
  const previousFilesList = fs.existsSync(SILVER_TRIMMED_PREVIOUS_DIR)
    ? fs.readdirSync(SILVER_TRIMMED_PREVIOUS_DIR).filter(f => f.endsWith('.json'))
    : [];
  
  log(`📁 Found ${todayFilesList.length} venue file(s) in silver_trimmed/today/`);
  log(`📁 Found ${previousFilesList.length} venue file(s) in silver_trimmed/previous/\n`);
  
  let newVenues = 0;
  let changedVenues = 0;
  let unchangedVenues = 0;
  
  // Process each file
  for (const file of todayFilesList) {
    const venueId = path.basename(file, '.json');
    const todayFilePath = path.join(SILVER_TRIMMED_TODAY_DIR, file);
    const previousFilePath = path.join(SILVER_TRIMMED_PREVIOUS_DIR, file);
    const incrementalFilePath = path.join(SILVER_TRIMMED_INCREMENTAL_DIR, file);
    
    // Check if venue is new (doesn't exist in previous/)
    if (!fs.existsSync(previousFilePath)) {
      // New venue - copy to incremental
      fs.copyFileSync(todayFilePath, incrementalFilePath);
      log(`  ✨ New venue: ${venueId}`);
      newVenues++;
      continue;
    }
    
    // Verify file exists in previousFilesList (sanity check)
    if (!previousFilesList.includes(file)) {
      log(`  ⚠️  WARNING: File ${file} exists in previous/ but not in previousFilesList - treating as new`);
      fs.copyFileSync(todayFilePath, incrementalFilePath);
      newVenues++;
      continue;
    }
    
    // Venue exists in both - check for changes in trimmed content
    const todayHash = getTrimmedContentHash(todayFilePath);
    const previousHash = getTrimmedContentHash(previousFilePath);
    
    if (!todayHash || !previousHash) {
      // Error reading hashes - treat as changed to be safe
      fs.copyFileSync(todayFilePath, incrementalFilePath);
      log(`  ⚠️  Changed venue (hash error): ${venueId}`);
      changedVenues++;
      continue;
    }
    
    if (todayHash !== previousHash) {
      // Trimmed content changed - copy to incremental
      fs.copyFileSync(todayFilePath, incrementalFilePath);
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
