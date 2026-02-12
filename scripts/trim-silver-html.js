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
// Note: silver_merged/incremental/ is no longer used - comparison happens at trimmed layer
const SILVER_TRIMMED_DIR = path.join(__dirname, '../data/silver_trimmed');
const SILVER_TRIMMED_TODAY_DIR = path.join(SILVER_TRIMMED_DIR, 'today');
const SILVER_TRIMMED_PREVIOUS_DIR = path.join(SILVER_TRIMMED_DIR, 'previous');
const SILVER_TRIMMED_INCREMENTAL_DIR = path.join(SILVER_TRIMMED_DIR, 'incremental');
const VENUES_PATH = path.join(__dirname, '../data/venues.json');
const { loadConfig, updateConfigField, getRunDate } = require('./utils/config');
const { normalizeText, normalizeUrl } = require('./utils/normalize');

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

// Maximum chars per page after trimming — anything beyond this is truncated
const MAX_PAGE_CHARS = 50000;

// URLs that should be entirely skipped (not relevant for promotions)
const SKIP_PAGE_URL_PATTERNS = [
  /\/event-?calendar\b/i,
  /\/upcoming-?events\b/i,
  /\/events-?calendar\b/i,
  /\/blog\b/i,
  /\/news\b/i,
  /\/press\b/i,
  /\/careers?\b/i,
  /\/jobs?\b/i,
  /\/privacy-?policy\b/i,
  /\/terms/i,
  /\/cookie-?policy\b/i,
];

// Boilerplate text patterns to strip after extraction
const BOILERPLATE_PATTERNS = [
  // Cookie consent
  /we use cookies[^.]*\./gi,
  /this (?:site|website) uses cookies[^.]*\./gi,
  /by (?:continuing|using) (?:this|our) (?:site|website)[^.]*cookies[^.]*\./gi,
  /accept (?:all )?cookies/gi,
  /cookie (?:policy|preferences|settings|consent)/gi,
  // Terms / Privacy
  /we have updated our[^.]*terms[^.]*\./gi,
  /terms of (?:service|use)/gi,
  /privacy policy/gi,
  // Newsletter
  /sign ?up (?:for|to) (?:our|the) (?:newsletter|emails?|mailing list)[^.]*\./gi,
  /subscribe to (?:our|the) (?:newsletter|emails?)[^.]*\./gi,
  /enter your email[^.]*\./gi,
  // Social media CTAs (not the actual content links, just "Follow Us" type noise)
  /follow us on (?:instagram|facebook|twitter|tiktok|social media)[^.]*\./gi,
  /(?:find|join|connect with) us on (?:instagram|facebook|twitter|tiktok)[^.]*\./gi,
  // Google Calendar / ICS links (event page noise)
  /Google Calendar ICS/g,
  /Add to Calendar/gi,
  /View Event →/g,
];

/**
 * Check if a page URL should be entirely skipped
 */
function shouldSkipPage(url) {
  if (!url) return false;
  // Skip PDFs and binary files
  if (/\.(?:pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|svg|webp)(\?|$)/i.test(url)) {
    return true;
  }
  return SKIP_PAGE_URL_PATTERNS.some(pattern => pattern.test(url));
}

/**
 * Strip boilerplate text patterns
 */
function stripBoilerplate(text) {
  let cleaned = text;
  for (const pattern of BOILERPLATE_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }
  return cleaned;
}

/**
 * Trim HTML and extract visible text
 */
function trimHtml(html, pageUrl) {
  if (!html || typeof html !== 'string') {
    return '';
  }

  // Skip PDF binary content entirely
  if (html.trimStart().startsWith('%PDF')) {
    return '';
  }

  // Skip pages by URL pattern
  if (shouldSkipPage(pageUrl)) {
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
    
    // Remove cookie consent banners
    $('.cookie-banner, .cookie-consent, .cookie-notice, #cookie-banner, #cookie-consent, #gdpr-consent, .gdpr-banner').remove();
    $('[class*="cookie"], [id*="cookie-consent"], [id*="cookie-banner"]').remove();
    
    // Remove newsletter signup forms
    $('.newsletter, .newsletter-signup, .email-signup, #newsletter').remove();
    
    // Remove social media widgets
    $('.social-links, .social-media, .social-icons, .share-buttons').remove();
    
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
    
    // Strip boilerplate text
    text = stripBoilerplate(text);
    
    // Normalize whitespace - preserve line breaks but clean up excessive spaces
    text = text
      .replace(/[ \t]+/g, ' ')        // Multiple spaces/tabs → single space (but keep \n)
      .replace(/\n\s*\n\s*\n+/g, '\n\n')  // Multiple newlines → max 2
      .trim();
    
    // Enforce per-page character cap
    if (text.length > MAX_PAGE_CHARS) {
      text = text.substring(0, MAX_PAGE_CHARS) + '\n[...truncated at ' + MAX_PAGE_CHARS + ' chars]';
    }
    
    return text;
  } catch (error) {
    log(`Error parsing HTML: ${error.message}`);
    // Fallback: try to extract plain text without parsing
    const fallback = html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    return fallback.length > MAX_PAGE_CHARS ? fallback.substring(0, MAX_PAGE_CHARS) : fallback;
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
  // FULL MODE: Read from silver_merged/today/
  const silverFilePath = path.join(SILVER_MERGED_TODAY_DIR, `${venueId}.json`);
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
    
    // Trim HTML to visible text (pass URL for skip-page filtering)
    const trimmedText = trimHtml(originalHtml, page.url);
    const trimmedSize = trimmedText.length;
    totalTrimmedSize += trimmedSize;
    
    // Skip empty pages (PDF binary, skipped URLs, etc.)
    if (!trimmedText || trimmedText.length === 0) {
      continue;
    }
    
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
 * Check if directory is empty
 */
function isDirectoryEmpty(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return true;
  }
  const items = fs.readdirSync(dirPath);
  return items.length === 0;
}

/**
 * Archive today/ to previous/ on new day
 * Explicitly empties previous/ before copying to ensure clean state
 * Uses rmSync to completely remove and recreate directory for reliability
 */
function archiveTodayToPrevious() {
  log(`📅 New day detected: archiving silver_trimmed/today/ to silver_trimmed/previous/`);
  
  // Get count of files in today/ before archiving
  const todayFilesBefore = fs.existsSync(SILVER_TRIMMED_TODAY_DIR)
    ? fs.readdirSync(SILVER_TRIMMED_TODAY_DIR).filter(f => f.endsWith('.json'))
    : [];
  const todayCountBefore = todayFilesBefore.length;
  log(`  📊 today/ contains ${todayCountBefore} file(s) before archive`);
  
  // Explicitly empty previous/ by removing entire directory and recreating (more reliable)
  if (fs.existsSync(SILVER_TRIMMED_PREVIOUS_DIR)) {
    fs.rmSync(SILVER_TRIMMED_PREVIOUS_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(SILVER_TRIMMED_PREVIOUS_DIR, { recursive: true });
  log(`  🗑️  Emptied silver_trimmed/previous/ (removed directory and recreated)`);
  
  // Copy ALL files from today/ to previous/ using fs.copyFileSync in a loop, preserving exact filenames
  // No filtering - copy everything that ends with .json
  let copiedCount = 0;
  const copiedFilenames = [];
  const failedCopies = [];
  
  if (fs.existsSync(SILVER_TRIMMED_TODAY_DIR)) {
    const todayFiles = fs.readdirSync(SILVER_TRIMMED_TODAY_DIR).filter(f => f.endsWith('.json'));
    log(`  📋 Found ${todayFiles.length} .json file(s) in today/ to copy`);
    
    for (const file of todayFiles) {
      try {
        const sourcePath = path.join(SILVER_TRIMMED_TODAY_DIR, file);
        const destPath = path.join(SILVER_TRIMMED_PREVIOUS_DIR, file);
        
        // Verify source file exists before copying
        if (!fs.existsSync(sourcePath)) {
          log(`  ⚠️  Source file does not exist: ${file}`);
          failedCopies.push(file);
          continue;
        }
        
        fs.copyFileSync(sourcePath, destPath);
        
        // Verify destination file was created
        if (!fs.existsSync(destPath)) {
          log(`  ⚠️  Copy failed - destination file not found: ${file}`);
          failedCopies.push(file);
          continue;
        }
        
        copiedCount++;
        if (copiedFilenames.length < 5) {
          copiedFilenames.push(file);
        }
      } catch (error) {
        log(`  ⚠️  Failed to copy ${file} from today/ to previous/: ${error.message}`);
        failedCopies.push(file);
      }
    }
  }
  
  log(`  ✅ Copied ${copiedCount} file(s) from silver_trimmed/today/ to silver_trimmed/previous/`);
  if (failedCopies.length > 0) {
    log(`  ⚠️  Failed to copy ${failedCopies.length} file(s): ${failedCopies.slice(0, 5).join(', ')}${failedCopies.length > 5 ? '...' : ''}`);
  }
  if (copiedFilenames.length > 0) {
    log(`  📋 First 5 filenames copied: ${copiedFilenames.join(', ')}`);
  }
  
  // Verify previous/ now contains the files - should match today/ count
  const previousFilesAfter = fs.existsSync(SILVER_TRIMMED_PREVIOUS_DIR)
    ? fs.readdirSync(SILVER_TRIMMED_PREVIOUS_DIR).filter(f => f.endsWith('.json'))
    : [];
  const previousCountAfter = previousFilesAfter.length;
  log(`  ✅ previous/ now contains ${previousCountAfter} file(s) (should match today/'s ${todayCountBefore})`);
  
  // Warn if counts don't match
  if (previousCountAfter !== todayCountBefore) {
    log(`  ⚠️  WARNING: Count mismatch! previous/ has ${previousCountAfter} files but today/ had ${todayCountBefore} files`);
    log(`     This may indicate incomplete copy. Check logs above for failed copies.`);
  } else {
    log(`  ✅ Counts match - archive successful`);
  }
  
  // Delete all files from today/
  if (fs.existsSync(SILVER_TRIMMED_TODAY_DIR)) {
    const todayFiles = fs.readdirSync(SILVER_TRIMMED_TODAY_DIR).filter(f => f.endsWith('.json'));
    for (const file of todayFiles) {
      fs.unlinkSync(path.join(SILVER_TRIMMED_TODAY_DIR, file));
    }
  }
  log(`  🗑️  Deleted all files from silver_trimmed/today/`);
}

/**
 * Reset state for new day or same-day rerun
 * Uses config.json instead of .last-trim file
 */
function resetStateForRun() {
  const config = loadConfig();
  const runDate = config.run_date || getRunDate();
  const todayEmpty = isDirectoryEmpty(SILVER_TRIMMED_TODAY_DIR);
  
  log(`📊 State check:`);
  log(`   run_date: ${runDate}`);
  log(`   silver_trimmed/today/ empty: ${todayEmpty}`);
  
  // If today/ is not empty, archive it to previous/ (new day scenario)
  if (!todayEmpty) {
    archiveTodayToPrevious();
  }
  
  // Clear incremental/ always at the start
  if (fs.existsSync(SILVER_TRIMMED_INCREMENTAL_DIR)) {
    const incrementalFiles = fs.readdirSync(SILVER_TRIMMED_INCREMENTAL_DIR).filter(f => f.endsWith('.json'));
    for (const file of incrementalFiles) {
      fs.unlinkSync(path.join(SILVER_TRIMMED_INCREMENTAL_DIR, file));
    }
    if (incrementalFiles.length > 0) {
      log(`  🧹 Cleared ${incrementalFiles.length} file(s) from silver_trimmed/incremental/`);
    }
  }
  
  updateConfigField('last_run_status', 'running_trimmed');
}

/**
 * Main execution
 */
function main() {
  const areaFilter = process.argv[2] || null;
  
  log(`\n📄 Starting HTML trimming${areaFilter ? ` (filter: ${areaFilter})` : ''}...`);
  
  // Reset state before processing (new day or same-day rerun)
  resetStateForRun();
  
  // FULL MODE: Get ALL venue files from silver_merged/today/
  // Clear output incremental folder at start (for delta-trimmed-files.js later)
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
  
  // Get ALL venue files from silver_merged/today/ (full mode)
  let venueFiles = [];
  try {
    if (fs.existsSync(SILVER_MERGED_TODAY_DIR)) {
      venueFiles = fs.readdirSync(SILVER_MERGED_TODAY_DIR).filter(file => file.endsWith('.json'));
    }
  } catch (error) {
    log(`❌ Error reading silver_merged/today directory: ${error.message}`);
    process.exit(1);
  }
  
  // If today folder is empty, stop processing
  if (venueFiles.length === 0) {
    log(`⏭️  No files found in ${SILVER_MERGED_TODAY_DIR}`);
    log(`   Silver merged today folder is empty - nothing to trim.`);
    log(`\n✨ Skipped trim (no files to process)`);
    return;
  }
  
  log(`📁 Found ${venueFiles.length} venue file(s) in silver_merged/today/.`);
  
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
  // Update status after successful trim
  updateConfigField('last_run_status', 'running_trimmed');
  
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
