/**
 * Compare Raw Files - Diff Detection for Happy Hour Pipeline
 * 
 * Compares raw/previous/ vs raw/ to identify changed venues.
 * Saves change report to data/raw/changes-YYYY-MM-DD.json
 * 
 * Change types:
 * - new: Venue exists in raw/ but not in raw/previous/
 * - modified: Venue exists in both but files changed (content hash)
 * - removed: Venue exists in raw/previous/ but not in raw/
 * - unchanged: Venue exists in both and files are identical
 * 
 * Run with: node scripts/compare-raw-files.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Logging setup
const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logPath = path.join(logDir, 'compare-raw-files.log');

fs.writeFileSync(logPath, '', 'utf8');

function log(message) {
  const ts = new Date().toISOString();
  console.log(message);
  fs.appendFileSync(logPath, `[${ts}] ${message}\n`);
}

// Paths
const RAW_DIR = path.join(__dirname, '../data/raw');
const RAW_PREVIOUS_DIR = path.join(__dirname, '../data/raw/previous');
const VENUES_PATH = path.join(__dirname, '../data/venues.json');

/**
 * Compute content hash for a file
 */
function computeContentHash(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    // Normalize whitespace for comparison
    const normalized = content.replace(/\s+/g, ' ').trim();
    return crypto.createHash('sha256').update(normalized).digest('hex');
  } catch (e) {
    return null;
  }
}

/**
 * Get all HTML files for a venue
 */
function getVenueFiles(venueDir) {
  if (!fs.existsSync(venueDir)) {
    return [];
  }
  
  const files = fs.readdirSync(venueDir)
    .filter(f => f.endsWith('.html'))
    .map(file => {
      const filePath = path.join(venueDir, file);
      return {
        file,
        hash: computeContentHash(filePath)
      };
    })
    .filter(f => f.hash !== null);
  
  return files;
}

/**
 * Compare two file sets
 */
function compareFileSets(currentFiles, previousFiles) {
  const currentMap = new Map(currentFiles.map(f => [f.file, f.hash]));
  const previousMap = new Map(previousFiles.map(f => [f.file, f.hash]));
  
  const newFiles = [];
  const modifiedFiles = [];
  const removedFiles = [];
  const unchangedFiles = [];
  
  // Check current files
  for (const [file, hash] of currentMap.entries()) {
    const prevHash = previousMap.get(file);
    
    if (!prevHash) {
      newFiles.push(file);
    } else if (hash !== prevHash) {
      modifiedFiles.push(file);
    } else {
      unchangedFiles.push(file);
    }
  }
  
  // Check removed files
  for (const [file] of previousMap.entries()) {
    if (!currentMap.has(file)) {
      removedFiles.push(file);
    }
  }
  
  return {
    newFiles,
    modifiedFiles,
    removedFiles,
    unchangedFiles,
    totalCurrent: currentFiles.length,
    totalPrevious: previousFiles.length
  };
}

/**
 * Compare a single venue
 */
function compareVenue(venueId, venues) {
  const venue = venues.find(v => (v.id || v.place_id) === venueId);
  const venueName = venue ? venue.name : venueId;
  
  const currentDir = path.join(RAW_DIR, venueId);
  const previousDir = path.join(RAW_PREVIOUS_DIR, venueId);
  
  const currentFiles = getVenueFiles(currentDir);
  const previousFiles = getVenueFiles(previousDir);
  
  // If no previous files, it's new
  if (previousFiles.length === 0 && currentFiles.length > 0) {
    return {
      venueId,
      venueName,
      status: 'new',
      currentFiles: currentFiles.length,
      previousFiles: 0
    };
  }
  
  // If no current files but previous existed, it's removed
  if (currentFiles.length === 0 && previousFiles.length > 0) {
    return {
      venueId,
      venueName,
      status: 'removed',
      currentFiles: 0,
      previousFiles: previousFiles.length
    };
  }
  
  // Compare file sets
  const comparison = compareFileSets(currentFiles, previousFiles);
  
  // Determine status
  let status = 'unchanged';
  if (comparison.newFiles.length > 0 || comparison.modifiedFiles.length > 0) {
    status = 'modified';
  } else if (comparison.removedFiles.length > 0 && currentFiles.length === 0) {
    status = 'removed';
  }
  
  return {
    venueId,
    venueName,
    status,
    currentFiles: currentFiles.length,
    previousFiles: previousFiles.length,
    newFiles: comparison.newFiles.length,
    modifiedFiles: comparison.modifiedFiles.length,
    removedFiles: comparison.removedFiles.length,
    unchangedFiles: comparison.unchangedFiles.length
  };
}

/**
 * Main function
 */
function main() {
  log('🔍 Starting Raw Files Comparison\n');
  
  // Check if previous directory exists
  if (!fs.existsSync(RAW_PREVIOUS_DIR)) {
    log(`⚠️  Previous directory not found: ${RAW_PREVIOUS_DIR}`);
    log(`   This is normal for the first run or if no previous day exists`);
    log(`   Run download-raw-html.js on a new day to create previous/`);
    process.exit(0);
  }
  
  // Load venues for name lookup
  let venues = [];
  if (fs.existsSync(VENUES_PATH)) {
    try {
      venues = JSON.parse(fs.readFileSync(VENUES_PATH, 'utf8'));
    } catch (e) {
      log(`⚠️  Could not load venues.json: ${e.message}`);
    }
  }
  
  // Get all venue directories from current and previous
  const currentVenueDirs = fs.existsSync(RAW_DIR) 
    ? fs.readdirSync(RAW_DIR).filter(item => {
        const itemPath = path.join(RAW_DIR, item);
        return fs.statSync(itemPath).isDirectory() && item !== 'previous';
      })
    : [];
  
  const previousVenueDirs = fs.readdirSync(RAW_PREVIOUS_DIR)
    .filter(item => {
      const itemPath = path.join(RAW_PREVIOUS_DIR, item);
      return fs.statSync(itemPath).isDirectory();
    });
  
  // Get all unique venue IDs
  const allVenueIds = new Set([...currentVenueDirs, ...previousVenueDirs]);
  
  log(`📁 Found ${currentVenueDirs.length} venue(s) in raw/`);
  log(`📁 Found ${previousVenueDirs.length} venue(s) in raw/previous/`);
  log(`📁 Comparing ${allVenueIds.size} unique venue(s)\n`);
  
  // Compare each venue
  const results = [];
  for (const venueId of allVenueIds) {
    const result = compareVenue(venueId, venues);
    results.push(result);
    
    if (result.status !== 'unchanged') {
      log(`  ${result.status === 'new' ? '🆕' : result.status === 'modified' ? '🔄' : '❌'} ${result.venueName} (${result.venueId}): ${result.status}`);
    }
  }
  
  // Summary
  const newCount = results.filter(r => r.status === 'new').length;
  const modifiedCount = results.filter(r => r.status === 'modified').length;
  const removedCount = results.filter(r => r.status === 'removed').length;
  const unchangedCount = results.filter(r => r.status === 'unchanged').length;
  
  log(`\n📊 Summary:`);
  log(`   🆕 New: ${newCount}`);
  log(`   🔄 Modified: ${modifiedCount}`);
  log(`   ❌ Removed: ${removedCount}`);
  log(`   ⬜ Unchanged: ${unchangedCount}`);
  
  // Save change report
  const today = new Date().toISOString().split('T')[0];
  const reportPath = path.join(RAW_DIR, `changes-${today}.json`);
  const report = {
    date: today,
    summary: {
      new: newCount,
      modified: modifiedCount,
      removed: removedCount,
      unchanged: unchangedCount,
      total: results.length
    },
    changes: results.filter(r => r.status !== 'unchanged'),
    all: results
  };
  
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  log(`\n📄 Change report saved to: ${reportPath}`);
  log(`\n✨ Done!`);
  log(`   Next: Process only modified/new venues in downstream steps`);
}

try {
  main();
} catch (error) {
  log(`❌ Fatal error: ${error.message || error}`);
  console.error(error);
  process.exit(1);
}
