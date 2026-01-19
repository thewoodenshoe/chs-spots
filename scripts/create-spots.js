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
// Check both locations for venues.json
const VENUES_PATH = fs.existsSync(path.join(__dirname, '../data/venues.json')) 
  ? path.join(__dirname, '../data/venues.json')
  : path.join(__dirname, '../data/reporting/venues.json');
const AREAS_PATH = path.join(__dirname, '../data/config/areas.json');
const REPORTING_DIR = path.join(__dirname, '../data/reporting');
const SPOTS_PATH = path.join(REPORTING_DIR, 'spots.json');
const REPORTING_VENUES_PATH = path.join(REPORTING_DIR, 'venues.json');
const REPORTING_AREAS_PATH = path.join(REPORTING_DIR, 'areas.json');

/**
 * Format happy hour description from gold data
 * Creates a structured description with proper formatting for display
 */
function formatHappyHourDescription(happyHour) {
  const lines = [];
  
  // Time and days together on first line
  if (happyHour.times || happyHour.days) {
    const timeDayParts = [];
    if (happyHour.times && happyHour.times.trim()) {
      timeDayParts.push(happyHour.times.trim());
    }
    if (happyHour.days && happyHour.days.trim()) {
      timeDayParts.push(happyHour.days.trim());
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
  
  // If we only have a time with no days or specials, it's incomplete data
  // Don't create a meaningless description like "2pm"
  if (lines.length === 1 && happyHour.times && !happyHour.days && 
      (!happyHour.specials || happyHour.specials.length === 0)) {
    // This is incomplete - return null to indicate we shouldn't create a spot
    return null;
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
 * Handles both new format (entries array) and old format (direct properties)
 */
function createSpot(goldData, venueData, spotId) {
  const happyHour = goldData.happyHour || {};
  
  // Only create spots for venues with happy hour found
  if (!happyHour.found) {
    return null;
  }
  
  // Handle new format with entries array, or old format with direct properties
  let entries = [];
  if (happyHour.entries && Array.isArray(happyHour.entries) && happyHour.entries.length > 0) {
    // New format: entries array
    entries = happyHour.entries;
  } else if (happyHour.times || happyHour.days || happyHour.specials) {
    // Old format: direct properties - convert to entries format
    entries = [{
      times: happyHour.times,
      days: happyHour.days,
      specials: happyHour.specials || [],
      source: happyHour.source
    }];
  } else {
    // No valid happy hour data
    return null;
  }
  
  // Extract fields from first entry (or combine multiple entries)
  // New structured format: separate fields instead of combined description
  let happyHourTime = null;
  let happyHourList = [];
  let sourceUrl = null;
  
  if (entries.length === 1) {
    const entry = entries[0];
    // Time: combine days and times if available
    if (entry.times) {
      happyHourTime = entry.days ? `${entry.times} • ${entry.days}` : entry.times;
    } else if (entry.days) {
      happyHourTime = entry.days;
    }
    // Happy Hour List: specials array
    happyHourList = entry.specials || [];
    // Source URL
    sourceUrl = entry.source || null;
  } else if (entries.length > 1) {
    // Multiple entries - combine times/days, collect all specials
    const timeParts = [];
    const allSpecials = [];
    const sources = [];
    
    for (const entry of entries) {
      if (entry.times) {
        const timeStr = entry.days ? `${entry.times} • ${entry.days}` : entry.times;
        if (!timeParts.includes(timeStr)) {
          timeParts.push(timeStr);
        }
      }
      if (entry.specials && Array.isArray(entry.specials)) {
        allSpecials.push(...entry.specials);
      }
      if (entry.source && !sources.includes(entry.source)) {
        sources.push(entry.source);
      }
    }
    
    happyHourTime = timeParts.length > 0 ? timeParts.join(', ') : null;
    happyHourList = allSpecials;
    sourceUrl = sources.length > 0 ? sources[0] : null; // Use first source
  }
  
  // Need at least time or specials to create a spot
  if (!happyHourTime && (!happyHourList || happyHourList.length === 0)) {
    return null;
  }
  
  // Format description for backwards compatibility (keep for now)
  let description = null;
  if (entries.length === 1) {
    description = formatHappyHourDescription(entries[0]);
  } else if (entries.length > 1) {
    const entryDescriptions = entries
      .map(entry => formatHappyHourDescription(entry))
      .filter(desc => desc !== null);
    if (entryDescriptions.length > 0) {
      description = entryDescriptions.join('\n\n---\n\n');
    }
  }
  
  const spot = {
    id: spotId,
    lat: venueData.lat || venueData.geometry?.location?.lat,
    lng: venueData.lng || venueData.geometry?.location?.lng,
    title: goldData.venueName || venueData.name || 'Unknown Venue',
    description: description, // Keep for backwards compatibility
    // New structured fields
    happyHourTime: happyHourTime,
    happyHourList: happyHourList,
    sourceUrl: sourceUrl,
    lastUpdateDate: goldData.processedAt || null,
    type: 'Happy Hour',
    source: 'automated' // Mark as automated (vs manual)
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
    log(`   Run extract-happy-hours.js first`);
    process.exit(1);
  }
  
  // Check if venues.json exists
  if (!fs.existsSync(VENUES_PATH)) {
    log(`❌ Venues file not found: ${VENUES_PATH}`);
    log(`   Run seed-venues.js first`);
    process.exit(1);
  }
  
  // Check if areas.json exists
  if (!fs.existsSync(AREAS_PATH)) {
    log(`❌ Areas file not found: ${AREAS_PATH}`);
    log(`   Run create-areas.js first`);
    process.exit(1);
  }
  
  // Ensure reporting directory exists
  if (!fs.existsSync(REPORTING_DIR)) {
    fs.mkdirSync(REPORTING_DIR, { recursive: true });
    log(`📁 Created reporting directory: ${REPORTING_DIR}\n`);
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
  
  // Load existing spots.json to preserve manual spots only (automated spots will be regenerated)
  let existingSpots = [];
  let manualSpotsCount = 0;
  if (fs.existsSync(SPOTS_PATH)) {
    try {
      const existingContent = fs.readFileSync(SPOTS_PATH, 'utf8');
      existingSpots = JSON.parse(existingContent);
      if (!Array.isArray(existingSpots)) {
        existingSpots = [];
      }
      // Only preserve manual spots - automated spots will be regenerated with new labeled fields
      manualSpotsCount = existingSpots.filter(s => s.source === 'manual').length;
      if (manualSpotsCount > 0) {
        log(`📋 Found ${manualSpotsCount} manual spot(s) - will be preserved\n`);
      }
    } catch (error) {
      log(`  ⚠️  Error reading existing spots.json: ${error.message}`);
      existingSpots = [];
    }
  }
  
  // Extract manual spots (should never be removed)
  const manualSpots = existingSpots.filter(s => s.source === 'manual');
  
  // Process gold files and create spots
  // Start with manual spots only - automated spots will be regenerated from gold
  const spots = [...manualSpots]; // Start with manual spots only
  let processed = 0;
  let skipped = 0;
  let missingVenue = 0;
  let noHappyHour = 0;
  let incompleteData = 0;
  
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
      
      // Check if this venue already has a spot in the spots array we're building
      // Match by venueId or lat/lng/title to prevent duplicates within this run
      const hasExistingSpot = spots.some(s => {
        if (s.source !== 'automated') return false;
        // If spot has venueId, match by that
        if (s.venueId === venueId) return true;
        // Otherwise match by lat/lng/title
        const venueLat = venueData.lat || venueData.geometry?.location?.lat;
        const venueLng = venueData.lng || venueData.geometry?.location?.lng;
        const venueName = goldData.venueName || venueData.name;
        return s.lat === venueLat && s.lng === venueLng && s.title === venueName;
      });
      
      if (hasExistingSpot) {
        // Spot already added in this run - skip to prevent duplicates
        skipped++;
        continue;
      }
      
      // Calculate next ID (max of existing spots + 1)
      const maxId = spots.length > 0 
        ? Math.max(...spots.map(s => s.id || 0))
        : 0;
      const nextId = maxId + 1;
      
      const spot = createSpot(goldData, venueData, nextId);
      
      if (spot) {
        // Validate spot has required fields
        if (!spot.lat || !spot.lng) {
          log(`  ⚠️  Skipping: Missing coordinates for ${goldData.venueName} (${venueId})`);
          skipped++;
          continue;
        }
        
        // Mark as automated and store venueId for future duplicate detection
        spot.source = 'automated';
        spot.venueId = venueId; // Store venueId for duplicate detection
        
        spots.push(spot);
        processed++;
        log(`  ✅ Created spot: ${spot.title} (${spot.id})`);
      } else {
        // Spot creation returned null - likely incomplete data
        incompleteData++;
        const hh = goldData.happyHour || {};
        if (hh.times && !hh.days && (!hh.specials || hh.specials.length === 0)) {
          log(`  ⚠️  Skipping: Incomplete data for ${goldData.venueName} (${venueId}) - only time "${hh.times}" with no days or specials`);
        }
      }
      
    } catch (error) {
      log(`  ❌ Error processing ${path.basename(goldPath)}: ${error.message}`);
      skipped++;
    }
  }
  
  // Write spots.json to reporting folder
  fs.writeFileSync(SPOTS_PATH, JSON.stringify(spots, null, 2), 'utf8');
  log(`\n✅ Created ${SPOTS_PATH}`);
  
  // Copy venues.json to reporting folder
  if (fs.existsSync(VENUES_PATH)) {
    fs.copyFileSync(VENUES_PATH, REPORTING_VENUES_PATH);
    log(`✅ Copied venues.json to ${REPORTING_VENUES_PATH}`);
  }
  
  // Copy areas.json to reporting folder
  if (fs.existsSync(AREAS_PATH)) {
    fs.copyFileSync(AREAS_PATH, REPORTING_AREAS_PATH);
    log(`✅ Copied areas.json to ${REPORTING_AREAS_PATH}`);
  }
  
  // Summary
  const existingAutomatedCount = existingSpots.filter(s => s.source === 'automated').length;
  const totalAutomatedCount = spots.filter(s => s.source === 'automated').length;
  log(`\n📊 Summary:`);
  log(`   ✅ New automated spots created: ${processed}`);
  log(`   📋 Existing automated spots preserved: ${existingAutomatedCount}`);
  log(`   👤 Manual spots preserved: ${manualSpotsCount}`);
  log(`   ⚠️  Skipped (already exists): ${skipped}`);
  log(`   ❌ Missing venue data: ${missingVenue}`);
  log(`   ℹ️  No happy hour: ${noHappyHour}`);
  log(`   📋 Incomplete data: ${incompleteData} (time only, no days/specials)`);
  log(`   📄 Total spots in spots.json: ${spots.length} (${manualSpotsCount} manual + ${totalAutomatedCount} automated)`);
  log(`\n✨ Done! Updated reporting folder with spots.json, venues.json, and areas.json`);
  log(`   Total spots: ${spots.length} (${manualSpotsCount} manual + ${totalAutomatedCount} automated)`);
}

try {
  main();
} catch (error) {
  log(`❌ Fatal error: ${error.message || error}`);
  console.error(error);
  process.exit(1);
}
