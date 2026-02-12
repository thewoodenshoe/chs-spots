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
const { loadConfig, getRunDate } = require('./utils/config');

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

// Paths
const SILVER_TRIMMED_TODAY_DIR = path.join(__dirname, '../data/silver_trimmed/today');
const SILVER_TRIMMED_PREVIOUS_DIR = path.join(__dirname, '../data/silver_trimmed/previous');
const SILVER_TRIMMED_INCREMENTAL_DIR = path.join(__dirname, '../data/silver_trimmed/incremental');

// Ensure directories exist
if (!fs.existsSync(SILVER_TRIMMED_INCREMENTAL_DIR)) {
  fs.mkdirSync(SILVER_TRIMMED_INCREMENTAL_DIR, { recursive: true });
}
if (!fs.existsSync(SILVER_TRIMMED_PREVIOUS_DIR)) {
  fs.mkdirSync(SILVER_TRIMMED_PREVIOUS_DIR, { recursive: true });
}

/**
 * Get trimmed content hash from a trimmed JSON file
 * Always normalizes text before hashing to ensure consistent comparison
 * Uses venueHash if available (from new trim-silver-html.js), otherwise computes from pages
 * 
 * IMPORTANT: Always recomputes hash from normalized text to ensure consistency,
 * even if venueHash exists. This handles cases where files were created with
 * older normalization logic.
 */
function getTrimmedContentHash(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    // Always compute hash from normalized page texts for consistency
    // This ensures files created with older normalization logic are compared correctly
    const pages = data.pages || [];
    const pagesContent = pages.map(p => {
      const text = p.text || '';
      // Normalize text (same as trim-silver-html.js normalizeText function)
      return normalizeText(text);
    }).join('\n');
    
    const computedHash = crypto.createHash('md5').update(pagesContent).digest('hex');
    
    // If venueHash exists and differs from computed hash, log a warning
    // This helps identify normalization inconsistencies
    if (data.venueHash && data.venueHash !== computedHash) {
      const venueId = data.venueId || path.basename(filePath, '.json');
      log(`  ⚠️  Hash mismatch for ${venueId}: venueHash=${data.venueHash.substring(0, 8)}... vs computed=${computedHash.substring(0, 8)}... (using computed)`);
    }
    
    return computedHash;
  } catch (error) {
    log(`  ⚠️  Error reading file ${filePath}: ${error.message}`);
    return null;
  }
}

/**
 * Main function
 */
function main() {
  log('🔍 Starting Delta Comparison (Trimmed Content)\n');
  const config = loadConfig();
  const runDate = process.env.PIPELINE_RUN_DATE || config.run_date || getRunDate();
  const manifestPath = process.env.PIPELINE_MANIFEST_PATH || null;
  log(`📅 Effective delta run_date: ${runDate}`);
  if (manifestPath) {
    log(`🧾 Run manifest: ${manifestPath}`);
  }
  
  // Check if silver_trimmed/all/ exists
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
  
  // Refresh todayFiles list after potential archive (in case archive modified today/)
  const todayFilesList = fs.existsSync(SILVER_TRIMMED_TODAY_DIR)
    ? fs.readdirSync(SILVER_TRIMMED_TODAY_DIR).filter(f => f.endsWith('.json'))
    : [];
  
  // Refresh previousFiles list as well
  const previousFilesList = fs.existsSync(SILVER_TRIMMED_PREVIOUS_DIR)
    ? fs.readdirSync(SILVER_TRIMMED_PREVIOUS_DIR).filter(f => f.endsWith('.json'))
    : [];
  
  log(`📁 Found ${todayFilesList.length} venue file(s) in silver_trimmed/today/`);
  log(`📁 Found ${previousFilesList.length} venue file(s) in silver_trimmed/previous/\n`);
  
  let newVenues = 0;
  let changedVenues = 0;
  let unchangedVenues = 0;
  
  // Process each file
  for (const file of todayFilesList) {
    const venueId = path.basename(file, '.json');
    const todayFilePath = path.join(SILVER_TRIMMED_TODAY_DIR, file);
    const previousFilePath = path.join(SILVER_TRIMMED_PREVIOUS_DIR, file);
    const incrementalFilePath = path.join(SILVER_TRIMMED_INCREMENTAL_DIR, file);
    
    // Check if venue is new (doesn't exist in previous/)
    if (!fs.existsSync(previousFilePath)) {
      // New venue - copy to incremental
      fs.copyFileSync(todayFilePath, incrementalFilePath);
      log(`  ✨ New venue: ${venueId}`);
      newVenues++;
      continue;
    }
    
    // Venue exists in both - check for changes in trimmed content
    const todayHash = getTrimmedContentHash(todayFilePath);
    const previousHash = getTrimmedContentHash(previousFilePath);
    
    if (!todayHash || !previousHash) {
      // Error reading hashes - treat as changed to be safe
      fs.copyFileSync(todayFilePath, incrementalFilePath);
      log(`  ⚠️  Changed venue (hash error): ${venueId}`);
      changedVenues++;
      continue;
    }
    
    if (todayHash !== previousHash) {
      // Trimmed content changed - copy to incremental
      fs.copyFileSync(todayFilePath, incrementalFilePath);
      log(`  🔄 Changed venue: ${venueId}`);
      changedVenues++;
    } else {
      // No change in trimmed content
      unchangedVenues++;
    }
  }
  
  // Summary
  log(`\n📊 Delta Summary (Trimmed Content):`);
  log(`   ✨ New venues: ${newVenues}`);
  log(`   🔄 Changed venues: ${changedVenues}`);
  log(`   ⏭️  Unchanged venues: ${unchangedVenues}`);
  log(`   📄 Total files ready for LLM: ${newVenues + changedVenues}`);
  log(`\n✨ Done! Changed files copied to: ${path.resolve(SILVER_TRIMMED_INCREMENTAL_DIR)}`);
  
  // If no changes, log warning
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
    const VENUES_PATH = fs.existsSync(path.join(__dirname, '../data/venues.json'))
      ? path.join(__dirname, '../data/venues.json')
      : path.join(__dirname, '../data/reporting/venues.json');
    
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
