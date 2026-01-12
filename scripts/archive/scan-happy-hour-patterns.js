/**
 * Scan for explicit "happy hour" text patterns in scraped data
 * 
 * This script searches for variations of "happy hour" to determine
 * which venues should be processed with LLM extraction.
 * 
 * Patterns searched:
 * - "happy hour" (with space)
 * - "happyhour" (without space)
 * - "happy hours" (plural)
 * - Case-insensitive
 */

const fs = require('fs');
const path = require('path');

// Logging setup
const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logPath = path.join(logDir, 'scan-happy-hour-patterns.log');

// Overwrite log file on each run
fs.writeFileSync(logPath, '', 'utf8');

function log(message) {
  const ts = new Date().toISOString();
  console.log(message);
  fs.appendFileSync(logPath, `[${ts}] ${message}\n`);
}

// Paths
const SCRAPED_DIR = path.join(__dirname, '../data/scraped');
const EXTRACTED_DIR = path.join(__dirname, '../data/extracted');

// Happy hour pattern variations (case-insensitive)
const HAPPY_HOUR_PATTERNS = [
  /happy\s+hour/gi,           // "happy hour" (with space)
  /happyhour/gi,              // "happyhour" (without space)
  /happy\s+hours/gi,          // "happy hours" (plural with space)
  /happyhours/gi,             // "happyhours" (plural without space)
  /happier\s+hour/gi,         // "happier hour" (variation)
  /happierhour/gi,            // "happierhour"
  /hh\s*:/gi,                 // "HH:" or "HH :" (abbreviation)
  /happy\s+hour\s*:/gi,       // "happy hour:" (with colon)
  /happy\s+hour\s*menu/gi,    // "happy hour menu"
  /happy\s+hour\s*specials/gi // "happy hour specials"
];

/**
 * Check if text contains any happy hour pattern
 */
function hasHappyHourPattern(text) {
  if (!text || typeof text !== 'string') {
    return false;
  }
  
  const textLower = text.toLowerCase();
  
  // Check all patterns
  for (const pattern of HAPPY_HOUR_PATTERNS) {
    if (pattern.test(text)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Count happy hour pattern matches in scraped data
 */
function scanScrapedFiles() {
  log('🔍 Scanning scraped files for "happy hour" patterns...\n');
  
  if (!fs.existsSync(SCRAPED_DIR)) {
    log(`❌ Scraped directory not found: ${SCRAPED_DIR}`);
    process.exit(1);
  }
  
  const scrapedFiles = fs.readdirSync(SCRAPED_DIR).filter(f => f.endsWith('.json'));
  log(`📁 Found ${scrapedFiles.length} scraped file(s)\n`);
  
  const results = {
    total: 0,
    withContent: 0,           // Has >100 chars of text
    withPattern: 0,           // Has happy hour pattern
    withPatternAndContent: 0, // Has both pattern AND >100 chars
    empty: 0,
    patternMatches: []        // Details of matches
  };
  
  for (const filename of scrapedFiles) {
    const filePath = path.join(SCRAPED_DIR, filename);
    const venueId = filename.replace('.json', '');
    
    try {
      const scrapedContent = fs.readFileSync(filePath, 'utf8');
      const scrapedData = JSON.parse(scrapedContent);
      
      results.total++;
      
      // Calculate total text content
      const totalText = (scrapedData.sources || [])
        .map(s => (s.text || '').trim())
        .join(' ')
        .trim();
      
      const textLength = totalText.length;
      const hasContent = textLength > 100;
      const hasPattern = hasHappyHourPattern(totalText);
      
      if (textLength === 0) {
        results.empty++;
      } else if (hasContent) {
        results.withContent++;
      }
      
      if (hasPattern) {
        results.withPattern++;
        
        // Extract a snippet showing the match
        const snippet = extractSnippet(totalText, 200);
        
        if (hasContent) {
          results.withPatternAndContent++;
          results.patternMatches.push({
            venueId: venueId,
            venueName: scrapedData.venueName || 'Unknown',
            venueArea: scrapedData.venueArea || 'Unknown',
            website: scrapedData.website || 'N/A',
            textLength: textLength,
            snippet: snippet,
            sources: (scrapedData.sources || []).length
          });
        }
      }
      
    } catch (error) {
      log(`  ⚠️  Error processing ${filename}: ${error.message}`);
    }
  }
  
  return results;
}

/**
 * Extract a snippet around the first happy hour match
 */
function extractSnippet(text, maxLength = 200) {
  const textLower = text.toLowerCase();
  let matchIndex = -1;
  
  // Find first match position
  for (const pattern of HAPPY_HOUR_PATTERNS) {
    const match = textLower.match(pattern);
    if (match && match.index !== undefined) {
      matchIndex = match.index;
      break;
    }
  }
  
  if (matchIndex === -1) {
    return text.substring(0, maxLength) + '...';
  }
  
  // Extract context around match
  const start = Math.max(0, matchIndex - 50);
  const end = Math.min(text.length, matchIndex + maxLength);
  let snippet = text.substring(start, end);
  
  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';
  
  return snippet;
}

/**
 * Main function
 */
function main() {
  log('🍹 Happy Hour Pattern Scanner\n');
  log('   Searching for explicit "happy hour" text variations\n');
  log('   Patterns: "happy hour", "happyhour", "happy hours", etc.\n');
  
  const results = scanScrapedFiles();
  
  // Summary
  log('\n📊 Scan Results:');
  log(`   📁 Total scraped files: ${results.total}`);
  log(`   📝 With content (>100 chars): ${results.withContent}`);
  log(`   🔍 With happy hour pattern: ${results.withPattern}`);
  log(`   ✅ With pattern AND content (LLM candidates): ${results.withPatternAndContent}`);
  log(`   ⬜ Empty/minimal content: ${results.empty}`);
  
  log(`\n💡 LLM Processing Recommendation:`);
  log(`   Process ${results.withPatternAndContent} venue(s) with LLM`);
  log(`   Skip ${results.total - results.withPatternAndContent} venue(s) (no pattern or no content)`);
  
  // Save detailed results
  const resultsPath = path.join(EXTRACTED_DIR, 'happy-hour-pattern-matches.json');
  fs.writeFileSync(resultsPath, JSON.stringify({
    scanDate: new Date().toISOString(),
    summary: {
      total: results.total,
      withContent: results.withContent,
      withPattern: results.withPattern,
      withPatternAndContent: results.withPatternAndContent,
      empty: results.empty
    },
    matches: results.patternMatches
  }, null, 2), 'utf8');
  
  log(`\n📄 Detailed results saved to: ${path.resolve(resultsPath)}`);
  
  // Show sample matches
  if (results.patternMatches.length > 0) {
    log(`\n📋 Sample Matches (first 5):`);
    results.patternMatches.slice(0, 5).forEach((match, index) => {
      log(`\n   ${index + 1}. ${match.venueName} (${match.venueArea})`);
      log(`      Website: ${match.website}`);
      log(`      Text length: ${match.textLength} chars`);
      log(`      Snippet: ${match.snippet.substring(0, 150)}...`);
    });
  }
  
  log(`\n✨ Scan complete!`);
}

// Run main function
try {
  main();
} catch (error) {
  log(`❌ Fatal error: ${error.message || error}`);
  process.exit(1);
}
