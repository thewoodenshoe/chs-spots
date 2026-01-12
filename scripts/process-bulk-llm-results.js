/**
 * Process Bulk LLM Results - After Manual Extraction
 * 
 * Processes the JSON results from manual Grok UI extraction.
 * Creates individual gold/<venue-id>.json files and marks bulk as complete.
 * 
 * Input: data/gold/bulk-results.json (from manual Grok UI extraction)
 * Output: data/gold/<venue-id>.json (one file per venue)
 * 
 * Expected bulk-results.json format:
 * {
 *   "venues": [
 *     {
 *       "venueId": "ChIJ...",
 *       "happyHour": { ... },
 *       ...
 *     }
 *   ]
 * }
 * 
 * Run with: node scripts/process-bulk-llm-results.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Logging setup
const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logPath = path.join(logDir, 'process-bulk-llm-results.log');

fs.writeFileSync(logPath, '', 'utf8');

function log(message) {
  const ts = new Date().toISOString();
  console.log(message);
  fs.appendFileSync(logPath, `[${ts}] ${message}\n`);
}

// Paths
const GOLD_DIR = path.join(__dirname, '../data/gold');
const SILVER_MATCHED_DIR = path.join(__dirname, '../data/silver_matched');
const BULK_RESULTS_PATH = path.join(GOLD_DIR, 'bulk-results.json');
const BULK_COMPLETE_PATH = path.join(GOLD_DIR, '.bulk-complete');

/**
 * Compute content hash for a venue's silver_matched file
 */
function computeSourceHash(venueId) {
  const silverPath = path.join(SILVER_MATCHED_DIR, `${venueId}.json`);
  if (!fs.existsSync(silverPath)) {
    return null;
  }
  
  try {
    const data = JSON.parse(fs.readFileSync(silverPath, 'utf8'));
    const content = JSON.stringify(data);
    const normalized = content.replace(/\s+/g, ' ').trim();
    return crypto.createHash('sha256').update(normalized).digest('hex').substring(0, 16);
  } catch (e) {
    return null;
  }
}

/**
 * Get source file modified time
 */
function getSourceModifiedAt(venueId) {
  const silverPath = path.join(SILVER_MATCHED_DIR, `${venueId}.json`);
  if (!fs.existsSync(silverPath)) {
    return null;
  }
  
  try {
    const stats = fs.statSync(silverPath);
    return stats.mtime.toISOString();
  } catch (e) {
    return null;
  }
}

/**
 * Process a single venue result
 */
function processVenueResult(venueResult) {
  const venueId = venueResult.venueId;
  if (!venueId) {
    log(`  ⚠️  Skipping venue: Missing venueId`);
    return null;
  }
  
  // Get source metadata
  const sourceHash = computeSourceHash(venueId);
  const sourceModifiedAt = getSourceModifiedAt(venueId);
  
  // Load silver_matched data for venue name
  let venueName = venueResult.venueName || 'Unknown';
  try {
    const silverPath = path.join(SILVER_MATCHED_DIR, `${venueId}.json`);
    if (fs.existsSync(silverPath)) {
      const silverData = JSON.parse(fs.readFileSync(silverPath, 'utf8'));
      venueName = silverData.venueName || venueName;
    }
  } catch (e) {
    // Use venueName from result
  }
  
  // Create gold file structure
  const goldData = {
    venueId,
    venueName,
    extractedAt: new Date().toISOString(),
    extractionMethod: 'llm-bulk',
    sourceHash: sourceHash || null,
    sourceModifiedAt: sourceModifiedAt || null,
    happyHour: venueResult.happyHour || {
      found: false,
      reason: 'Not extracted from bulk results'
    },
    needsLLM: false
  };
  
  // Save gold file
  const goldPath = path.join(GOLD_DIR, `${venueId}.json`);
  fs.writeFileSync(goldPath, JSON.stringify(goldData, null, 2), 'utf8');
  
  return {
    venueId,
    venueName,
    success: true
  };
}

/**
 * Main function
 */
function main() {
  log('🔄 Processing Bulk LLM Results\n');
  
  // Check if bulk results exist
  if (!fs.existsSync(BULK_RESULTS_PATH)) {
    log(`❌ Bulk results file not found: ${BULK_RESULTS_PATH}`);
    log(`   Run prepare-bulk-llm-extraction.js first`);
    log(`   Then manually extract in Grok UI`);
    log(`   Save results to: ${BULK_RESULTS_PATH}`);
    process.exit(1);
  }
  
  // Check if already processed
  if (fs.existsSync(BULK_COMPLETE_PATH)) {
    log('⚠️  Bulk extraction already marked as complete');
    log('   Delete .bulk-complete to re-process');
    process.exit(0);
  }
  
  // Load bulk results
  let bulkResults;
  try {
    const bulkContent = fs.readFileSync(BULK_RESULTS_PATH, 'utf8');
    bulkResults = JSON.parse(bulkContent);
  } catch (error) {
    log(`❌ Error reading bulk results: ${error.message}`);
    process.exit(1);
  }
  
  // Handle different result formats
  let venues;
  if (Array.isArray(bulkResults)) {
    venues = bulkResults;
  } else if (bulkResults.venues && Array.isArray(bulkResults.venues)) {
    venues = bulkResults.venues;
  } else {
    log('❌ Invalid bulk results format. Expected array or object with venues array');
    process.exit(1);
  }
  
  log(`📁 Processing ${venues.length} venue(s)\n`);
  
  // Process each venue
  const results = [];
  for (const venueResult of venues) {
    const result = processVenueResult(venueResult);
    if (result) {
      results.push(result);
      log(`  ✅ Processed: ${result.venueName} (${result.venueId})`);
    }
  }
  
  // Mark bulk as complete
  fs.writeFileSync(BULK_COMPLETE_PATH, new Date().toISOString(), 'utf8');
  
  // Summary
  const successful = results.filter(r => r.success).length;
  
  log(`\n📊 Summary:`);
  log(`   ✅ Processed: ${successful}/${venues.length}`);
  log(`   📄 Gold files created: ${successful}`);
  log(`   ✅ Bulk extraction marked as complete`);
  log(`\n✨ Done!`);
  log(`   Next: Use extract-happy-hours.js --incremental for future extractions`);
}

try {
  main();
} catch (error) {
  log(`❌ Fatal error: ${error.message || error}`);
  console.error(error);
  process.exit(1);
}
