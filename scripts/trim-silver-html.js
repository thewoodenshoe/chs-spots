/**
 * Trim Silver HTML - Step 3 of Happy Hour Pipeline
 * 
 * Processes silver_merged/today/ files and removes irrelevant HTML tags,
 * extracting only visible text that users would see when browsing a website.
 * 
 * Removes: <script>, <style>, <head>, <header>, <footer>, <nav>, <noscript>, <iframe>
 * and hidden elements to reduce LLM input size and improve accuracy.
 * 
 * Input: data/silver_merged/today/<venue-id>.json
 * Output: data/silver_trimmed/today/<venue-id>.json
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
const SILVER_MERGED_TODAY_DIR = path.join(__dirname, '../data/silver_merged/today');
const SILVER_MERGED_INCREMENTAL_DIR = path.join(__dirname, '../data/silver_merged/incremental');
const SILVER_TRIMMED_DIR = path.join(__dirname, '../data/silver_trimmed');
const SILVER_TRIMMED_TODAY_DIR = path.join(SILVER_TRIMMED_DIR, 'today');
const SILVER_TRIMMED_PREVIOUS_DIR = path.join(SILVER_TRIMMED_DIR, 'previous');
const SILVER_TRIMMED_INCREMENTAL_DIR = path.join(SILVER_TRIMMED_DIR, 'incremental');
const VENUES_PATH = path.join(__dirname, '../data/venues.json');

// Ensure directories exist
if (!fs.existsSync(SILVER_TRIMMED_DIR)) {
  fs.mkdirSync(SILVER_TRIMMED_DIR, { recursive: true });
}
if (!fs.existsSync(SILVER_TRIMMED_TODAY_DIR)) {
  fs.mkdirSync(SILVER_TRIMMED_TODAY_DIR, { recursive: true });
}
if (!fs.existsSync(SILVER_TRIMMED_PREVIOUS_DIR)) {
  fs.mkdirSync(SILVER_TRIMMED_PREVIOUS_DIR, { recursive: true });
}
if (!fs.existsSync(SILVER_TRIMMED_INCREMENTAL_DIR)) {
  fs.mkdirSync(SILVER_TRIMMED_INCREMENTAL_DIR, { recursive: true });
}

/**
 * Normalize URL by removing query parameters and tracking tokens
 */
function normalizeUrl(url) {
  if (!url || typeof url !== 'string') {
    return url || '';
  }
  try {
    const urlObj = new URL(url);
    // Remove common tracking parameters (fbclid, gclid, utm_*, sid, etc.)
    const trackingParams = ['fbclid', 'gclid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'sid', '_ga', '_gid', 'ref', 'source'];
    trackingParams.forEach(param => {
      urlObj.searchParams.delete(param);
    });
    // Keep only base path (remove query string and hash)
    return urlObj.origin + urlObj.pathname;
  } catch (e) {
    // Fallback for malformed URLs: remove query string and hash
    return url.split('?')[0].split('#')[0];
  }
}

/**
 * Normalize text by removing dynamic noise that causes false-positive deltas
 */
function normalizeText(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }
  
  let normalized = text;
  const originalLength = normalized.length;
  
  // Remove ISO timestamps (e.g., "2026-01-20T15:34:58.724Z" or "2026-01-20")
  normalized = normalized.replace(/\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?)?/g, '');
  
  // Remove common month-day patterns (e.g., "Jan 20", "Jan 20, 2026", "January 20, 2026")
  normalized = normalized.replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(,\s+\d{4})?\b/gi, '');
  
  // Remove "Loading..." or placeholder phrases
  normalized = normalized.replace(/Loading\s+product\s+options\.\.\.|Loading\.\.\./gi, '');
  
  // Remove Google Analytics / GTM IDs (e.g., "gtm-abc123", "UA-123456-7")
  normalized = normalized.replace(/gtm-[a-z0-9]+/gi, '');
  normalized = normalized.replace(/UA-\d+-\d+/g, '');
  
  // Remove common dynamic footers (e.g., "Copyright © 2026", "All rights reserved")
  normalized = normalized.replace(/Copyright\s+©\s+\d{4}/gi, '');
  normalized = normalized.replace(/All\s+rights\s+reserved/gi, '');
  
  // Collapse all whitespace (spaces, tabs, newlines) to single spaces and trim
  // More aggressive: replace any sequence of whitespace with single space
  normalized = normalized.replace(/\s+/g, ' ').trim();
  
  return normalized;
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
  // INCREMENTAL MODE: Read from silver_merged/incremental/
  const silverFilePath = path.join(SILVER_MERGED_INCREMENTAL_DIR, `${venueId}.json`);
  const trimmedFilePath = path.join(SILVER_TRIMMED_TODAY_DIR, `${venueId}.json`);
  
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
    
    // Normalize text and URL for hash computation
    const cleanUrl = normalizeUrl(page.url);
    const cleanText = normalizeText(trimmedText);
    const normalizedLength = cleanText.length;
    
    // Compute hash based on normalized URL + text (not raw HTML)
    // This ensures identical content with different timestamps/params has same hash
    const contentHash = crypto.createHash('md5')
      .update(cleanUrl + cleanText)
      .digest('hex');
    
    // Log normalization if significant change
    if (trimmedText.length !== normalizedLength) {
      log(`  📝 Normalized text length: ${trimmedText.length} → ${normalizedLength} chars (${venueId} - ${cleanUrl})`);
    }
    if (page.url !== cleanUrl) {
      log(`  🔗 URL cleaned: ${page.url} → ${cleanUrl} (${venueId})`);
    }
    
    // Check if hash changed from original (if original hash exists)
    if (page.hash && page.hash !== contentHash) {
      log(`  ⚠️  Hash changed due to normalization on ${venueId} - ${cleanUrl}`);
    }
    
    // Calculate size reduction
    const reduction = originalSize > 0 
      ? ((originalSize - trimmedSize) / originalSize * 100).toFixed(1) + '%'
      : '0%';
    
    trimmedPages.push({
      url: page.url, // Keep original URL for reference
      text: trimmedText, // Keep original trimmed text for LLM processing
      hash: contentHash, // Use normalized hash for change detection
      downloadedAt: page.downloadedAt,
      trimmedAt: new Date().toISOString(),
      sizeReduction: reduction
    });
  }
  
  // Compute the final venue hash only on the concatenated normalized page texts
  // (ignore metadata fields like scrapedAt, trimmedAt, downloadedAt)
  const venueContentForHash = trimmedPages.map(p => {
    // Use normalized text for hash (same as page.hash computation)
    const cleanText = normalizeText(p.text);
    return cleanText;
  }).join('\n');
  const venueHash = crypto.createHash('md5').update(venueContentForHash).digest('hex');
  
  // Create trimmed data structure
  const trimmedData = {
    venueId: silverData.venueId,
    venueName: silverData.venueName,
    venueArea: silverData.venueArea || null,
    website: silverData.website || null,
    scrapedAt: silverData.scrapedAt,
    trimmedAt: new Date().toISOString(),
    pages: trimmedPages,
    venueHash: venueHash // Store venue-level hash for delta comparison
  };
  
  // Calculate overall size reduction
  const overallReduction = totalOriginalSize > 0
    ? ((totalOriginalSize - totalTrimmedSize) / totalOriginalSize * 100).toFixed(1) + '%'
    : '0%';
  trimmedData.sizeReduction = overallReduction;
  
  // Save trimmed file to silver_trimmed/today/ (main storage)
  try {
    fs.writeFileSync(trimmedFilePath, JSON.stringify(trimmedData, null, 2), 'utf8');
    
    // NOTE: Don't save to incremental/ here - delta-trimmed-files.js will populate it
    // based on actual content changes, not just processing changes
    
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
 * Copy directory recursively
 */
function copyDirectoryRecursive(source, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  
  const entries = fs.readdirSync(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      copyDirectoryRecursive(sourcePath, destPath);
    } else {
      fs.copyFileSync(sourcePath, destPath);
    }
  }
}

/**
 * Reset state for new day or same-day rerun
 * New day: Empty previous/, move incremental/ to previous/, move today/ to previous/, empty today/
 * Same day: Leave previous/ untouched, move incremental/ to previous/, empty today/
 */
function resetStateForRun() {
  const today = new Date().toISOString().split('T')[0];
  const LAST_TRIM_PATH = path.join(__dirname, '../data/silver_trimmed/.last-trim');
  let lastTrim = null;
  if (fs.existsSync(LAST_TRIM_PATH)) {
    try {
      lastTrim = fs.readFileSync(LAST_TRIM_PATH, 'utf8').trim();
    } catch (e) {
      // Ignore
    }
  }
  
  const isNewDay = !lastTrim || lastTrim !== today;
  
  if (isNewDay) {
    log(`📅 New day detected: emptying previous/ and incremental/, copying today/ to previous/`);
    
    // Empty previous/
    if (fs.existsSync(SILVER_TRIMMED_PREVIOUS_DIR)) {
      const previousFiles = fs.readdirSync(SILVER_TRIMMED_PREVIOUS_DIR).filter(f => f.endsWith('.json'));
      for (const file of previousFiles) {
        fs.unlinkSync(path.join(SILVER_TRIMMED_PREVIOUS_DIR, file));
      }
    }
    
    // Move all files from incremental/ to previous/ (if any)
    if (fs.existsSync(SILVER_TRIMMED_INCREMENTAL_DIR)) {
      const incrementalFiles = fs.readdirSync(SILVER_TRIMMED_INCREMENTAL_DIR).filter(f => f.endsWith('.json'));
      for (const file of incrementalFiles) {
        try {
          const sourcePath = path.join(SILVER_TRIMMED_INCREMENTAL_DIR, file);
          const destPath = path.join(SILVER_TRIMMED_PREVIOUS_DIR, file);
          fs.copyFileSync(sourcePath, destPath);
        } catch (error) {
          log(`  ⚠️  Failed to move ${file} from incremental/ to previous/: ${error.message}`);
        }
      }
    }
    
    // Move all files from today/ to previous/ (preserve exact filenames)
    let copiedFromToday = 0;
    if (fs.existsSync(SILVER_TRIMMED_TODAY_DIR)) {
      const todayFiles = fs.readdirSync(SILVER_TRIMMED_TODAY_DIR).filter(f => f.endsWith('.json'));
      for (const file of todayFiles) {
        try {
          const sourcePath = path.join(SILVER_TRIMMED_TODAY_DIR, file);
          const destPath = path.join(SILVER_TRIMMED_PREVIOUS_DIR, file);
          fs.copyFileSync(sourcePath, destPath);
          copiedFromToday++;
        } catch (error) {
          log(`  ⚠️  Failed to copy ${file} from today/ to previous/: ${error.message}`);
        }
      }
    }
    
    // Empty today/
    if (fs.existsSync(SILVER_TRIMMED_TODAY_DIR)) {
      const todayFiles = fs.readdirSync(SILVER_TRIMMED_TODAY_DIR).filter(f => f.endsWith('.json'));
      for (const file of todayFiles) {
        fs.unlinkSync(path.join(SILVER_TRIMMED_TODAY_DIR, file));
      }
    }
    
    // Empty incremental/
    if (fs.existsSync(SILVER_TRIMMED_INCREMENTAL_DIR)) {
      const incrementalFiles = fs.readdirSync(SILVER_TRIMMED_INCREMENTAL_DIR).filter(f => f.endsWith('.json'));
      for (const file of incrementalFiles) {
        fs.unlinkSync(path.join(SILVER_TRIMMED_INCREMENTAL_DIR, file));
      }
    }
    
    log(`  ✅ Copied ${copiedFromToday} file(s) from today/ to previous/`);
    log(`  ✅ Emptied today/ and incremental/`);
  } else {
    log(`📅 Same-day rerun: emptying incremental/ and today/, repopulating today/, diff against previous/`);
    
    // Leave previous/ untouched (yesterday's baseline)
    
    // Move all files from incremental/ to previous/ (if any)
    if (fs.existsSync(SILVER_TRIMMED_INCREMENTAL_DIR)) {
      const incrementalFiles = fs.readdirSync(SILVER_TRIMMED_INCREMENTAL_DIR).filter(f => f.endsWith('.json'));
      for (const file of incrementalFiles) {
        try {
          const sourcePath = path.join(SILVER_TRIMMED_INCREMENTAL_DIR, file);
          const destPath = path.join(SILVER_TRIMMED_PREVIOUS_DIR, file);
          fs.copyFileSync(sourcePath, destPath);
        } catch (error) {
          log(`  ⚠️  Failed to move ${file} from incremental/ to previous/: ${error.message}`);
        }
      }
    }
    
    // Empty today/
    if (fs.existsSync(SILVER_TRIMMED_TODAY_DIR)) {
      const todayFiles = fs.readdirSync(SILVER_TRIMMED_TODAY_DIR).filter(f => f.endsWith('.json'));
      for (const file of todayFiles) {
        fs.unlinkSync(path.join(SILVER_TRIMMED_TODAY_DIR, file));
      }
    }
    
    // Empty incremental/
    if (fs.existsSync(SILVER_TRIMMED_INCREMENTAL_DIR)) {
      const incrementalFiles = fs.readdirSync(SILVER_TRIMMED_INCREMENTAL_DIR).filter(f => f.endsWith('.json'));
      for (const file of incrementalFiles) {
        fs.unlinkSync(path.join(SILVER_TRIMMED_INCREMENTAL_DIR, file));
      }
    }
    
    log(`  ✅ Emptied today/ and incremental/`);
  }
}

/**
 * Main execution
 */
function main() {
  const areaFilter = process.argv[2] || null;
  
  log(`\n📄 Starting HTML trimming${areaFilter ? ` (filter: ${areaFilter})` : ''}...`);
  
  // Reset state before processing (new day or same-day rerun)
  resetStateForRun();
  
  // Save today's date
  const today = new Date().toISOString().split('T')[0];
  const LAST_TRIM_PATH = path.join(__dirname, '../data/silver_trimmed/.last-trim');
  fs.writeFileSync(LAST_TRIM_PATH, today, 'utf8');
  
  // INCREMENTAL MODE: Only process venues in silver_merged/incremental/
  if (!fs.existsSync(SILVER_MERGED_INCREMENTAL_DIR)) {
    log(`📁 Incremental directory not found: ${SILVER_MERGED_INCREMENTAL_DIR}`);
    log(`   Creating directory...`);
    fs.mkdirSync(SILVER_MERGED_INCREMENTAL_DIR, { recursive: true });
  }
  
  // Clear output incremental folder at start
  if (fs.existsSync(SILVER_TRIMMED_INCREMENTAL_DIR)) {
    try {
      const existingFiles = fs.readdirSync(SILVER_TRIMMED_INCREMENTAL_DIR);
      existingFiles.forEach(file => {
        const filePath = path.join(SILVER_TRIMMED_INCREMENTAL_DIR, file);
        if (fs.statSync(filePath).isFile()) {
          fs.unlinkSync(filePath);
        }
      });
    } catch (error) {
      // Ignore errors when clearing
    }
  }
  
  // Get venue files from silver_merged/incremental/ (incremental mode)
  let venueFiles = [];
  try {
    if (fs.existsSync(SILVER_MERGED_INCREMENTAL_DIR)) {
      venueFiles = fs.readdirSync(SILVER_MERGED_INCREMENTAL_DIR).filter(file => file.endsWith('.json'));
    }
  } catch (error) {
    log(`❌ Error reading silver_merged/incremental directory: ${error.message}`);
    process.exit(1);
  }
  
  // If incremental folder is empty, stop processing
  if (venueFiles.length === 0) {
    log(`⏭️  No incremental files found in ${SILVER_MERGED_INCREMENTAL_DIR}`);
    log(`   Incremental folder is empty - nothing to trim.`);
    log(`\n✨ Skipped trim (incremental mode - no changes)`);
    return;
  }
  
  log(`📁 Found ${venueFiles.length} venue file(s) in incremental folder.`);
  
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
  log(`\n✨ Done! Trimmed files saved to ${SILVER_TRIMMED_TODAY_DIR}`);
}

// Run if called directly
if (require.main === module) {
  main();
  // Explicitly exit to ensure process terminates (important when called from pipeline)
  process.exit(0);
}

// Export for testing
module.exports = { trimHtml, processVenueFile, normalizeText, normalizeUrl };
