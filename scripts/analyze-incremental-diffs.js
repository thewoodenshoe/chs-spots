/**
 * Analyze incremental files to determine true changes vs false positives
 * Compares each file in silver_trimmed/incremental with silver_trimmed/previous
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const INCREMENTAL_DIR = path.join(__dirname, '..', 'data', 'silver_trimmed', 'incremental');
const PREVIOUS_DIR = path.join(__dirname, '..', 'data', 'silver_trimmed', 'previous');

/**
 * Normalize text (same logic as delta-trimmed-files.js)
 */
function normalizeTextForHash(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }
  
  let normalized = text;
  
  // Remove ISO timestamps (e.g., "2026-01-20T15:34:58.724Z" or "2026-01-20")
  normalized = normalized.replace(/\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?)?/g, '');
  
  // Remove day-of-week + month-day patterns (e.g., "Wednesday January 28th", "Thursday January 29th")
  normalized = normalized.replace(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(st|nd|rd|th)?(,\s+\d{4})?\b/gi, '');
  
  // Remove common month-day patterns (e.g., "Jan 20", "Jan 20, 2026", "January 20, 2026", "January 28th")
  normalized = normalized.replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(st|nd|rd|th)?(,\s+\d{4})?\b/gi, '');
  
  // Remove "Loading..." or placeholder phrases
  normalized = normalized.replace(/Loading\s+product\s+options\.\.\.|Loading\.\.\./gi, '');
  
  // Remove Google Analytics / GTM IDs
  normalized = normalized.replace(/gtm-[a-z0-9]+/gi, '');
  normalized = normalized.replace(/UA-\d+-\d+/g, '');
  normalized = normalized.replace(/G-[A-Z0-9]+/g, '');
  
  // Remove common tracking parameters in URLs
  normalized = normalized.replace(/[?&](sid|fbclid|utm_[^=\s&]+|gclid|_ga|_gid|ref|source|tracking|campaign)=[^\s&"']+/gi, '');
  
  // Remove dynamic footers
  normalized = normalized.replace(/Copyright\s+©\s+\d{4}/gi, '');
  normalized = normalized.replace(/All\s+rights\s+reserved/gi, '');
  normalized = normalized.replace(/Powered\s+by\s+[^\s]+/gi, '');
  normalized = normalized.replace(/©\s+\d{4}\s+[^\n]+/gi, '');
  
  // Remove session IDs and tracking tokens
  normalized = normalized.replace(/\b(session|sid|token|tracking)[-_]?[a-z0-9]{8,}\b/gi, '');
  
  // More aggressive whitespace/newline collapse
  normalized = normalized.replace(/[\s\n\r\t]+/g, ' ').trim();
  
  return normalized;
}

/**
 * Get normalized content hash from JSON file
 */
function getNormalizedHash(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const pages = data.pages || [];
    const pagesContent = pages.map(p => {
      const text = p.text || '';
      return normalizeTextForHash(text);
    }).join('\n');
    
    return crypto.createHash('md5').update(pagesContent).digest('hex');
  } catch (error) {
    return null;
  }
}

/**
 * Extract date strings from text
 */
function extractDateStrings(text) {
  const dates = [];
  
  // Day-of-week + month-day patterns
  const dayMonthPattern = /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(st|nd|rd|th)?/gi;
  let match;
  while ((match = dayMonthPattern.exec(text)) !== null) {
    dates.push(match[0]);
  }
  
  // Month-day patterns
  const monthDayPattern = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(st|nd|rd|th)?/gi;
  while ((match = monthDayPattern.exec(text)) !== null) {
    dates.push(match[0]);
  }
  
  return [...new Set(dates)]; // Remove duplicates
}

/**
 * Analyze a single file
 */
function analyzeFile(filename) {
  const incrementalPath = path.join(INCREMENTAL_DIR, filename);
  const previousPath = path.join(PREVIOUS_DIR, filename);
  
  if (!fs.existsSync(incrementalPath)) {
    return { type: 'error', message: `Incremental file not found: ${filename}` };
  }
  
  if (!fs.existsSync(previousPath)) {
    return { type: 'new', filename, message: 'New file (no previous version)' };
  }
  
  try {
    const incrementalData = JSON.parse(fs.readFileSync(incrementalPath, 'utf8'));
    const previousData = JSON.parse(fs.readFileSync(previousPath, 'utf8'));
    
    // Get normalized hashes
    const incrementalHash = getNormalizedHash(incrementalPath);
    const previousHash = getNormalizedHash(previousPath);
    
    // Check if hashes match (after normalization)
    if (incrementalHash === previousHash) {
      return { type: 'false_positive', filename, reason: 'Normalized content identical' };
    }
    
    // Extract all text content
    const incrementalText = (incrementalData.pages || []).map(p => p.text || '').join('\n');
    const previousText = (previousData.pages || []).map(p => p.text || '').join('\n');
    
    // Extract date strings
    const incrementalDates = extractDateStrings(incrementalText);
    const previousDates = extractDateStrings(previousText);
    
    // Check if only dates differ
    const incrementalTextNoDates = incrementalDates.reduce((text, date) => text.replace(date, ''), incrementalText);
    const previousTextNoDates = previousDates.reduce((text, date) => text.replace(date, ''), previousText);
    
    const incrementalHashNoDates = crypto.createHash('md5').update(normalizeTextForHash(incrementalTextNoDates)).digest('hex');
    const previousHashNoDates = crypto.createHash('md5').update(normalizeTextForHash(previousTextNoDates)).digest('hex');
    
    if (incrementalHashNoDates === previousHashNoDates) {
      return {
        type: 'false_positive',
        filename,
        reason: 'Only date strings differ',
        incrementalDates,
        previousDates
      };
    }
    
    // Check metadata differences
    const metadataDiff = {
      scrapedAt: incrementalData.scrapedAt !== previousData.scrapedAt,
      trimmedAt: incrementalData.trimmedAt !== previousData.trimmedAt,
      downloadedAt: (incrementalData.pages || []).some((p, i) => {
        const prevPage = (previousData.pages || [])[i];
        return prevPage && p.downloadedAt !== prevPage.downloadedAt;
      })
    };
    
    // True change
    return {
      type: 'true_change',
      filename,
      incrementalHash: incrementalHash.substring(0, 8),
      previousHash: previousHash.substring(0, 8),
      incrementalDates: incrementalDates.length > 0 ? incrementalDates : null,
      previousDates: previousDates.length > 0 ? previousDates : null,
      metadataDiff
    };
  } catch (error) {
    return { type: 'error', filename, message: error.message };
  }
}

/**
 * Main analysis
 */
function main() {
  console.log('🔍 Analyzing incremental files...\n');
  
  if (!fs.existsSync(INCREMENTAL_DIR)) {
    console.error(`❌ Incremental directory not found: ${INCREMENTAL_DIR}`);
    process.exit(1);
  }
  
  const files = fs.readdirSync(INCREMENTAL_DIR)
    .filter(f => f.endsWith('.json'));
  
  console.log(`📊 Found ${files.length} incremental file(s)\n`);
  
  const results = {
    new: [],
    true_change: [],
    false_positive: [],
    error: []
  };
  
  // Analyze each file
  for (const file of files) {
    const result = analyzeFile(file);
    results[result.type].push(result);
  }
  
  // Print summary
  console.log('📋 Summary:');
  console.log(`   ✅ True changes: ${results.true_change.length}`);
  console.log(`   ❌ False positives: ${results.false_positive.length}`);
  console.log(`   🆕 New files: ${results.new.length}`);
  console.log(`   ⚠️  Errors: ${results.error.length}`);
  console.log(`   📊 Total: ${files.length}\n`);
  
  // Show false positive reasons
  if (results.false_positive.length > 0) {
    console.log('❌ False Positives Breakdown:');
    const reasons = {};
    results.false_positive.forEach(fp => {
      const reason = fp.reason || 'Unknown';
      reasons[reason] = (reasons[reason] || 0) + 1;
    });
    Object.entries(reasons).forEach(([reason, count]) => {
      console.log(`   ${reason}: ${count}`);
    });
    console.log('');
    
    // Show examples of date-only differences
    const dateOnlyDiffs = results.false_positive.filter(fp => fp.reason === 'Only date strings differ');
    if (dateOnlyDiffs.length > 0) {
      console.log('📅 Examples of date-only false positives (first 5):');
      dateOnlyDiffs.slice(0, 5).forEach(fp => {
        console.log(`   ${fp.filename}:`);
        if (fp.incrementalDates && fp.incrementalDates.length > 0) {
          console.log(`     Today: ${fp.incrementalDates.join(', ')}`);
        }
        if (fp.previousDates && fp.previousDates.length > 0) {
          console.log(`     Previous: ${fp.previousDates.join(', ')}`);
        }
      });
      console.log('');
    }
  }
  
  // Show sample true changes
  if (results.true_change.length > 0) {
    console.log('✅ Sample True Changes (first 5):');
    results.true_change.slice(0, 5).forEach(tc => {
      console.log(`   ${tc.filename}:`);
      console.log(`     Hash: ${tc.previousHash} → ${tc.incrementalHash}`);
      if (tc.incrementalDates && tc.incrementalDates.length > 0) {
        console.log(`     Dates in new: ${tc.incrementalDates.join(', ')}`);
      }
      if (tc.previousDates && tc.previousDates.length > 0) {
        console.log(`     Dates in old: ${tc.previousDates.join(', ')}`);
      }
    });
    console.log('');
  }
  
  // Write detailed report
  const reportPath = path.join(__dirname, '..', 'logs', 'incremental-analysis-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`📄 Detailed report written to: ${reportPath}`);
}

main();
