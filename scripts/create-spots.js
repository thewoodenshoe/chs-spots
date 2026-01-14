/**
 * Create Spots from Gold Extracted Data
 * 
 * Reads gold/<venue-id>.json files and venues.json to create spots.json entries.
 * Only creates spots for venues with happyHour.found === true.
 * 
 * Input:
 * - data/gold/<venue-id>.json (extracted happy hour data)
 * - data/venues.json (venue coordinates and metadata)
 * 
 * Output:
 * - data/spots.json (spots array for frontend)
 * 
 * Run with: node scripts/create-spots.js
 */

const fs = require('fs');
const path = require('path');

// Logging setup
const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logPath = path.join(logDir, 'create-spots.log');

fs.writeFileSync(logPath, '', 'utf8');

function log(message) {
  const ts = new Date().toISOString();
  console.log(message);
  fs.appendFileSync(logPath, `[${ts}] ${message}\n`);
}

// Paths
const GOLD_DIR = path.join(__dirname, '../data/gold');
const VENUES_PATH = path.join(__dirname, '../data/venues.json');
const SPOTS_PATH = path.join(__dirname, '../data/spots.json');

/**
 * Format happy hour description from gold data
 * Creates a structured description with proper formatting for display
 */
function formatHappyHourDescription(happyHour) {
  const lines = [];
  
  // Time and days together on first line
  if (happyHour.times || happyHour.days) {
    const timeDayParts = [];
    if (happyHour.times) {
      timeDayParts.push(happyHour.times);
    }
    if (happyHour.days) {
      timeDayParts.push(happyHour.days);
    }
    if (timeDayParts.length > 0) {
      lines.push(timeDayParts.join(' • '));
    }
  }
  
  // Specials as separate lines (one per special)
  if (happyHour.specials && happyHour.specials.length > 0) {
    for (const special of happyHour.specials) {
      if (special && special.trim()) {
        lines.push(special.trim());
      }
    }
  }
  
  // If no content but has source, add placeholder
  if (lines.length === 0 && happyHour.source) {
    lines.push('Happy Hour details available');
  }
  
  // Join with newlines (will be preserved in display)
  return lines.length > 0 ? lines.join('\n') : 'Happy Hour available';
}

/**
 * Create spot from gold data and venue data
 */
function createSpot(goldData, venueData, spotId) {
  const happyHour = goldData.happyHour || {};
  
  // Only create spots for venues with happy hour found
  if (!happyHour.found) {
    return null;
  }
  
  const spot = {
    id: spotId,
    lat: venueData.lat || venueData.geometry?.location?.lat,
    lng: venueData.lng || venueData.geometry?.location?.lng,
    title: goldData.venueName || venueData.name || 'Unknown Venue',
    description: formatHappyHourDescription(happyHour),
    type: 'Happy Hour',
  };
  
  // Add photoUrl if available from venue
  if (venueData.photoUrl) {
    spot.photoUrl = venueData.photoUrl;
  } else if (venueData.photos && venueData.photos.length > 0) {
    // Use first photo from Google Places
    spot.photoUrl = venueData.photos[0].photo_reference;
  }
  
  return spot;
}

/**
 * Main function
 */
function main() {
  log('🔄 Creating Spots from Gold Data\n');
  
  // Check if gold directory exists
  if (!fs.existsSync(GOLD_DIR)) {
    log(`❌ Gold directory not found: ${GOLD_DIR}`);
    log(`   Run process-bulk-llm-results.js first`);
    process.exit(1);
  }
  
  // Check if venues.json exists
  if (!fs.existsSync(VENUES_PATH)) {
    log(`❌ Venues file not found: ${VENUES_PATH}`);
    log(`   Run seed-venues.js first`);
    process.exit(1);
  }
  
  // Load venues
  let venues;
  try {
    const venuesContent = fs.readFileSync(VENUES_PATH, 'utf8');
    venues = JSON.parse(venuesContent);
    
    if (!Array.isArray(venues)) {
      log('❌ venues.json does not contain an array');
      process.exit(1);
    }
  } catch (error) {
    log(`❌ Error reading venues.json: ${error.message}`);
    process.exit(1);
  }
  
  // Create venue lookup by id
  const venueMap = new Map();
  for (const venue of venues) {
    const venueId = venue.id || venue.place_id;
    if (venueId) {
      venueMap.set(venueId, venue);
    }
  }
  
  log(`📁 Loaded ${venues.length} venue(s) from venues.json\n`);
  
  // Get all gold files
  const goldFiles = fs.readdirSync(GOLD_DIR)
    .filter(f => f.endsWith('.json') && f !== 'bulk-results.json' && f !== '.bulk-complete')
    .map(f => path.join(GOLD_DIR, f));
  
  log(`📁 Found ${goldFiles.length} gold file(s)\n`);
  
  if (goldFiles.length === 0) {
    log('⚠️  No gold files found. Creating empty spots.json');
    fs.writeFileSync(SPOTS_PATH, JSON.stringify([], null, 2), 'utf8');
    log('\n✨ Done! Created empty spots.json');
    return;
  }
  
  // Process gold files and create spots
  const spots = [];
  let processed = 0;
  let skipped = 0;
  let missingVenue = 0;
  let noHappyHour = 0;
  
  for (const goldPath of goldFiles) {
    try {
      const goldContent = fs.readFileSync(goldPath, 'utf8');
      const goldData = JSON.parse(goldContent);
      
      const venueId = goldData.venueId;
      if (!venueId) {
        skipped++;
        log(`  ⚠️  Skipping: Missing venueId in ${path.basename(goldPath)}`);
        continue;
      }
      
      const venueData = venueMap.get(venueId);
      if (!venueData) {
        missingVenue++;
        log(`  ⚠️  Skipping: Venue not found in venues.json: ${venueId}`);
        continue;
      }
      
      // Only create spots for venues with happy hour
      if (!goldData.happyHour || !goldData.happyHour.found) {
        noHappyHour++;
        continue;
      }
      
      const spot = createSpot(goldData, venueData, spots.length + 1);
      
      if (spot) {
        // Validate spot has required fields
        if (!spot.lat || !spot.lng) {
          log(`  ⚠️  Skipping: Missing coordinates for ${goldData.venueName} (${venueId})`);
          skipped++;
          continue;
        }
        
        spots.push(spot);
        processed++;
        log(`  ✅ Created spot: ${spot.title} (${spot.id})`);
      }
      
    } catch (error) {
      log(`  ❌ Error processing ${path.basename(goldPath)}: ${error.message}`);
      skipped++;
    }
  }
  
  // Write spots.json
  fs.writeFileSync(SPOTS_PATH, JSON.stringify(spots, null, 2), 'utf8');
  
  // Summary
  log(`\n📊 Summary:`);
  log(`   ✅ Spots created: ${processed}`);
  log(`   ⚠️  Skipped: ${skipped}`);
  log(`   ❌ Missing venue data: ${missingVenue}`);
  log(`   ℹ️  No happy hour: ${noHappyHour}`);
  log(`   📄 Total spots in spots.json: ${spots.length}`);
  log(`\n✨ Done! Created spots.json with ${spots.length} spot(s)`);
}

try {
  main();
} catch (error) {
  log(`❌ Fatal error: ${error.message || error}`);
  console.error(error);
  process.exit(1);
}
