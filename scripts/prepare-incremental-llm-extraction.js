/**
 * Prepare Incremental LLM Extraction - For Manual Upload
 * 
 * Identifies new/changed venues from silver_matched that need LLM extraction.
 * Prepares them for manual upload to Grok UI or ChatGPT UI.
 * 
 * This script:
 * 1. Finds venues in silver_matched that are new or changed (not in gold, or source changed)
 * 2. Formats them for manual LLM extraction
 * 3. Outputs to data/gold/incremental-input-YYYY-MM-DD.json
 * 
 * After manual extraction, save results to data/gold/incremental-results-YYYY-MM-DD.json
 * Then run: node scripts/process-incremental-llm-results.js
 * 
 * Run with: node scripts/prepare-incremental-llm-extraction.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Logging setup
const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logPath = path.join(logDir, 'prepare-incremental-llm-extraction.log');

fs.writeFileSync(logPath, '', 'utf8');

function log(message) {
  const ts = new Date().toISOString();
  console.log(message);
  fs.appendFileSync(logPath, `[${ts}] ${message}\n`);
}

// Paths
const SILVER_MATCHED_DIR = path.join(__dirname, '../data/silver_matched');
const GOLD_DIR = path.join(__dirname, '../data/gold');
const CHANGES_DIR = path.join(__dirname, '../data/raw');

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
 * Check if venue needs extraction
 */
function needsExtraction(venueId) {
  const silverPath = path.join(SILVER_MATCHED_DIR, `${venueId}.json`);
  const goldPath = path.join(GOLD_DIR, `${venueId}.json`);
  
  // Never extracted
  if (!fs.existsSync(goldPath)) {
    return { needs: true, reason: 'new' };
  }
  
  // Check if gold file has valid extraction from bulk
  try {
    const goldData = JSON.parse(fs.readFileSync(goldPath, 'utf8'));
    // If bulk extracted and has happy hour, only re-extract if source changed
    if (goldData.extractionMethod === 'llm-bulk' && goldData.happyHour && goldData.happyHour.found === true) {
      // Check if source changed
      const silverStats = fs.statSync(silverPath);
      const goldStats = fs.statSync(goldPath);
      if (silverStats.mtime <= goldStats.mtime) {
        return { needs: false, reason: 'already-extracted' }; // Source hasn't changed
      }
      return { needs: true, reason: 'changed' }; // Source changed, re-extract
    }
  } catch (e) {
    // If we can't read gold file, proceed with extraction
  }
  
  // Compare timestamps
  if (!fs.existsSync(silverPath)) {
    return { needs: false, reason: 'no-silver-file' };
  }
  
  const silverStats = fs.statSync(silverPath);
  const goldStats = fs.statSync(goldPath);
  
  // Silver file newer = content changed
  if (silverStats.mtime > goldStats.mtime) {
    return { needs: true, reason: 'changed' };
  }
  
  // Already extracted and unchanged
  return { needs: false, reason: 'unchanged' };
}

/**
 * Extract text from HTML (simple text extraction)
 */
function extractTextFromHtml(html) {
  if (!html || typeof html !== 'string') {
    return '';
  }
  
  // Remove script and style tags
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ') // Remove HTML tags
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
  
  return text;
}

/**
 * Combine all page HTML into single text
 */
function combinePagesText(pages) {
  const texts = pages
    .map(page => extractTextFromHtml(page.html || ''))
    .filter(text => text.length > 0);
  
  return texts.join('\n\n--- Page Break ---\n\n');
}

/**
 * Main function
 */
function main() {
  log('📋 Preparing Incremental LLM Extraction\n');
  
  // Check bulk completion
  const bulkCompletePath = path.join(GOLD_DIR, '.bulk-complete');
  if (!fs.existsSync(bulkCompletePath)) {
    log('⚠️  Bulk extraction not completed (.bulk-complete does not exist)');
    log('   Run prepare-bulk-llm-extraction.js and process-bulk-llm-results.js first');
    log('   Or use this script to prepare all venues for bulk extraction');
  }
  
  // Check silver_matched directory
  if (!fs.existsSync(SILVER_MATCHED_DIR)) {
    log(`❌ Silver matched directory not found: ${SILVER_MATCHED_DIR}`);
    log(`   Run filter-happy-hour.js first`);
    process.exit(1);
  }
  
  // Get all matched files
  const files = fs.readdirSync(SILVER_MATCHED_DIR).filter(f => f.endsWith('.json'));
  log(`📁 Found ${files.length} venue(s) in silver_matched/\n`);
  
  if (files.length === 0) {
    log('❌ No venues found in silver_matched/');
    process.exit(1);
  }
  
  // Find venues that need extraction
  const venuesToExtract = [];
  
  for (const file of files) {
    const venueId = file.replace('.json', '');
    const check = needsExtraction(venueId);
    
    if (check.needs) {
      try {
        const silverPath = path.join(SILVER_MATCHED_DIR, file);
        const silverData = JSON.parse(fs.readFileSync(silverPath, 'utf8'));
        
        venuesToExtract.push({
          venueId,
          venueName: silverData.venueName || 'Unknown',
          venueArea: silverData.venueArea || null,
          website: silverData.website || null,
          reason: check.reason,
          pages: silverData.pages || []
        });
      } catch (e) {
        log(`  ⚠️  Error reading ${file}: ${e.message}`);
      }
    }
  }
  
  log(`📊 Found ${venuesToExtract.length} venue(s) needing extraction\n`);
  
  if (venuesToExtract.length === 0) {
    log('✅ No venues need extraction. All venues are up to date!');
    process.exit(0);
  }
  
  // Group by reason
  const byReason = {
    new: venuesToExtract.filter(v => v.reason === 'new'),
    changed: venuesToExtract.filter(v => v.reason === 'changed')
  };
  
  log(`   🆕 New: ${byReason.new.length}`);
  log(`   🔄 Changed: ${byReason.changed.length}\n`);
  
  // Format for LLM extraction
  const formattedVenues = venuesToExtract.map(venue => {
    const combinedText = combinePagesText(venue.pages);
    
    return {
      venueId: venue.venueId,
      venueName: venue.venueName,
      venueArea: venue.venueArea,
      website: venue.website,
      reason: venue.reason,
      content: combinedText.substring(0, 50000) // Limit to 50KB per venue
    };
  });
  
  // Archive old incremental files to history
  const historyDir = path.join(GOLD_DIR, 'incremental-history');
  if (!fs.existsSync(historyDir)) {
    fs.mkdirSync(historyDir, { recursive: true });
  }
  
  // Move old incremental input files to history
  const oldInputFiles = fs.readdirSync(GOLD_DIR)
    .filter(f => f.startsWith('incremental-input-') && f.endsWith('.json'));
  
  for (const oldFile of oldInputFiles) {
    const oldPath = path.join(GOLD_DIR, oldFile);
    const historyPath = path.join(historyDir, oldFile);
    fs.renameSync(oldPath, historyPath);
    log(`  📦 Archived: ${oldFile} → incremental-history/`);
  }
  
  // Move old incremental result files to history
  const oldResultFiles = fs.readdirSync(GOLD_DIR)
    .filter(f => f.startsWith('incremental-results-') && f.endsWith('.json'));
  
  for (const oldFile of oldResultFiles) {
    const oldPath = path.join(GOLD_DIR, oldFile);
    const historyPath = path.join(historyDir, oldFile);
    fs.renameSync(oldPath, historyPath);
    log(`  📦 Archived: ${oldFile} → incremental-history/`);
  }
  
  if (oldInputFiles.length > 0 || oldResultFiles.length > 0) {
    log(`  ✅ Archived ${oldInputFiles.length + oldResultFiles.length} old file(s) to incremental-history/\n`);
  }
  
  // Save incremental input
  const today = new Date().toISOString().split('T')[0];
  const incrementalInputPath = path.join(GOLD_DIR, `incremental-input-${today}.json`);
  
  const inputData = {
    date: today,
    totalVenues: formattedVenues.length,
    summary: {
      new: byReason.new.length,
      changed: byReason.changed.length
    },
    venues: formattedVenues
  };
  
  fs.writeFileSync(incrementalInputPath, JSON.stringify(inputData, null, 2), 'utf8');
  
  log(`✅ Prepared ${formattedVenues.length} venue(s) for incremental extraction`);
  log(`📄 Input file: ${incrementalInputPath}\n`);
  log(`📋 Next steps:`);
  log(`   1. Upload incremental-input-${today}.json to Grok UI or ChatGPT UI`);
  log(`   2. Use the same prompt format as bulk extraction (see GROK-PROMPT.md)`);
  log(`   3. Save results to: data/gold/incremental-results-${today}.json`);
  log(`   4. Run: node scripts/process-incremental-llm-results.js`);
}

try {
  main();
} catch (error) {
  log(`❌ Fatal error: ${error.message || error}`);
  console.error(error);
  process.exit(1);
}
