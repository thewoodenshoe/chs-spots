/**
 * Extract Happy Hours - Extraction Script
 * 
 * This script reads raw scraped data from data/scraped/<venue-id>.json
 * and extracts structured happy hour information to update spots.json
 * 
 * Features:
 * - Parses raw text snippets to extract structured info (days, times, specials)
 * - Creates clean spot entries with concise descriptions
 * - Updates spots.json with extracted data
 * 
 * Run with: node scripts/extract-happy-hours.js
 */

const fs = require('fs');
const path = require('path');

// Logging setup
const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logPath = path.join(logDir, 'extract-happy-hours.log');

// Overwrite log file on each run
fs.writeFileSync(logPath, '', 'utf8');

/**
 * Logger function: logs to console and file with ISO timestamp
 */
function log(message) {
  const ts = new Date().toISOString();
  console.log(message);
  fs.appendFileSync(logPath, `[${ts}] ${message}\n`);
}

/**
 * Verbose logger: writes detailed information to log file only
 */
function logVerbose(message) {
  const ts = new Date().toISOString();
  fs.appendFileSync(logPath, `[${ts}] ${message}\n`);
}

// Paths
const SCRAPED_DIR = path.join(__dirname, '../data/scraped');
const SPOTS_PATH = path.join(__dirname, '../data/spots.json');
const VENUES_PATH = path.join(__dirname, '../data/venues.json');

/**
 * Extract structured happy hour information from raw text snippets
 * Returns structured object with days, times, specials
 */
function extractStructuredHappyHour(rawMatches) {
  // TODO: Implement intelligent extraction logic
  // For now, return raw matches as structured data
  // This will be enhanced to parse "happy hour 4-7" from longer text
  
  if (!rawMatches || rawMatches.length === 0) {
    return null;
  }
  
  // Placeholder: return first match as structured
  // Future: parse days, times, specials from text
  return {
    days: null, // Will extract: ["Monday", "Friday"]
    times: null, // Will extract: "4pm-7pm"
    specials: null, // Will extract: "All drinks half price"
    rawText: rawMatches[0].text,
    source: rawMatches[0].source
  };
}

/**
 * Format clean description from structured happy hour data
 */
function formatCleanDescription(structuredData) {
  if (!structuredData) {
    return null;
  }
  
  // TODO: Format based on structured data
  // For now, return raw text
  return structuredData.rawText;
}

/**
 * Main function
 */
async function main() {
  log('🍹 Starting Happy Hour Extraction Agent...\n');
  log('   This script extracts structured data from scraped content\n');
  
  // Ensure scraped directory exists
  if (!fs.existsSync(SCRAPED_DIR)) {
    log(`❌ Error: Scraped directory not found: ${path.resolve(SCRAPED_DIR)}`);
    log(`   Run update-happy-hours.js first to scrape venue websites`);
    process.exit(1);
  }
  
  // Load venues for metadata (lat/lng, name)
  let venues = [];
  try {
    const venuesContent = fs.readFileSync(VENUES_PATH, 'utf8');
    venues = JSON.parse(venuesContent);
    log(`📖 Loaded ${venues.length} venues from ${path.resolve(VENUES_PATH)}`);
  } catch (error) {
    log(`⚠️  Warning: Could not load venues.json: ${error.message}`);
    log(`   Will use data from scraped files only\n`);
  }
  
  // Create venue lookup map
  const venuesMap = new Map();
  venues.forEach(v => {
    if (v.id) {
      venuesMap.set(v.id, v);
    }
  });
  
  // Load existing spots or create empty array
  let spots = [];
  if (fs.existsSync(SPOTS_PATH)) {
    try {
      const spotsContent = fs.readFileSync(SPOTS_PATH, 'utf8');
      spots = JSON.parse(spotsContent);
      log(`📖 Loaded ${spots.length} existing spots`);
    } catch (error) {
      log(`⚠️  Warning: Could not load spots.json: ${error.message}`);
      log(`   Will create new spots file\n`);
    }
  }
  
  // Find all scraped files
  const scrapedFiles = fs.readdirSync(SCRAPED_DIR).filter(f => f.endsWith('.json'));
  log(`📁 Found ${scrapedFiles.length} scraped file(s) in ${path.resolve(SCRAPED_DIR)}\n`);
  
  if (scrapedFiles.length === 0) {
    log(`❌ No scraped files found. Run update-happy-hours.js first.`);
    process.exit(1);
  }
  
  let processed = 0;
  let extracted = 0;
  let updated = 0;
  let created = 0;
  
  for (const filename of scrapedFiles) {
    const filePath = path.join(SCRAPED_DIR, filename);
    const venueId = filename.replace('.json', '');
    
    try {
      const scrapedContent = fs.readFileSync(filePath, 'utf8');
      const scrapedData = JSON.parse(scrapedContent);
      
      // Get venue metadata
      const venue = venuesMap.get(venueId) || {
        id: venueId,
        name: scrapedData.venueName || 'Unknown',
        lat: null,
        lng: null
      };
      
      log(`\n[${processed + 1}/${scrapedFiles.length}] Processing: ${venue.name}`);
      logVerbose(`  Venue ID: ${venueId}`);
      logVerbose(`  Scraped at: ${scrapedData.scrapedAt || 'N/A'}`);
      logVerbose(`  Sources: ${scrapedData.sources?.length || 0}`);
      logVerbose(`  Raw matches: ${scrapedData.rawMatches?.length || 0}`);
      
      // Extract structured happy hour info
      if (scrapedData.rawMatches && scrapedData.rawMatches.length > 0) {
        const structured = extractStructuredHappyHour(scrapedData.rawMatches);
        const description = formatCleanDescription(structured);
        
        if (description) {
          // Find existing spot or create new one
          let spotIndex = spots.findIndex(s => s.title === venue.name);
          
          if (spotIndex === -1) {
            // Create new spot
            spots.push({
              title: venue.name,
              lat: venue.lat || scrapedData.lat || null,
              lng: venue.lng || scrapedData.lng || null,
              description: description,
              activity: 'Happy Hour'
            });
            created++;
            log(`  ✨ Created new spot`);
          } else {
            // Update existing spot
            const existing = spots[spotIndex];
            if (existing.description !== description) {
              spots[spotIndex].description = description;
              spots[spotIndex].activity = 'Happy Hour';
              // Update lat/lng if not set
              if (!spots[spotIndex].lat && venue.lat) spots[spotIndex].lat = venue.lat;
              if (!spots[spotIndex].lng && venue.lng) spots[spotIndex].lng = venue.lng;
              updated++;
              log(`  🔄 Updated existing spot`);
            } else {
              log(`  ⏭️  No changes needed`);
            }
          }
          
          extracted++;
        }
      } else {
        log(`  ⬜ No happy hour matches found in scraped data`);
      }
      
      processed++;
    } catch (error) {
      log(`  ❌ Error processing ${filename}: ${error.message}`);
      logVerbose(`  Error details: ${error.stack}`);
    }
  }
  
  // Save spots
  log(`\n\n💾 Saving ${spots.length} spots to ${path.resolve(SPOTS_PATH)}...`);
  fs.writeFileSync(SPOTS_PATH, JSON.stringify(spots, null, 2), 'utf8');
  log(`✅ Spots saved`);
  
  // Summary
  log(`\n📊 Summary:`);
  log(`   ✅ Processed: ${processed} scraped files`);
  log(`   🍹 Extracted happy hour info: ${extracted} venues`);
  log(`   ✨ Created new spots: ${created}`);
  log(`   🔄 Updated existing spots: ${updated}`);
  log(`   📄 Total spots in file: ${spots.length}`);
  
  log(`\n✨ Done!`);
  log(`Done! Log saved to ${logPath}`);
}

// Run main function
main().catch(error => {
  log(`❌ Fatal error: ${error.message || error}`);
  process.exit(1);
});
