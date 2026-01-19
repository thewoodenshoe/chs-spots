/**
 * Trim Silver HTML - Step 3 of Happy Hour Pipeline
 * 
 * Processes silver_merged/all/ files and removes irrelevant HTML tags,
 * extracting only visible text that users would see when browsing a website.
 * 
 * Removes: <script>, <style>, <head>, <header>, <footer>, <nav>, <noscript>, <iframe>
 * and hidden elements to reduce LLM input size and improve accuracy.
 * 
 * Input: data/silver_merged/all/<venue-id>.json
 * Output: data/silver_trimmed/all/<venue-id>.json
 * 
 * Structure:
 * {
 *   "venueId": "ChIJ...",
 *   "venueName": "...",
 *   "venueArea": "...",
 *   "website": "http://...",
 *   "scrapedAt": "2026-01-12T15:33:13.976Z",
 *   "pages": [
 *     {
 *       "url": "http://...",
 *       "text": "Visible text content only...",
 *       "hash": "abc123",
 *       "downloadedAt": "2026-01-12T15:33:13.976Z",
 *       "trimmedAt": "2026-01-12T16:00:00.000Z",
 *       "sizeReduction": "85%"
 *     }
 *   ]
 * }
 * 
 * Run with: node scripts/trim-silver-html.js [area-filter]
 * 
 * If area-filter is provided, only processes venues from that area.
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const crypto = require('crypto');

// Logging setup
const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logPath = path.join(logDir, 'trim-silver-html.log');

fs.writeFileSync(logPath, '', 'utf8');

function log(message) {
  const ts = new Date().toISOString();
  console.log(message);
  fs.appendFileSync(logPath, `[${ts}] ${message}\n`);
}

// Paths
const SILVER_MERGED_DIR = path.join(__dirname, '../data/silver_merged/all');
const SILVER_TRIMMED_DIR = path.join(__dirname, '../data/silver_trimmed');
const SILVER_TRIMMED_ALL_DIR = path.join(SILVER_TRIMMED_DIR, 'all');
const SILVER_TRIMMED_PREVIOUS_DIR = path.join(SILVER_TRIMMED_DIR, 'previous');
const SILVER_TRIMMED_INCREMENTAL_DIR = path.join(SILVER_TRIMMED_DIR, 'incremental');
const VENUES_PATH = path.join(__dirname, '../data/venues.json');

// Ensure directories exist
if (!fs.existsSync(SILVER_TRIMMED_DIR)) {
  fs.mkdirSync(SILVER_TRIMMED_DIR, { recursive: true });
}
if (!fs.existsSync(SILVER_TRIMMED_ALL_DIR)) {
  fs.mkdirSync(SILVER_TRIMMED_ALL_DIR, { recursive: true });
}
if (!fs.existsSync(SILVER_TRIMMED_PREVIOUS_DIR)) {
  fs.mkdirSync(SILVER_TRIMMED_PREVIOUS_DIR, { recursive: true });
}
if (!fs.existsSync(SILVER_TRIMMED_INCREMENTAL_DIR)) {
  fs.mkdirSync(SILVER_TRIMMED_INCREMENTAL_DIR, { recursive: true });
}

/**
 * Trim HTML and extract visible text
 */
function trimHtml(html) {
  if (!html || typeof html !== 'string') {
    return '';
  }

  try {
    const $ = cheerio.load(html);
    
    // Get page title if available (useful for context) - must do BEFORE removing head
    const title = $('title').text().trim();
    
    // Remove non-visible elements (and all their children)
    $('script, style, head, header, footer, nav, noscript, iframe').remove();
    
    // Remove hidden elements
    $('[style*="display: none"], [style*="display:none"], [hidden]').remove();
    
    // Remove comments
    $('*').contents().filter(function() {
      return this.nodeType === 8; // Comment node
    }).remove();
    
    // Extract visible text with structure preservation
    let text = '';
    
    // Add title if available
    if (title) {
      text += `[Page Title: ${title}]\n\n`;
    }
    
    // Process body content (or html if no body)
    const bodyContent = $('body').length > 0 ? $('body') : $('html');
    
    // Get all text nodes and block elements, preserving structure
    bodyContent.find('*').each((i, elem) => {
      const $elem = $(elem);
      const tagName = elem.tagName ? elem.tagName.toLowerCase() : '';
      
      // Skip if element is already processed via parent
      if ($elem.closest('script, style, header, footer, nav').length > 0) {
        return;
      }
      
      // Get direct text (not from children)
      const directText = $elem.clone().children().remove().end().text().trim();
      
      // Block elements add newlines
      const isBlockElement = ['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 
                              'section', 'article', 'main', 'blockquote', 'pre', 
                              'ul', 'ol', 'dl', 'dt', 'dd'].includes(tagName);
      
      if (directText && isBlockElement) {
        // Add newline before block elements (except first)
        if (text && !text.endsWith('\n\n')) {
          text += '\n';
        }
        text += directText + '\n';
      } else if (directText && tagName === 'br') {
        text += '\n';
      } else if (directText && !isBlockElement) {
        // Inline elements add space
        text += directText + ' ';
      }
    });
    
    // Also get direct text from body/html that's not in elements
    const bodyDirectText = bodyContent.clone().children().remove().end().text().trim();
    if (bodyDirectText && !text.includes(bodyDirectText)) {
      text = bodyDirectText + '\n\n' + text;
    }
    
    // Normalize whitespace - preserve line breaks but clean up excessive spaces
    // Don't replace \n with spaces - preserve paragraph structure
    text = text
      .replace(/[ \t]+/g, ' ')        // Multiple spaces/tabs → single space (but keep \n)
      .replace(/\n\s*\n\s*\n+/g, '\n\n')  // Multiple newlines → max 2
      .trim();
    
    return text;
  } catch (error) {
    log(`Error parsing HTML: ${error.message}`);
    // Fallback: try to extract plain text without parsing
    return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }
}

/**
 * Check if trimmed file needs update (incremental check)
 */
function needsUpdate(silverFilePath, trimmedFilePath) {
  // If trimmed file doesn't exist, needs update
  if (!fs.existsSync(trimmedFilePath)) {
    return true;
  }
  
  // Compare modification times
  try {
    const silverStats = fs.statSync(silverFilePath);
    const trimmedStats = fs.statSync(trimmedFilePath);
    
    // If silver file is newer, needs update
    return silverStats.mtime > trimmedStats.mtime;
  } catch (error) {
    // If can't read stats, assume needs update
    return true;
  }
}

/**
 * Process a single venue file
 */
function processVenueFile(venueId, areaFilter = null) {
  const silverFilePath = path.join(SILVER_MERGED_DIR, `${venueId}.json`);
  const trimmedFilePath = path.join(SILVER_TRIMMED_ALL_DIR, `${venueId}.json`);
  
  if (!fs.existsSync(silverFilePath)) {
    log(`  ⚠️  Silver file not found: ${venueId}`);
    return { success: false, reason: 'File not found' };
  }
  
  let silverData;
  try {
    silverData = JSON.parse(fs.readFileSync(silverFilePath, 'utf8'));
  } catch (error) {
    log(`  ❌ Error reading silver file ${venueId}: ${error.message}`);
    return { success: false, reason: 'Read error' };
  }
  
  // Filter by area if specified
  if (areaFilter && silverData.venueArea !== areaFilter) {
    return { success: false, reason: 'Area filter' };
  }
  
  // INCREMENTAL: Skip if no changes detected
  if (!needsUpdate(silverFilePath, trimmedFilePath)) {
    log(`  ⏭️  Skipping ${silverData.venueName} (${venueId}): No changes detected`);
    return { success: false, reason: 'No changes', skipped: true };
  }
  
  // Process each page
  const trimmedPages = [];
  let totalOriginalSize = 0;
  let totalTrimmedSize = 0;
  
  for (const page of silverData.pages || []) {
    const originalHtml = page.html || '';
    const originalSize = originalHtml.length;
    totalOriginalSize += originalSize;
    
    // Trim HTML to visible text
    const trimmedText = trimHtml(originalHtml);
    const trimmedSize = trimmedText.length;
    totalTrimmedSize += trimmedSize;
    
    // Calculate size reduction
    const reduction = originalSize > 0 
      ? ((originalSize - trimmedSize) / originalSize * 100).toFixed(1) + '%'
      : '0%';
    
    trimmedPages.push({
      url: page.url,
      text: trimmedText,
      hash: page.hash,
      downloadedAt: page.downloadedAt,
      trimmedAt: new Date().toISOString(),
      sizeReduction: reduction
    });
  }
  
  // Create trimmed data structure
  const trimmedData = {
    venueId: silverData.venueId,
    venueName: silverData.venueName,
    venueArea: silverData.venueArea || null,
    website: silverData.website || null,
    scrapedAt: silverData.scrapedAt,
    trimmedAt: new Date().toISOString(),
    pages: trimmedPages
  };
  
  // Calculate overall size reduction
  const overallReduction = totalOriginalSize > 0
    ? ((totalOriginalSize - totalTrimmedSize) / totalOriginalSize * 100).toFixed(1) + '%'
    : '0%';
  trimmedData.sizeReduction = overallReduction;
  
  // Save trimmed file (trimmedFilePath already declared at top of function)
  try {
    fs.writeFileSync(trimmedFilePath, JSON.stringify(trimmedData, null, 2), 'utf8');
    log(`  ✅ Trimmed ${silverData.venueName} (${venueId}): ${overallReduction} reduction`);
    return { 
      success: true, 
      venueName: silverData.venueName,
      originalSize: totalOriginalSize,
      trimmedSize: totalTrimmedSize,
      reduction: overallReduction
    };
  } catch (error) {
    log(`  ❌ Error writing trimmed file ${venueId}: ${error.message}`);
    return { success: false, reason: 'Write error' };
  }
}

/**
 * Main execution
 */
function main() {
  const areaFilter = process.argv[2] || null;
  
  log(`\n📄 Starting HTML trimming${areaFilter ? ` (filter: ${areaFilter})` : ''}...`);
  
  // Check if silver_merged directory exists
  if (!fs.existsSync(SILVER_MERGED_DIR)) {
    log(`❌ Error: ${SILVER_MERGED_DIR} does not exist.`);
    log(`   Please run 'node scripts/merge-raw-files.js' first.`);
    process.exit(1);
  }
  
  // Get all venue files
  let venueFiles = [];
  try {
    venueFiles = fs.readdirSync(SILVER_MERGED_DIR).filter(file => file.endsWith('.json'));
  } catch (error) {
    log(`❌ Error reading silver_merged directory: ${error.message}`);
    process.exit(1);
  }
  
  if (venueFiles.length === 0) {
    log('No venue files found in silver_merged/all/ directory.');
    return;
  }
  
  log(`Found ${venueFiles.length} venue file(s) to process.`);
  
  // Process each venue
  let processed = 0;
  let skipped = 0;
  let skippedNoChanges = 0;
  let errors = 0;
  let totalOriginalSize = 0;
  let totalTrimmedSize = 0;
  
  for (const file of venueFiles) {
    const venueId = path.basename(file, '.json');
    
    const result = processVenueFile(venueId, areaFilter);
    
    if (result.success) {
      processed++;
      totalOriginalSize += result.originalSize || 0;
      totalTrimmedSize += result.trimmedSize || 0;
    } else if (result.reason === 'Area filter') {
      skipped++;
    } else if (result.reason === 'No changes' || result.skipped) {
      skippedNoChanges++;
    } else {
      errors++;
    }
  }
  
  // Summary
  const overallReduction = totalOriginalSize > 0
    ? ((totalOriginalSize - totalTrimmedSize) / totalOriginalSize * 100).toFixed(1) + '%'
    : '0%';
  
  log(`\n📊 Summary:`);
  log(`   ✅ Processed: ${processed}`);
  log(`   ⏭️  Skipped (area filter): ${skipped}`);
  log(`   ⏭️  Skipped (no changes): ${skippedNoChanges}`);
  log(`   ❌ Errors: ${errors}`);
  log(`   📉 Overall size reduction: ${overallReduction}`);
  log(`   📦 Original size: ${(totalOriginalSize / 1024 / 1024).toFixed(2)} MB`);
  log(`   📦 Trimmed size: ${(totalTrimmedSize / 1024 / 1024).toFixed(2)} MB`);
  log(`\n✨ Done! Trimmed files saved to ${SILVER_TRIMMED_ALL_DIR}`);
}

// Run if called directly
if (require.main === module) {
  main();
  // Explicitly exit to ensure process terminates (important when called from pipeline)
  process.exit(0);
}

// Export for testing
module.exports = { trimHtml, processVenueFile };
