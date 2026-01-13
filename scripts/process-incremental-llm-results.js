/**
 * Process Incremental LLM Results - After Manual Extraction
 * 
 * Processes the JSON results from manual Grok UI extraction for incremental venues.
 * Creates individual gold/<venue-id>.json files for new/changed venues.
 * 
 * Input: data/gold/incremental-results-YYYY-MM-DD.json (from manual Grok UI extraction)
 * Output: data/gold/<venue-id>.json (one file per venue)
 * 
 * Expected incremental-results-YYYY-MM-DD.json format:
 * [
 *   {
 *     "venueId": "ChIJ...",
 *     "venueName": "Venue Name",
 *     "happyHour": { ... },
 *     ...
 *   }
 * ]
 * 
 * Run with: node scripts/process-incremental-llm-results.js [date]
 * If date not provided, uses today's date
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Logging setup
const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logPath = path.join(logDir, 'process-incremental-llm-results.log');

fs.writeFileSync(logPath, '', 'utf8');

function log(message) {
  const ts = new Date().toISOString();
  console.log(message);
  fs.appendFileSync(logPath, `[${ts}] ${message}\n`);
}

// Paths
const GOLD_DIR = path.join(__dirname, '../data/gold');
const SILVER_MATCHED_DIR = path.join(__dirname, '../data/silver_matched');

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
    extractionMethod: 'llm-incremental',
    sourceHash: sourceHash || null,
    sourceModifiedAt: sourceModifiedAt || null,
    happyHour: venueResult.happyHour || {
      found: false,
      reason: 'Not extracted from incremental results'
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
  log('🔄 Processing Incremental LLM Results\n');
  
  // Get date from argument or use today
  const args = process.argv.slice(2);
  const date = args[0] || new Date().toISOString().split('T')[0];
  
  const INCREMENTAL_RESULTS_PATH = path.join(GOLD_DIR, `incremental-results-${date}.json`);
  
  // Check if incremental results exist
  if (!fs.existsSync(INCREMENTAL_RESULTS_PATH)) {
    log(`❌ Incremental results file not found: ${INCREMENTAL_RESULTS_PATH}`);
    log(`   Run prepare-incremental-llm-extraction.js first`);
    log(`   Then manually extract in Grok UI`);
    log(`   Save results to: ${INCREMENTAL_RESULTS_PATH}`);
    log(`   Or specify date: node scripts/process-incremental-llm-results.js YYYY-MM-DD`);
    process.exit(1);
  }
  
  // Load incremental results
  let incrementalResults;
  try {
    const resultsContent = fs.readFileSync(INCREMENTAL_RESULTS_PATH, 'utf8');
    incrementalResults = JSON.parse(resultsContent);
  } catch (error) {
    log(`❌ Error reading incremental results: ${error.message}`);
    process.exit(1);
  }
  
  // Handle different result formats
  let venues;
  if (Array.isArray(incrementalResults)) {
    venues = incrementalResults;
  } else if (incrementalResults.venues && Array.isArray(incrementalResults.venues)) {
    venues = incrementalResults.venues;
  } else {
    log('❌ Invalid incremental results format. Expected array or object with venues array');
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
  
  // Summary
  const successful = results.filter(r => r.success).length;
  
  log(`\n📊 Summary:`);
  log(`   ✅ Processed: ${successful}/${venues.length}`);
  log(`   📄 Gold files created/updated: ${successful}`);
  log(`\n✨ Done!`);
  log(`   Next: Run create-spots.js to update spots.json`);
}

try {
  main();
} catch (error) {
  log(`❌ Fatal error: ${error.message || error}`);
  console.error(error);
  process.exit(1);
}
