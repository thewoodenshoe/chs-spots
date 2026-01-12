/**
 * Extract Happy Hours - Incremental LLM Extraction
 * 
 * Extracts structured happy hour data from silver_matched files using LLM.
 * Only processes new/changed venues (incremental mode).
 * 
 * Requires:
 * - Bulk extraction must be completed first (.bulk-complete exists)
 * - Only processes venues where gold/<venue-id>.json doesn't exist OR
 *   silver_matched/<venue-id>.json is newer than gold/<venue-id>.json
 * 
 * Modes:
 * --incremental (default): Only new/changed venues
 * --force: Re-extract all venues (use with caution)
 * 
 * Run with: node scripts/extract-happy-hours.js [--incremental|--force]
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Logging setup
const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logPath = path.join(logDir, 'extract-happy-hours.log');

fs.writeFileSync(logPath, '', 'utf8');

function log(message) {
  const ts = new Date().toISOString();
  console.log(message);
  fs.appendFileSync(logPath, `[${ts}] ${message}\n`);
}

// Paths
const SILVER_MATCHED_DIR = path.join(__dirname, '../data/silver_matched');
const GOLD_DIR = path.join(__dirname, '../data/gold');
const BULK_COMPLETE_PATH = path.join(GOLD_DIR, '.bulk-complete');

// Ensure gold directory exists
if (!fs.existsSync(GOLD_DIR)) {
  fs.mkdirSync(GOLD_DIR, { recursive: true });
}

/**
 * Check if bulk extraction is complete
 */
function isBulkComplete() {
  return fs.existsSync(BULK_COMPLETE_PATH);
}

/**
 * Determine if venue needs extraction
 */
function shouldExtract(silverMatchedPath, goldPath, force = false) {
  if (force) {
    return 'force';
  }
  
  // Never extracted
  if (!fs.existsSync(goldPath)) {
    return 'new';
  }
  
  // Compare timestamps
  const silverStats = fs.statSync(silverMatchedPath);
  const goldStats = fs.statSync(goldPath);
  
  // Silver file newer = content changed
  if (silverStats.mtime > goldStats.mtime) {
    return 'changed';
  }
  
  // Already extracted and unchanged
  return 'skip';
}

/**
 * Compute content hash for source tracking
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
 * Extract text from HTML
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
 * Combine all pages into single text
 */
function combinePagesText(pages) {
  const texts = pages
    .map(page => extractTextFromHtml(page.html || ''))
    .filter(text => text.length > 0);
  
  return texts.join('\n\n--- Page Break ---\n\n');
}

/**
 * Extract happy hour using LLM API
 * 
 * This is a placeholder that will call the actual LLM API.
 * For now, it returns a structure indicating LLM extraction is needed.
 * 
 * TODO: Implement actual LLM API call (Grok API, OpenAI, etc.)
 */
async function extractWithLLM(venueId, venueData) {
  // Extract text from all pages
  const combinedText = combinePagesText(venueData.pages || []);
  
  // TODO: Call LLM API here
  // For now, return placeholder structure
  log(`  🤖 [PLACEHOLDER] Would call LLM API for ${venueData.venueName}`);
  
  // Placeholder response structure
  // In real implementation, this would be the LLM API response
  return {
    found: false,
    reason: 'LLM API not yet implemented - placeholder response',
    times: null,
    days: null,
    specials: [],
    source: venueData.website || null,
    confidence: 0.0,
    needsLLM: true
  };
  
  /* Example LLM API call (when implemented):
  const response = await fetch('https://api.grok.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROK_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'grok-beta',
      messages: [{
        role: 'system',
        content: 'Extract happy hour information from restaurant/bar website content...'
      }, {
        role: 'user',
        content: `Venue: ${venueData.venueName}\nWebsite: ${venueData.website}\n\nContent:\n${combinedText}`
      }]
    })
  });
  
  const result = await response.json();
  return parseLLMResponse(result);
  */
}

/**
 * Process a single venue
 */
async function processVenue(venueId, force = false) {
  const silverPath = path.join(SILVER_MATCHED_DIR, `${venueId}.json`);
  const goldPath = path.join(GOLD_DIR, `${venueId}.json`);
  
  if (!fs.existsSync(silverPath)) {
    log(`  ⚠️  Silver matched file not found: ${venueId}`);
    return null;
  }
  
  // Check if needs extraction
  const status = shouldExtract(silverPath, goldPath, force);
  
  if (status === 'skip') {
    return {
      venueId,
      status: 'skip',
      reason: 'Already extracted and unchanged'
    };
  }
  
  // Load silver_matched data
  const silverData = JSON.parse(fs.readFileSync(silverPath, 'utf8'));
  
  log(`  🔄 Processing ${silverData.venueName} (${venueId}): ${status}`);
  
  try {
    // Extract with LLM
    const extractedData = await extractWithLLM(venueId, silverData);
    
    // Get source metadata
    const sourceHash = computeSourceHash(venueId);
    const sourceModifiedAt = getSourceModifiedAt(venueId);
    
    // Create gold file
    const goldData = {
      venueId,
      venueName: silverData.venueName,
      venueArea: silverData.venueArea || null,
      website: silverData.website || null,
      extractedAt: new Date().toISOString(),
      extractionMethod: 'llm-incremental',
      sourceHash: sourceHash || null,
      sourceModifiedAt: sourceModifiedAt || null,
      happyHour: extractedData,
      needsLLM: extractedData.needsLLM !== false
    };
    
    // Save gold file
    fs.writeFileSync(goldPath, JSON.stringify(goldData, null, 2), 'utf8');
    
    log(`  ✅ Extracted: ${silverData.venueName} (${venueId})`);
    
    return {
      venueId,
      venueName: silverData.venueName,
      status: status === 'force' ? 'force' : status,
      happyHourFound: extractedData.found || false,
      success: true
    };
  } catch (error) {
    log(`  ❌ Error extracting ${silverData.venueName}: ${error.message}`);
    return {
      venueId,
      venueName: silverData.venueName,
      status,
      error: error.message,
      success: false
    };
  }
}

/**
 * Main function
 */
async function main() {
  log('🤖 Starting Incremental LLM Extraction\n');
  
  // Parse arguments
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const mode = force ? 'force' : 'incremental';
  
  log(`📋 Mode: ${mode}\n`);
  
  // Check bulk completion (unless force mode)
  if (!force && !isBulkComplete()) {
    log('❌ Bulk extraction not completed (.bulk-complete does not exist)');
    log('   Run prepare-bulk-llm-extraction.js and process-bulk-llm-results.js first');
    log('   Or use --force to re-extract all venues');
    process.exit(1);
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
    log('❌ No venues to extract. Run filter-happy-hour.js first.');
    process.exit(1);
  }
  
  // Process each venue
  const results = [];
  const stats = {
    new: 0,
    changed: 0,
    skipped: 0,
    force: 0,
    errors: 0,
    success: 0
  };
  
  for (const file of files) {
    const venueId = file.replace('.json', '');
    const result = await processVenue(venueId, force);
    
    if (result) {
      results.push(result);
      
      if (result.error) {
        stats.errors++;
      } else if (result.status === 'skip') {
        stats.skipped++;
      } else {
        stats.success++;
        if (result.status === 'new') stats.new++;
        else if (result.status === 'changed') stats.changed++;
        else if (result.status === 'force') stats.force++;
      }
    }
    
    // Rate limiting (if using LLM API)
    if (result && result.status !== 'skip') {
      await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
    }
  }
  
  // Summary
  log(`\n📊 Summary:`);
  log(`   🆕 New: ${stats.new}`);
  log(`   🔄 Changed: ${stats.changed}`);
  log(`   ⏭️  Skipped: ${stats.skipped}`);
  if (force) {
    log(`   🔁 Force re-extracted: ${stats.force}`);
  }
  log(`   ✅ Successful: ${stats.success}`);
  log(`   ❌ Errors: ${stats.errors}`);
  log(`\n✨ Done! Extracted data saved to: ${path.resolve(GOLD_DIR)}`);
  
  if (stats.new > 0 || stats.changed > 0) {
    log(`   Next: Run create-spots.js to generate spots.json`);
  }
}

try {
  main();
} catch (error) {
  log(`❌ Fatal error: ${error.message || error}`);
  console.error(error);
  process.exit(1);
}
