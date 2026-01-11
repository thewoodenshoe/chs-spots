const fs = require('fs');
const path = require('path');

// Logging setup
const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logPath = path.join(logDir, 'seed-venues.log');

// Overwrite log file on each run
fs.writeFileSync(logPath, '', 'utf8');

/**
 * Logger function: logs to console (with emojis) and file (without emojis, with timestamp)
 */
function log(message) {
  // Log to console (with emojis/colors)
  console.log(message);
  
  // Format timestamp as [YYYY-MM-DD HH:mm:ss]
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const timestamp = `[${year}-${month}-${day} ${hours}:${minutes}:${seconds}]`;
  
  // Strip emojis from message for file logging
  // Emoji ranges: \u{1F300}-\u{1F5FF} (Misc Symbols), \u{1F600}-\u{1F64F} (Emoticons), 
  // \u{1F680}-\u{1F6FF} (Transport), \u{2600}-\u{26FF} (Misc symbols), \u{2700}-\u{27BF} (Dingbats)
  const messageWithoutEmojis = message.replace(/[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim();
  
  // Append to log file
  fs.appendFileSync(logPath, `${timestamp} ${messageWithoutEmojis}\n`, 'utf8');
}

/**
 * Verbose logger: writes detailed information to log file only (not to console)
 * Use for --vvv level detailed logging
 */
function logVerbose(message) {
  // Format timestamp as [YYYY-MM-DD HH:mm:ss]
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const timestamp = `[${year}-${month}-${day} ${hours}:${minutes}:${seconds}]`;
  
  // Strip emojis from message
  const messageWithoutEmojis = message.replace(/[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim();
  
  // Append to log file (verbose details only in file)
  fs.appendFileSync(logPath, `${timestamp} ${messageWithoutEmojis}\n`, 'utf8');
}

// Try to load dotenv if available (check both .env and .env.local)
try {
  require('dotenv').config();
  // Also try .env.local (Next.js convention)
  try {
    require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
  } catch (e) {
    // .env.local not found, that's ok
  }
} catch (e) {
  // dotenv not installed - environment variables must be set manually
  // Or ensure they're in your shell environment
}

// Google Maps API Key
const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || process.env.GOOGLE_PLACES_KEY;
if (!GOOGLE_MAPS_API_KEY) {
  log('❌ Error: NEXT_PUBLIC_GOOGLE_MAPS_KEY or GOOGLE_PLACES_KEY must be set in .env');
  process.exit(1);
}

// Paths
const dataDir = path.join(__dirname, '..', 'data');
const outputFile = path.join(dataDir, 'venues.json');
const areasConfigFile = path.join(dataDir, 'areas.json');

// Load areas configuration from areas.json
// Note: areas.json should be valid JSON (no comments). If you need documentation, use a separate README.
let AREAS_CONFIG = [];
try {
  if (!fs.existsSync(areasConfigFile)) {
    throw new Error(`areas.json not found at ${areasConfigFile}`);
  }
  const areasConfigContent = fs.readFileSync(areasConfigFile, 'utf8');
  // Remove any potential comments (lines starting with //)
  const cleanedContent = areasConfigContent.replace(/^\/\/.*$/gm, '').trim();
  AREAS_CONFIG = JSON.parse(cleanedContent);
  
  if (!Array.isArray(AREAS_CONFIG)) {
    throw new Error('areas.json must contain an array of area objects');
  }
  
  log(`✅ Loaded ${AREAS_CONFIG.length} areas from ${path.resolve(areasConfigFile)}`);
  AREAS_CONFIG.forEach(area => {
    log(`   📍 ${area.displayName || area.name}: radius ${area.radiusMeters}m`);
  });
} catch (error) {
  log(`❌ Error loading areas.json: ${error.message}`);
  log(`   Please ensure ${areasConfigFile} exists and is valid JSON.`);
  process.exit(1);
}

// Venue types to query (alcohol-serving establishments)
const VENUE_TYPES = [
  'bar',
  'restaurant',
  'brewery',
  'night_club',
  'wine_bar',
  'breakfast'
];

// Helper: Delay function
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper: Make HTTP request with retry
async function makeRequest(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      if (i === retries - 1) throw error;
      await delay(2000 * (i + 1)); // Exponential backoff
    }
  }
}

// Fetch all pages of results for a query
async function fetchAllPages(areaName, venueType, lat, lng, radius, maxPages = 10) {
  const allResults = [];
  let nextPageToken = null;
  let pageCount = 0;
  
  try {
    do {
      let url;
      if (nextPageToken) {
        // Use next_page_token for pagination
        url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?pagetoken=${nextPageToken}&key=${GOOGLE_MAPS_API_KEY}`;
      } else {
        // Initial request
        url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&type=${venueType}&key=${GOOGLE_MAPS_API_KEY}`;
      }
      
      const response = await makeRequest(url);
      
      if (response.status === 'OK' || response.status === 'ZERO_RESULTS') {
        if (response.results && response.results.length > 0) {
          allResults.push(...response.results);
          pageCount++;
        }
        
        nextPageToken = response.next_page_token || null;
        
        if (!nextPageToken) {
          break;
        }
        
        if (pageCount >= maxPages) {
          break;
        }
      } else if (response.status === 'ZERO_RESULTS') {
        break;
      } else {
        throw new Error(`API returned status: ${response.status} - ${response.error_message || ''}`);
      }
      
      // Wait between requests to handle next_page_token
      if (nextPageToken) {
        await delay(2000); // Wait 2 seconds for token to become valid
      }
    } while (nextPageToken && pageCount < maxPages);
    
    return allResults;
  } catch (error) {
    log(`   ⚠️  Error fetching pages: ${error.message}`);
    return allResults;
  }
}

// Extract venue data from Google Places result
function extractVenueData(result, areaName) {
  return {
    id: result.place_id,
    name: result.name || 'Unknown',
    address: result.vicinity || result.formatted_address || 'Address not available',
    lat: result.geometry?.location?.lat || null,
    lng: result.geometry?.location?.lng || null,
    website: result.website || null,
    types: result.types || [],
    area: areaName,
  };
}

// Fetch place details from Google Places Details API
async function fetchPlaceDetails(placeId) {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,website,formatted_address&key=${GOOGLE_MAPS_API_KEY}`;
  
  try {
    const response = await makeRequest(url);
    
    if (response.status === 'OK' && response.result) {
      return {
        website: response.result.website || null,
        formatted_address: response.result.formatted_address || null,
      };
    } else if (response.status === 'NOT_FOUND') {
      return { website: null, formatted_address: null };
    } else {
      throw new Error(`API returned status: ${response.status} - ${response.error_message || ''}`);
    }
  } catch (error) {
    throw error;
  }
}

// Main seeding function - processes all areas from areas.json
async function seedVenuesExtended() {
  log('🍺 Starting venue seeding using areas from areas.json...\n');
  log(`📍 Processing ${AREAS_CONFIG.length} areas:`);
  AREAS_CONFIG.forEach(area => {
    log(`   ${area.displayName || area.name}:`);
    log(`     Center: ${area.center.lat}, ${area.center.lng}`);
    log(`     Radius: ${area.radiusMeters}m`);
    if (area.bounds) {
      log(`     Bounds: lat ${area.bounds.south} to ${area.bounds.north}, lng ${area.bounds.west} to ${area.bounds.east}`);
    }
    if (area.description) {
      log(`     ${area.description}`);
    }
  });
  log('');
  
  // Load existing venues if file exists
  let existingVenues = [];
  const seenPlaceIds = new Set();
  
  if (fs.existsSync(outputFile)) {
    try {
      const existingData = fs.readFileSync(outputFile, 'utf8');
      existingVenues = JSON.parse(existingData);
      existingVenues.forEach(v => {
        if (v.id) seenPlaceIds.add(v.id);
      });
      log(`📖 Loaded ${existingVenues.length} existing venues from ${path.resolve(outputFile)}`);
      log(`   (will append new venues without overwriting)\n`);
    } catch (error) {
      log(`⚠️  Error loading existing venues: ${error.message}`);
      log(`   (starting fresh)\n`);
    }
  } else {
    log(`📄 No existing venues.json found, creating new file\n`);
  }
  
  // Ensure data directory exists
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  const newVenues = [];
  const areaNewVenues = {};
  // Initialize area counters
  AREAS_CONFIG.forEach(area => {
    areaNewVenues[area.name] = [];
  });
  
  let totalQueries = 0;
  let successfulQueries = 0;
  let failedQueries = 0;
  
  // Process all areas from config
  for (const areaConfig of AREAS_CONFIG) {
    const areaName = areaConfig.name;
    log(`\n📍 Processing ${areaConfig.displayName || areaName}...`);
    
    for (const venueType of VENUE_TYPES) {
      totalQueries++;
      const queryName = `${areaName} (${venueType})`;
      
      try {
        // Terminal: Simple message
        log(`🔍 Querying ${queryName}...`);
        // File: Detailed query information
        logVerbose(`Query details: Area=${areaName} | Type=${venueType} | Center=(${areaConfig.center.lat}, ${areaConfig.center.lng}) | Radius=${areaConfig.radiusMeters}m`);
        
        const results = await fetchAllPages(
          areaName,
          venueType,
          areaConfig.center.lat,
          areaConfig.center.lng,
          areaConfig.radiusMeters
        );
        
        let addedCount = 0;
        const addedNames = [];
        for (const result of results) {
          if (!seenPlaceIds.has(result.place_id)) {
            seenPlaceIds.add(result.place_id);
            const venue = extractVenueData(result, areaName);
            newVenues.push(venue);
            areaNewVenues[areaName].push(venue);
            addedNames.push(venue.name);
            addedCount++;
            // Verbose: Log each venue found
            logVerbose(`  Found venue: ${venue.name} | Place ID: ${venue.id} | Location: (${venue.lat}, ${venue.lng}) | Address: ${venue.address} | Types: ${venue.types?.join(', ') || 'N/A'}`);
          }
        }
        
        // Terminal: Simple message
        log(`   ✅ Found ${results.length} results (${addedCount} new venues)`);
        if (addedCount > 0 && addedNames.length <= 5) {
          log(`   📝 Added: ${addedNames.join(', ')}`);
        } else if (addedCount > 0) {
          log(`   📝 Added: ${addedNames.slice(0, 5).join(', ')} and ${addedCount - 5} more`);
        }
        // File: Detailed summary
        logVerbose(`  Query complete: Total results=${results.length} | New venues=${addedCount} | Area=${areaName} | Type=${venueType}`);
        successfulQueries++;
        
        await delay(1000);
      } catch (error) {
        log(`   ❌ Error querying ${queryName}: ${error.message}`);
        failedQueries++;
      }
    }
  }
  
  // Log summary by area
  log(`\n📊 New Venues by Area:`);
  for (const [areaName, venues] of Object.entries(areaNewVenues)) {
    if (venues.length > 0) {
      log(`   ${areaName}: Added ${venues.length} new venues`);
      // Log notable venues if found (sample first 3)
      if (venues.length > 0) {
        const sampleNames = venues.slice(0, 3).map(v => v.name);
        log(`     Sample: ${sampleNames.join(', ')}${venues.length > 3 ? ` and ${venues.length - 3} more` : ''}`);
      }
    } else {
      log(`   ${areaName}: No new venues`);
    }
  }
  
  // Combine existing and new venues
  const allVenues = [...existingVenues, ...newVenues];
  
  // Sort venues by area, then by name
  allVenues.sort((a, b) => {
    if (a.area !== b.area) {
      return a.area.localeCompare(b.area);
    }
    return a.name.localeCompare(b.name);
  });
  
  // Fetch website details for new venues missing websites
  if (newVenues.length > 0) {
    log(`\n🌐 Fetching website details for new venues...\n`);
    const venuesNeedingWebsites = newVenues.filter(v => !v.website || v.website.trim() === '');
    const totalNeedingWebsites = venuesNeedingWebsites.length;
    let detailsFetched = 0;
    let websitesFound = 0;
    let detailsErrors = 0;
    
    if (totalNeedingWebsites > 0) {
      for (let i = 0; i < venuesNeedingWebsites.length; i++) {
        const venue = venuesNeedingWebsites[i];
        const progress = `[${i + 1}/${totalNeedingWebsites}]`;
        
        try {
          // Verbose: Log search details
          logVerbose(`Searching website for: ${venue.name} | Place ID: ${venue.id} | Area: ${venue.area} | Location: (${venue.lat}, ${venue.lng}) | Address: ${venue.address || 'N/A'}`);
          
          const details = await fetchPlaceDetails(venue.id);
          detailsFetched++;
          
          if (details.website) {
            venue.website = details.website;
            websitesFound++;
            
            if (details.formatted_address && (!venue.address || venue.address === 'Address not available')) {
              venue.address = details.formatted_address;
            }
            
            // Terminal: Simple message
            log(`${progress} ✅ ${venue.name}: Found website`);
            // File: Detailed message
            logVerbose(`  -> Website found: ${details.website} | Updated address: ${venue.address} | Area: ${venue.area} | Coordinates: (${venue.lat}, ${venue.lng})`);
          } else {
            // Terminal: Simple message
            log(`${progress} ⬜ ${venue.name}: No website available`);
            // File: Detailed message
            logVerbose(`  -> Website not found | Searched Place ID: ${venue.id} | Area: ${venue.area} | Location: (${venue.lat}, ${venue.lng}) | Address: ${venue.address || 'N/A'}`);
          }
        } catch (error) {
          detailsErrors++;
          // Terminal: Simple message
          log(`${progress} ❌ ${venue.name}: ${error.message}`);
          // File: Detailed message
          logVerbose(`  -> Error fetching website | Place ID: ${venue.id} | Area: ${venue.area} | Location: (${venue.lat}, ${venue.lng}) | Error: ${error.message}`);
        }
        
        if (i < venuesNeedingWebsites.length - 1) {
          const delayMs = 1000 + Math.floor(Math.random() * 1000);
          await delay(delayMs);
        }
        
        if ((i + 1) % 10 === 0 || i === venuesNeedingWebsites.length - 1) {
          log(`   📊 Progress: Fetched details for ${detailsFetched}/${i + 1} venues, found ${websitesFound} websites\n`);
        }
      }
      
      log(`\n🌐 Website fetching complete:`);
      log(`   ✅ Fetched details for ${detailsFetched}/${totalNeedingWebsites} venues`);
      log(`   🌐 Found ${websitesFound} websites`);
      log(`   ❌ Errors: ${detailsErrors}\n`);
    }
  }
  
  // Write to file
  try {
    fs.writeFileSync(outputFile, JSON.stringify(allVenues, null, 2), 'utf8');
    log(`\n📝 Successfully wrote ${allVenues.length} total venues to ${path.resolve(outputFile)}`);
    log(`   ✨ Added ${newVenues.length} new venues across ${AREAS_CONFIG.length} areas`);
    for (const areaConfig of AREAS_CONFIG) {
      const areaName = areaConfig.name;
      if (areaNewVenues[areaName] && areaNewVenues[areaName].length > 0) {
        log(`      - ${areaConfig.displayName || areaName}: ${areaNewVenues[areaName].length} new venues`);
      }
    }
  } catch (error) {
    log(`\n❌ Error writing to file: ${error.message}`);
    process.exit(1);
  }
  
  // Summary
  log(`\n📊 Summary:`);
  log(`   ✅ Successful queries: ${successfulQueries}/${totalQueries}`);
  log(`   ❌ Failed queries: ${failedQueries}/${totalQueries}`);
  log(`   🍺 Total venues: ${allVenues.length} (${existingVenues.length} existing + ${newVenues.length} new)`);
  
  const venuesWithWebsites = allVenues.filter(v => v.website && v.website.trim() !== '').length;
  const websitePercentage = allVenues.length > 0 ? Math.round((venuesWithWebsites / allVenues.length) * 100) : 0;
  log(`   🌐 Venues with websites: ${venuesWithWebsites}/${allVenues.length} (${websitePercentage}%)`);
  
  // Show breakdown by area (all areas)
  const areaCounts = {};
  for (const venue of allVenues) {
    const area = venue.area || 'Unknown';
    areaCounts[area] = (areaCounts[area] || 0) + 1;
  }
  
  log(`\n📍 Venues by area:`);
  const sortedAreas = Object.entries(areaCounts).sort((a, b) => b[1] - a[1]);
  for (const [area, count] of sortedAreas) {
    log(`   ${area}: ${count} venues`);
  }
  
  // Show breakdown by type (all areas, aggregated)
  const typeCounts = {};
  for (const venue of allVenues) {
    if (venue.types && Array.isArray(venue.types)) {
      for (const type of venue.types) {
        if (VENUE_TYPES.includes(type)) {
          typeCounts[type] = (typeCounts[type] || 0) + 1;
        }
      }
    }
  }
  
  log(`\n🏢 Venues by type (all areas):`);
  const sortedTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
  for (const [type, count] of sortedTypes) {
    log(`   ${type}: ${count} venues`);
  }
  
  // Show breakdown by area and type (detailed)
  log(`\n📋 Detailed breakdown by area and type:`);
  for (const [area, count] of sortedAreas) {
    const areaVenues = allVenues.filter(v => (v.area || 'Unknown') === area);
    if (areaVenues.length > 0) {
      const areaTypeCounts = {};
      for (const venue of areaVenues) {
        if (venue.types && Array.isArray(venue.types)) {
          for (const type of venue.types) {
            if (VENUE_TYPES.includes(type)) {
              areaTypeCounts[type] = (areaTypeCounts[type] || 0) + 1;
            }
          }
        }
      }
      
      if (Object.keys(areaTypeCounts).length > 0) {
        log(`\n   ${area} (${count} total):`);
        const sortedAreaTypes = Object.entries(areaTypeCounts).sort((a, b) => b[1] - a[1]);
        for (const [type, typeCount] of sortedAreaTypes) {
          log(`     ${type}: ${typeCount}`);
        }
      }
    }
  }
  
  log(`\n✨ Venue seeding complete for all areas from areas.json!`);
  log(`Done! Log saved to logs/seed-venues.log`);
}

// Run the seeding
log('🔑 Using API key: ' + GOOGLE_MAPS_API_KEY.substring(0, 10) + '...\n');
seedVenuesExtended().catch((error) => {
  log('❌ Fatal error during seeding: ' + (error.message || error));
  process.exit(1);
});