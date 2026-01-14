/**
 * Filter Happy Hour - Step 3 of Happy Hour Pipeline
 * 
 * Filters merged files that contain "happy hour" text.
 * Saves to data/silver_matched/<venue-id>.json
 * 
 * Only venues with "happy hour" text (case-insensitive) are copied.
 * Files remain completely untouched - just copied if they match.
 * 
 * Run with: node scripts/filter-happy-hour.js [area-filter]
 * 
 * If area-filter is provided, only processes venues from that area.
 */

const fs = require('fs');
const path = require('path');

// Logging setup
const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logPath = path.join(logDir, 'filter-happy-hour.log');

fs.writeFileSync(logPath, '', 'utf8');

function log(message) {
  const ts = new Date().toISOString();
  console.log(message);
  fs.appendFileSync(logPath, `[${ts}] ${message}\n`);
}

// Paths
const SILVER_MERGED_DIR = path.join(__dirname, '../data/silver_merged');
const SILVER_MATCHED_DIR = path.join(__dirname, '../data/silver_matched');

// Ensure matched directory exists
if (!fs.existsSync(SILVER_MATCHED_DIR)) {
  fs.mkdirSync(SILVER_MATCHED_DIR, { recursive: true });
}

/**
 * Check if HTML contains "happy hour" text
 */
function containsHappyHour(html) {
  if (!html || typeof html !== 'string') {
    return false;
  }
  
  const textLower = html.toLowerCase();
  
  // Patterns to match
  const patterns = [
    'happy hour',
    'happyhour',
    'happy hours',
    'happyhours',
    'happier hour',
    'hh ',
    ' hh:',
    'happy hour:',
    'happy hour menu',
    'happy hour specials'
  ];
  
  return patterns.some(pattern => textLower.includes(pattern));
}

/**
 * Process a single merged file
 */
function processFile(file) {
  const filePath = path.join(SILVER_MERGED_DIR, file);
  
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    // Check all pages for "happy hour" text
    let hasHappyHour = false;
    for (const page of data.pages || []) {
      if (containsHappyHour(page.html)) {
        hasHappyHour = true;
        break;
      }
    }
    
    if (hasHappyHour) {
      // Copy file to matched directory
      const matchedPath = path.join(SILVER_MATCHED_DIR, file);
      fs.writeFileSync(matchedPath, JSON.stringify(data, null, 2), 'utf8');
      return {
        venueId: data.venueId,
        venueName: data.venueName,
        matched: true
      };
    } else {
      return {
        venueId: data.venueId,
        venueName: data.venueName,
        matched: false
      };
    }
  } catch (error) {
    log(`  ❌ Error processing ${file}: ${error.message}`);
    return {
      file,
      error: error.message
    };
  }
}

/**
 * Main function
 */
function main() {
  log('🔍 Starting Happy Hour Filter\n');
  
  // Parse command-line arguments
  const args = process.argv.slice(2);
  let areaFilter = null;
  
  if (args.length > 0) {
    areaFilter = args[0];
    log(`📍 Filtering by area: ${areaFilter}\n`);
  }
  
  // Check merged directory
  if (!fs.existsSync(SILVER_MERGED_DIR)) {
    log(`❌ Merged directory not found: ${SILVER_MERGED_DIR}`);
    log(`   Run merge-raw-files.js first`);
    process.exit(1);
  }
  
  // Load venues for area filtering
  let venues = [];
  if (areaFilter) {
    try {
      if (fs.existsSync(VENUES_PATH)) {
        venues = JSON.parse(fs.readFileSync(VENUES_PATH, 'utf8'));
      }
    } catch (e) {
      log(`  ⚠️  Could not load venues.json for area filtering`);
    }
  }
  
  // Get all merged files
  let files = fs.readdirSync(SILVER_MERGED_DIR).filter(f => f.endsWith('.json'));
  
  // Filter by area if specified
  if (areaFilter && venues.length > 0) {
    const areaVenueIds = new Set(
      venues
        .filter(v => 
          (v.area && v.area.toLowerCase() === areaFilter.toLowerCase()) ||
          (v.addressComponents && v.addressComponents.some(ac => 
            ac.types.includes('sublocality') && ac.long_name.toLowerCase() === areaFilter.toLowerCase()
          ))
        )
        .map(v => v.id || v.place_id)
    );
    files = files.filter(file => {
      const venueId = file.replace('.json', '');
      return areaVenueIds.has(venueId);
    });
    log(`📍 Filtered to ${files.length} merged file(s) in ${areaFilter}\n`);
  } else {
    log(`📁 Found ${files.length} merged file(s)\n`);
  }
  
  // Process each file
  const results = [];
  for (const file of files) {
    const result = processFile(file);
    results.push(result);
    
    if (result.matched) {
      log(`  ✅ Matched: ${result.venueName} (${result.venueId})`);
    }
  }
  
  // Summary
  const matched = results.filter(r => r.matched).length;
  const notMatched = results.filter(r => r.matched === false).length;
  const errors = results.filter(r => r.error).length;
  
  log(`\n📊 Summary:`);
  log(`   ✅ Matched (contains "happy hour"): ${matched}`);
  log(`   ⬜ Not matched: ${notMatched}`);
  log(`   ❌ Errors: ${errors}`);
  log(`\n✨ Done! Matched files saved to: ${path.resolve(SILVER_MATCHED_DIR)}`);
  log(`   Next step: Extract structured data from matched files`);
}

try {
  main();
} catch (error) {
  log(`❌ Fatal error: ${error.message || error}`);
  console.error(error);
  process.exit(1);
}
