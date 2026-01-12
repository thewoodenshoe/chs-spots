/**
 * Prepare Bulk LLM Extraction - One-Time Manual Exercise
 * 
 * Reads all venues from silver_matched/ and formats them for manual
 * copy-paste into Grok UI or ChatGPT UI.
 * 
 * This is a ONE-TIME manual exercise for the initial 164 venues.
 * After bulk extraction is complete, use extract-happy-hours.js --incremental
 * for automatic incremental extraction.
 * 
 * Output:
 * - data/gold/bulk-input.json: Formatted data for manual extraction
 * - data/gold/bulk-input.txt: Human-readable format (optional)
 * 
 * Run with: node scripts/prepare-bulk-llm-extraction.js
 */

const fs = require('fs');
const path = require('path');

// Logging setup
const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logPath = path.join(logDir, 'prepare-bulk-llm-extraction.log');

fs.writeFileSync(logPath, '', 'utf8');

function log(message) {
  const ts = new Date().toISOString();
  console.log(message);
  fs.appendFileSync(logPath, `[${ts}] ${message}\n`);
}

// Paths
const SILVER_MATCHED_DIR = path.join(__dirname, '../data/silver_matched');
const GOLD_DIR = path.join(__dirname, '../data/gold');

// Ensure gold directory exists
if (!fs.existsSync(GOLD_DIR)) {
  fs.mkdirSync(GOLD_DIR, { recursive: true });
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
  log('📋 Preparing Bulk LLM Extraction\n');
  
  // Check if bulk extraction already completed
  const bulkCompletePath = path.join(GOLD_DIR, '.bulk-complete');
  if (fs.existsSync(bulkCompletePath)) {
    log('⚠️  Bulk extraction already completed (.bulk-complete exists)');
    log('   Use extract-happy-hours.js --incremental for new/changed venues');
    log('   To re-run bulk, delete .bulk-complete and re-run this script');
    process.exit(0);
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
  
  // Process each file
  const venues = [];
  
  for (const file of files) {
    const filePath = path.join(SILVER_MATCHED_DIR, file);
    
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      
      // Combine all pages into single text
      const combinedText = combinePagesText(data.pages || []);
      
      if (combinedText.length === 0) {
        log(`  ⚠️  Skipping ${data.venueName}: No text content`);
        continue;
      }
      
      venues.push({
        venueId: data.venueId,
        venueName: data.venueName || 'Unknown',
        venueArea: data.venueArea || null,
        website: data.website || null,
        html: combinedText,
        pages: data.pages.length,
        sourceFile: file
      });
      
      log(`  ✅ Prepared: ${data.venueName} (${data.venueId})`);
    } catch (error) {
      log(`  ❌ Error processing ${file}: ${error.message}`);
    }
  }
  
  // Create bulk input JSON
  const bulkInput = {
    total: venues.length,
    extractedAt: new Date().toISOString(),
    instructions: "Extract happy hour information from each venue. Return JSON with venueId and extracted data.",
    venues: venues.map(v => ({
      venueId: v.venueId,
      venueName: v.venueName,
      venueArea: v.venueArea,
      website: v.website,
      text: v.html // Combined text from all pages
    }))
  };
  
  // Save bulk input JSON
  const bulkInputPath = path.join(GOLD_DIR, 'bulk-input.json');
  fs.writeFileSync(bulkInputPath, JSON.stringify(bulkInput, null, 2), 'utf8');
  
  log(`\n📄 Bulk input saved to: ${bulkInputPath}`);
  log(`   Total venues: ${venues.length}`);
  log(`\n📋 Next Steps:`);
  log(`   1. Open ${bulkInputPath}`);
  log(`   2. Copy content to Grok UI or ChatGPT UI`);
  log(`   3. Extract happy hour information`);
  log(`   4. Save results to: data/gold/bulk-results.json`);
  log(`   5. Run: node scripts/process-bulk-llm-results.js`);
  log(`\n✨ Done!`);
}

try {
  main();
} catch (error) {
  log(`❌ Fatal error: ${error.message || error}`);
  console.error(error);
  process.exit(1);
}
