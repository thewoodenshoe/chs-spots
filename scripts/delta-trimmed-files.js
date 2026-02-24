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
const { normalizeText } = require('./utils/normalize');
const { loadConfig, getRunDate, loadWatchlist } = require('./utils/config');
const { dataPath, reportingPath } = require('./utils/data-dir');

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

// Paths - Respect DATA_DIR
const SILVER_TRIMMED_TODAY_DIR = dataPath('silver_trimmed', 'today');
const SILVER_TRIMMED_PREVIOUS_DIR = dataPath('silver_trimmed', 'previous');
const SILVER_TRIMMED_INCREMENTAL_DIR = dataPath('silver_trimmed', 'incremental');

// Ensure directories exist
if (!fs.existsSync(SILVER_TRIMMED_INCREMENTAL_DIR)) {
  fs.mkdirSync(SILVER_TRIMMED_INCREMENTAL_DIR, { recursive: true });
}
if (!fs.existsSync(SILVER_TRIMMED_PREVIOUS_DIR)) {
  fs.mkdirSync(SILVER_TRIMMED_PREVIOUS_DIR, { recursive: true });
}

// ── Minimum-change thresholds ───────────────────────────────────
// A venue is only marked "changed" if the *meaningful* text difference
// exceeds BOTH an absolute and a relative threshold.
const MIN_CHANGE_CHARS = 300;   // absolute: at least 300 chars different
const MIN_CHANGE_PCT   = 5.0;   // relative: at least 5 % of the content

/**
 * Strip the URL down to just origin + pathname (no query / fragment)
 * so that the same page scraped with different tracking params matches.
 */
function canonicalUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    return (u.origin + u.pathname).replace(/\/+$/, '');
  } catch {
    return url.split('?')[0].split('#')[0].replace(/\/+$/, '');
  }
}

/**
 * Build a word-frequency bag from text.
 * Words shorter than 3 chars are ignored to reduce noise.
 */
function wordBag(text) {
  const bag = {};
  const words = text.toLowerCase().split(/\s+/);
  for (const w of words) {
    if (w.length < 3) continue;
    bag[w] = (bag[w] || 0) + 1;
  }
  return bag;
}

/**
 * Compute how different two word bags are.
 * Returns { addedWords, removedWords, changedChars } — the estimated
 * number of characters that are truly different (added + removed words).
 */
function wordBagDiff(bagA, bagB) {
  let addedChars = 0;
  let removedChars = 0;

  const allKeys = new Set([...Object.keys(bagA), ...Object.keys(bagB)]);
  for (const k of allKeys) {
    const a = bagA[k] || 0;
    const b = bagB[k] || 0;
    const delta = b - a;
    if (delta > 0) addedChars += delta * (k.length + 1);   // +1 for space
    if (delta < 0) removedChars += (-delta) * (k.length + 1);
  }
  return { addedChars, removedChars, changedChars: addedChars + removedChars };
}

/**
 * Compare two venue JSON files **page-by-page using URL matching**
 * and decide whether the venue has meaningfully changed.
 *
 * Uses a word-bag diff approach: tokenises normalised text into words and
 * counts words that were added or removed.  This is order-independent and
 * robust to small shifts, re-ordering of sections, and minor wording tweaks.
 *
 * Returns { changed: boolean, reason: string, charsDiff: number, pctDiff: number }
 */
function compareVenues(todayFilePath, previousFilePath) {
  try {
    const todayData    = JSON.parse(fs.readFileSync(todayFilePath, 'utf8'));
    const previousData = JSON.parse(fs.readFileSync(previousFilePath, 'utf8'));

    const todayPages    = (todayData.pages || []);
    const previousPages = (previousData.pages || []);

    // Filter out Cloudflare CDN challenge pages — these contain randomly
    // generated filler text that changes daily and is never restaurant content
    const isUsablePage = (page) => {
      const url = page.url || '';
      if (/\/cdn-cgi\//i.test(url)) return false;
      if (/\/challenge-platform\//i.test(url)) return false;
      return true;
    };

    const filteredTodayPages = todayPages.filter(isUsablePage);
    const filteredPreviousPages = previousPages.filter(isUsablePage);

    // Build lookup of previous pages by canonical URL
    const prevByUrl = {};
    for (const p of filteredPreviousPages) {
      const key = canonicalUrl(p.url);
      if (key) prevByUrl[key] = p;
    }

    // Gather ALL normalised text per side, matched by URL where possible
    let prevAllText = '';
    let todayAllText = '';

    const matchedPrevUrls = new Set();
    for (const tp of filteredTodayPages) {
      const key = canonicalUrl(tp.url);
      todayAllText += ' ' + normalizeText(tp.text || '');
      const pp = key ? prevByUrl[key] : null;
      if (pp) {
        matchedPrevUrls.add(key);
        prevAllText += ' ' + normalizeText(pp.text || '');
      }
    }
    for (const pp of filteredPreviousPages) {
      const key = canonicalUrl(pp.url);
      if (key && !matchedPrevUrls.has(key)) {
        prevAllText += ' ' + normalizeText(pp.text || '');
      }
    }

    // Quick identity check (fast path)
    if (prevAllText.trim() === todayAllText.trim()) {
      return { changed: false, reason: 'identical', charsDiff: 0, pctDiff: 0 };
    }

    // Word-bag diff
    const prevBag  = wordBag(prevAllText);
    const todayBag = wordBag(todayAllText);
    const { changedChars } = wordBagDiff(prevBag, todayBag);

    const totalChars = Math.max(prevAllText.length, todayAllText.length, 1);
    const pctDiff = changedChars / totalChars * 100;

    // Apply thresholds
    if (changedChars >= MIN_CHANGE_CHARS && pctDiff >= MIN_CHANGE_PCT) {
      return { changed: true,  reason: 'content', charsDiff: changedChars, pctDiff };
    }
    return { changed: false, reason: changedChars > 0 ? 'below_threshold' : 'identical', charsDiff: changedChars, pctDiff };
  } catch (error) {
    return { changed: true, reason: `error: ${error.message}`, charsDiff: -1, pctDiff: -1 };
  }
}

/**
 * Main function
 */
function main() {
  log('🔍 Starting Delta Comparison (Trimmed Content)\n');
  log(`   Thresholds: min ${MIN_CHANGE_CHARS} chars AND min ${MIN_CHANGE_PCT}% change\n`);
  const config = loadConfig();
  const runDate = process.env.PIPELINE_RUN_DATE || config.run_date || getRunDate();
  const manifestPath = process.env.PIPELINE_MANIFEST_PATH || null;
  log(`📅 Effective delta run_date: ${runDate}`);
  if (manifestPath) {
    log(`🧾 Run manifest: ${manifestPath}`);
  }
  
  // Check if silver_trimmed/today/ exists
  if (!fs.existsSync(SILVER_TRIMMED_TODAY_DIR)) {
    log(`❌ Trimmed directory not found: ${SILVER_TRIMMED_TODAY_DIR}`);
    log(`   Run trim-silver-html.js first.`);
    process.exit(1);
  }
  
  const previousFiles = fs.existsSync(SILVER_TRIMMED_PREVIOUS_DIR) 
    ? fs.readdirSync(SILVER_TRIMMED_PREVIOUS_DIR).filter(f => f.endsWith('.json'))
    : [];
  const allFiles = fs.existsSync(SILVER_TRIMMED_TODAY_DIR)
    ? fs.readdirSync(SILVER_TRIMMED_TODAY_DIR).filter(f => f.endsWith('.json'))
    : [];
  log(`📊 File counts: previous/ contains ${previousFiles.length} file(s), today/ contains ${allFiles.length} file(s)`);
  if (previousFiles.length === 0) {
    log(`📅 previous/ is empty — treating all today files as new venues`);
  }
  log('');
  
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
  
  // Refresh file lists
  const todayFilesList = fs.existsSync(SILVER_TRIMMED_TODAY_DIR)
    ? fs.readdirSync(SILVER_TRIMMED_TODAY_DIR).filter(f => f.endsWith('.json'))
    : [];
  const previousFilesList = fs.existsSync(SILVER_TRIMMED_PREVIOUS_DIR)
    ? fs.readdirSync(SILVER_TRIMMED_PREVIOUS_DIR).filter(f => f.endsWith('.json'))
    : [];
  
  log(`📁 Found ${todayFilesList.length} venue file(s) in silver_trimmed/today/`);
  log(`📁 Found ${previousFilesList.length} venue file(s) in silver_trimmed/previous/\n`);
  
  let newVenues = 0;
  let changedVenues = 0;
  let unchangedVenues = 0;
  let belowThreshold = 0;
  let excludedVenues = 0;

  const watchlist = loadWatchlist();
  if (watchlist.excluded.size > 0) {
    log(`🚫 Watchlist loaded: ${watchlist.excluded.size} excluded venue(s) will be skipped\n`);
  }
  
  // Process each file
  for (const file of todayFilesList) {
    const venueId = path.basename(file, '.json');

    if (watchlist.excluded.has(venueId)) {
      excludedVenues++;
      continue;
    }
    const todayFilePath = path.join(SILVER_TRIMMED_TODAY_DIR, file);
    const previousFilePath = path.join(SILVER_TRIMMED_PREVIOUS_DIR, file);
    const incrementalFilePath = path.join(SILVER_TRIMMED_INCREMENTAL_DIR, file);
    
    // Check if venue is new (doesn't exist in previous/)
    if (!fs.existsSync(previousFilePath)) {
      fs.copyFileSync(todayFilePath, incrementalFilePath);
      log(`  ✨ New venue: ${venueId}`);
      newVenues++;
      continue;
    }
    
    // Venue exists in both — smart comparison
    const result = compareVenues(todayFilePath, previousFilePath);
    
    if (result.changed) {
      fs.copyFileSync(todayFilePath, incrementalFilePath);
      log(`  🔄 Changed venue: ${venueId}  (${result.charsDiff} chars, ${result.pctDiff.toFixed(1)}%)`);
      changedVenues++;
    } else if (result.reason === 'below_threshold') {
      log(`  ⏭️  Below threshold: ${venueId}  (${result.charsDiff} chars, ${result.pctDiff.toFixed(1)}%)`);
      belowThreshold++;
    } else {
      unchangedVenues++;
    }
  }
  
  // Summary
  log(`\n📊 Delta Summary (Trimmed Content):`);
  log(`   ✨ New venues: ${newVenues}`);
  log(`   🔄 Changed venues: ${changedVenues}`);
  log(`   ⏭️  Unchanged venues: ${unchangedVenues}`);
  log(`   🚫 Below threshold (noise filtered): ${belowThreshold}`);
  if (excludedVenues > 0) log(`   🚫 Excluded (watchlist): ${excludedVenues}`);
  log(`   📄 Total files ready for LLM: ${newVenues + changedVenues}`);
  log(`\n✨ Done! Changed files copied to: ${path.resolve(SILVER_TRIMMED_INCREMENTAL_DIR)}`);
  
  if (newVenues + changedVenues === 0) {
    log(`\n⚠️  No changes detected - incremental folder is empty`);
    log(`   LLM extraction step will skip processing.`);
  }
  
  // Generate difference reports for LLM
  if (newVenues + changedVenues > 0) {
    generateDifferenceReports(newVenues, changedVenues);
  }
}

/**
 * Generate difference reports for each incremental file
 * Creates timestamped directory in logs/differences_for_llm/ with JSON files showing actual differences
 */
function generateDifferenceReports(newVenues, changedVenues) {
  try {
    // Get EST timezone timestamp (YYYYMMDD-HHMM format, no seconds)
    // EST is UTC-5, EDT is UTC-4 (daylight saving)
    const now = new Date();
    // Check if DST is in effect (rough approximation: March-November)
    const month = now.getUTCMonth(); // 0-11
    const isDST = month >= 2 && month <= 9; // March (2) to October (9)
    const estOffset = isDST ? -4 : -5; // EDT is UTC-4, EST is UTC-5
    const estTime = new Date(now.getTime() + (estOffset * 60 * 60 * 1000));
    
    // Format as YYYYMMDD-HHMM
    const year = estTime.getUTCFullYear();
    const monthStr = String(estTime.getUTCMonth() + 1).padStart(2, '0');
    const dayStr = String(estTime.getUTCDate()).padStart(2, '0');
    const hourStr = String(estTime.getUTCHours()).padStart(2, '0');
    const minuteStr = String(estTime.getUTCMinutes()).padStart(2, '0');
    const timestampDir = `${year}${monthStr}${dayStr}-${hourStr}${minuteStr}`;
    
    const DIFF_REPORTS_DIR = path.join(__dirname, '..', 'logs', 'differences_for_llm', timestampDir);
    
    // Create directory (parent directories created automatically)
    if (!fs.existsSync(DIFF_REPORTS_DIR)) {
      fs.mkdirSync(DIFF_REPORTS_DIR, { recursive: true });
    }
    
    log(`\n📝 Generating difference reports in: ${path.resolve(DIFF_REPORTS_DIR)}`);
    
    // Load venues.json to get venue metadata
    const REPORTING_VENUES = reportingPath('venues.json');
    const LEGACY_VENUES = dataPath('venues.json');
    const VENUES_PATH = fs.existsSync(REPORTING_VENUES) ? REPORTING_VENUES : LEGACY_VENUES;
    
    let venuesMap = {};
    if (fs.existsSync(VENUES_PATH)) {
      try {
        const venuesData = JSON.parse(fs.readFileSync(VENUES_PATH, 'utf8'));
        if (Array.isArray(venuesData)) {
          venuesData.forEach(venue => {
            const venueId = venue.id || venue.place_id || venue.venueId;
            if (venueId) {
              venuesMap[venueId] = {
                name: venue.name || venue.venueName || 'Unknown',
                area: venue.area || 'Unknown',
                website: venue.website || ''
              };
            }
          });
        }
      } catch (error) {
        log(`  ⚠️  Could not load venues.json: ${error.message}`);
      }
    }
    
    // Process each incremental file
    const incrementalFiles = fs.readdirSync(SILVER_TRIMMED_INCREMENTAL_DIR).filter(f => f.endsWith('.json'));
    let reportsGenerated = 0;
    
    for (const file of incrementalFiles) {
      const venueId = path.basename(file, '.json');
      const todayFilePath = path.join(SILVER_TRIMMED_TODAY_DIR, file);
      const previousFilePath = path.join(SILVER_TRIMMED_PREVIOUS_DIR, file);
      const incrementalFilePath = path.join(SILVER_TRIMMED_INCREMENTAL_DIR, file);
      
      try {
        const todayData = JSON.parse(fs.readFileSync(todayFilePath, 'utf8'));
        const venueInfo = venuesMap[venueId] || {
          name: todayData.venueName || 'Unknown',
          area: todayData.venueArea || 'Unknown',
          website: todayData.website || ''
        };
        
        const report = {
          venueId: venueId,
          venueName: venueInfo.name,
          venueArea: venueInfo.area,
          website: venueInfo.website,
          scrapedAt: todayData.scrapedAt || null,
          trimmedAt: todayData.trimmedAt || null,
          difference: []
        };
        
        // Check if it's a new venue
        if (!fs.existsSync(previousFilePath)) {
          report.difference.push({
            type: 'new',
            description: 'New venue - no previous version',
            todayPages: (todayData.pages || []).length,
            todayText: (todayData.pages || []).map(p => p.text || '').join('\n\n---PAGE BREAK---\n\n').substring(0, 2000) // First 2000 chars
          });
        } else {
          // Compare today vs previous
          const previousData = JSON.parse(fs.readFileSync(previousFilePath, 'utf8'));
          const todayPages = todayData.pages || [];
          const previousPages = previousData.pages || [];
          
          // Compare page by page
          const maxPages = Math.max(todayPages.length, previousPages.length);
          for (let i = 0; i < maxPages; i++) {
            const todayPage = todayPages[i];
            const previousPage = previousPages[i];
            
            if (!previousPage) {
              report.difference.push({
                type: 'page_added',
                pageIndex: i,
                description: `New page added: ${todayPage?.title || 'Untitled'}`,
                text: (todayPage?.text || '').substring(0, 1000)
              });
            } else if (!todayPage) {
              report.difference.push({
                type: 'page_removed',
                pageIndex: i,
                description: `Page removed: ${previousPage?.title || 'Untitled'}`,
                text: (previousPage?.text || '').substring(0, 1000)
              });
            } else {
              // Compare text content
              const todayText = todayPage.text || '';
              const previousText = previousPage.text || '';
              
              if (todayText !== previousText) {
                // Find actual differences (simplified - show first 500 chars of each)
                const todayNormalized = normalizeText(todayText);
                const previousNormalized = normalizeText(previousText);
                
                if (todayNormalized !== previousNormalized) {
                  report.difference.push({
                    type: 'content_changed',
                    pageIndex: i,
                    pageTitle: todayPage.title || previousPage.title || 'Untitled',
                    description: 'Content changed in this page',
                    previousText: previousText.substring(0, 1000),
                    todayText: todayText.substring(0, 1000),
                    previousTextLength: previousText.length,
                    todayTextLength: todayText.length
                  });
                }
              }
            }
          }
          
          // If no page differences found, check for metadata changes
          if (report.difference.length === 0) {
            report.difference.push({
              type: 'metadata_changed',
              description: 'File marked as changed but no text differences found (may be metadata or hash difference)',
              todayHash: todayData.venueHash || 'N/A',
              previousHash: previousData.venueHash || 'N/A'
            });
          }
        }
        
        // Write report file
        const reportPath = path.join(DIFF_REPORTS_DIR, `${venueId}.json`);
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
        reportsGenerated++;
        
      } catch (error) {
        log(`  ⚠️  Error generating report for ${venueId}: ${error.message}`);
      }
    }
    
    log(`  ✅ Generated ${reportsGenerated} difference report(s)`);
    
  } catch (error) {
    log(`  ⚠️  Error generating difference reports: ${error.message}`);
    // Don't fail the pipeline if difference report generation fails
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
