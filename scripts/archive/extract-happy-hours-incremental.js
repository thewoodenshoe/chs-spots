/**
 * Incremental Happy Hour Extraction with Grok API
 * 
 * This script processes only changed/new venues that have explicit
 * "happy hour" text patterns. Designed for daily/weekly runs.
 * 
 * Workflow:
 * 1. Check delta for changed venues
 * 2. Scan for "happy hour" patterns
 * 3. Filter to venues with pattern + content (>100 chars)
 * 4. Call Grok API for extraction
 * 5. Save structured results
 */

const fs = require('fs');
const path = require('path');

// Logging setup
const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logPath = path.join(logDir, 'extract-happy-hours-incremental.log');

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
const VENUES_PATH = path.join(__dirname, '../data/venues.json');

// Happy hour patterns (same as scan script)
const HAPPY_HOUR_PATTERNS = [
  /happy\s+hour/gi,
  /happyhour/gi,
  /happy\s+hours/gi,
  /happyhours/gi,
  /happier\s+hour/gi,
  /happierhour/gi,
  /hh\s*:/gi,
  /happy\s+hour\s*:/gi,
  /happy\s+hour\s*menu/gi,
  /happy\s+hour\s*specials/gi
];

// Grok API configuration
const GROK_API_KEY = process.env.GROK_API_KEY;
const GROK_API_URL = process.env.GROK_API_URL || 'https://api.x.ai/v1/chat/completions';
const GROK_MODEL = process.env.GROK_MODEL || 'grok-beta';

/**
 * Check if text contains happy hour pattern
 */
function hasHappyHourPattern(text) {
  if (!text || typeof text !== 'string') return false;
  for (const pattern of HAPPY_HOUR_PATTERNS) {
    if (pattern.test(text)) return true;
  }
  return false;
}

/**
 * Extract relevant text from scraped data (with context around happy hour mentions)
 */
function extractRelevantText(scrapedData) {
  const allText = (scrapedData.sources || [])
    .map(s => (s.text || '').trim())
    .join('\n\n---\n\n')
    .trim();
  
  // If text is short, return it all
  if (allText.length < 5000) {
    return allText;
  }
  
  // Otherwise, extract sections with happy hour mentions
  const lines = allText.split('\n');
  const relevantLines = [];
  const contextWindow = 15;
  
  for (let i = 0; i < lines.length; i++) {
    if (hasHappyHourPattern(lines[i])) {
      const start = Math.max(0, i - contextWindow);
      const end = Math.min(lines.length, i + contextWindow);
      relevantLines.push(...lines.slice(start, end));
      relevantLines.push('---');
    }
  }
  
  if (relevantLines.length > 0) {
    return relevantLines.join('\n').substring(0, 15000);
  }
  
  return allText.substring(0, 15000);
}

/**
 * Call Grok API to extract happy hour information
 */
async function extractWithGrok(venueName, website, text) {
  if (!GROK_API_KEY) {
    throw new Error('GROK_API_KEY environment variable not set');
  }
  
  const prompt = `Extract happy hour information from the following restaurant/bar website content.

Venue: ${venueName}
Website: ${website}

Extract:
- Days (e.g., "Monday-Friday", "Daily", "Weekdays")
- Times (e.g., "4pm-7pm", "5:00 PM - 7:00 PM")
- Specials/Deals (e.g., "$5 beers", "Half-price appetizers")
- Source URL where the info was found

Return as JSON with this structure:
{
  "found": true/false,
  "days": "Monday-Friday",
  "times": "4pm-7pm",
  "specials": ["$5 beers", "Half-price apps"],
  "source": "${website}"
}

If no happy hour information is found, set "found": false.

Website Content:
${text}`;

  try {
    const response = await fetch(GROK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROK_API_KEY}`
      },
      body: JSON.stringify({
        model: GROK_MODEL,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 1000
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    const content = data.choices[0]?.message?.content || '';
    
    // Try to extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    // If no JSON found, return parsed content
    return {
      found: false,
      error: 'Could not parse JSON from response',
      rawResponse: content
    };
  } catch (error) {
    log(`  ❌ Grok API error: ${error.message}`);
    throw error;
  }
}

/**
 * Main function
 */
async function main() {
  log('🍹 Incremental Happy Hour Extraction (Grok API)\n');
  
  // Check for API key
  if (!GROK_API_KEY) {
    log('❌ Error: GROK_API_KEY environment variable not set');
    log('   Set it with: export GROK_API_KEY=your_key_here');
    process.exit(1);
  }
  
  // Check for delta file (changed venues)
  const today = new Date().toISOString().split('T')[0];
  const changedVenuesPath = path.join(EXTRACTED_DIR, `changed-venues-${today}.json`);
  
  let venueIdsToProcess = [];
  
  if (fs.existsSync(changedVenuesPath)) {
    const changedData = JSON.parse(fs.readFileSync(changedVenuesPath, 'utf8'));
    venueIdsToProcess = changedData.venueIds || [];
    log(`🔄 Delta System: Found ${venueIdsToProcess.length} changed/new venue(s)\n`);
  } else {
    log('⚠️  No delta file found. Processing all scraped venues.\n');
    const scrapedFiles = fs.readdirSync(SCRAPED_DIR).filter(f => f.endsWith('.json'));
    venueIdsToProcess = scrapedFiles.map(f => f.replace('.json', ''));
  }
  
  // Filter to venues with happy hour pattern + content
  const candidates = [];
  
  log('🔍 Scanning for "happy hour" patterns...\n');
  
  for (const venueId of venueIdsToProcess) {
    const scrapedPath = path.join(SCRAPED_DIR, `${venueId}.json`);
    
    if (!fs.existsSync(scrapedPath)) {
      continue;
    }
    
    const scrapedData = JSON.parse(fs.readFileSync(scrapedPath, 'utf8'));
    const totalText = (scrapedData.sources || [])
      .map(s => (s.text || '').trim())
      .join(' ')
      .trim();
    
    const hasContent = totalText.length > 100;
    const hasPattern = hasHappyHourPattern(totalText);
    
    if (hasContent && hasPattern) {
      candidates.push({
        venueId,
        scrapedData,
        text: extractRelevantText(scrapedData)
      });
    }
  }
  
  log(`✅ Found ${candidates.length} venue(s) with pattern + content\n`);
  
  if (candidates.length === 0) {
    log('✨ No venues to process. All done!');
    return;
  }
  
  // Process each candidate with Grok API
  let processed = 0;
  let success = 0;
  let errors = 0;
  
  for (const candidate of candidates) {
    const { venueId, scrapedData, text } = candidate;
    const venueName = scrapedData.venueName || 'Unknown';
    const website = scrapedData.website || 'N/A';
    
    log(`\n[${processed + 1}/${candidates.length}] Processing: ${venueName}`);
    log(`  🌐 ${website}`);
    
    try {
      const extracted = await extractWithGrok(venueName, website, text);
      
      // Save extracted data
      const extractedPath = path.join(EXTRACTED_DIR, `${venueId}.json`);
      const output = {
        venueId,
        venueName,
        venueArea: scrapedData.venueArea || null,
        website,
        dateAdded: today,
        extractedAt: new Date().toISOString(),
        happyHour: {
          found: extracted.found || false,
          days: extracted.days || null,
          times: extracted.times || null,
          specials: extracted.specials || [],
          source: extracted.source || website
        },
        extractedBy: 'grok-api',
        confidence: extracted.found ? 0.9 : 0.1
      };
      
      fs.writeFileSync(extractedPath, JSON.stringify(output, null, 2), 'utf8');
      
      if (extracted.found) {
        log(`  ✅ Happy hour found: ${extracted.times || 'N/A'}`);
        success++;
      } else {
        log(`  ⬜ No happy hour information found`);
      }
      
      processed++;
      
      // Rate limiting - wait 1 second between requests
      if (processed < candidates.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
    } catch (error) {
      log(`  ❌ Error: ${error.message}`);
      errors++;
      processed++;
    }
  }
  
  // Summary
  log(`\n\n📊 Summary:`);
  log(`   ✅ Processed: ${processed} venue(s)`);
  log(`   🍹 Happy hour found: ${success} venue(s)`);
  log(`   ⬜ No happy hour: ${processed - success - errors} venue(s)`);
  log(`   ❌ Errors: ${errors}`);
  log(`\n✨ Done!`);
}

// Run main function
main().catch(error => {
  log(`❌ Fatal error: ${error.message || error}`);
  process.exit(1);
});
