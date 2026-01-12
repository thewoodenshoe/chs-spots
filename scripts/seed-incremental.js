/**
 * Incremental venue seeding (Strategy 3: Optimized Full Search)
 * 
 * This script runs nightly to:
 * - Find new venues using optimized search (50% radius, 3 venue types)
 * - Use accurate area assignment logic from seed-venues.js
 * - Skip venues that already exist with websites
 * - Early exit if too many consecutive duplicates
 * 
 * Run with: node scripts/seed-incremental.js
 */

const fs = require('fs');
const path = require('path');

// Logging setup
const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logPath = path.join(logDir, 'seed-incremental.log');

// Overwrite log file on each run
fs.writeFileSync(logPath, '', 'utf8');

/**
 * Logger function: logs to console (with emojis) and file (without emojis, with timestamp)
 */
function log(message) {
  console.log(message);
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const timestamp = `[${year}-${month}-${day} ${hours}:${minutes}:${seconds}]`;
  const messageWithoutEmojis = message.replace(/[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim();
  fs.appendFileSync(logPath, `${timestamp} ${messageWithoutEmojis}\n`, 'utf8');
}

/**
 * Verbose logger: writes detailed information to log file only
 */
function logVerbose(message) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const timestamp = `[${year}-${month}-${day} ${hours}:${minutes}:${seconds}]`;
  const messageWithoutEmojis = message.replace(/[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim();
  fs.appendFileSync(logPath, `${timestamp} ${messageWithoutEmojis}\n`, 'utf8');
}

// Try to load dotenv if available
try {
  require('dotenv').config();
  try {
    require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
  } catch (e) {
    // .env.local not found, that's ok
  }
} catch (e) {
  // dotenv not installed - environment variables must be set manually
}

// Google Maps API Key
const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || process.env.GOOGLE_PLACES_KEY;
if (!GOOGLE_MAPS_API_KEY) {
  log('❌ Error: NEXT_PUBLIC_GOOGLE_MAPS_KEY or GOOGLE_PLACES_KEY must be set in .env');
  process.exit(1);
}

// Paths
const dataDir = path.join(__dirname, '..', 'data');
const venuesFile = path.join(dataDir, 'venues.json');
const areasConfigFile = path.join(dataDir, 'areas.json');

// Strategy 3: Only search for bar, restaurant, brewery (3 types)
const VENUE_TYPES = [
  'bar',
  'restaurant',
  'brewery'
];

// Load areas configuration from areas.json
let AREAS_CONFIG = [];
try {
  if (!fs.existsSync(areasConfigFile)) {
    throw new Error(`areas.json not found at ${areasConfigFile}`);
  }
  const areasConfigContent = fs.readFileSync(areasConfigFile, 'utf8');
  const cleanedContent = areasConfigContent.replace(/^\/\/.*$/gm, '').trim();
  AREAS_CONFIG = JSON.parse(cleanedContent);
  
  if (!Array.isArray(AREAS_CONFIG)) {
    throw new Error('areas.json must contain an array of area objects');
  }
  
  log(`✅ Loaded ${AREAS_CONFIG.length} areas from ${path.resolve(areasConfigFile)}`);
} catch (error) {
  log(`❌ Error loading areas.json: ${error.message}`);
  process.exit(1);
}

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

/**
 * Check if a venue serves alcohol (restaurant, bar, cafe, night_club, brewery, breakfast place, hotel with bar/restaurant)
 */
function isAlcoholServingVenue(result) {
  if (!result.types || !Array.isArray(result.types)) {
    return false;
  }
  
  const types = result.types;
  const primaryTypes = types.slice(0, 3);
  
  const hasFoodOrLodgingType = primaryTypes.some(type => 
    ['restaurant', 'bar', 'cafe', 'night_club', 'brewery', 'wine_bar', 'breakfast', 'lodging'].includes(type)
  );
  
  if (!hasFoodOrLodgingType) {
    return false;
  }
  
  const excludeTypes = ['store', 'supermarket', 'grocery_or_supermarket', 
    'convenience_store', 'hospital', 'university', 'school', 'locality', 'political',
    'electronics_store', 'department_store', 'hardware_store', 'clothing_store'];
  const isExcluded = types.some(type => excludeTypes.includes(type));
  
  return !isExcluded;
}

/**
 * Extract zip code from address string or address_components
 */
function extractZipCode(address, addressComponents) {
  if (addressComponents && Array.isArray(addressComponents)) {
    const postalCode = addressComponents.find(comp => 
      comp.types && comp.types.includes('postal_code')
    );
    if (postalCode && postalCode.long_name) {
      return postalCode.long_name;
    }
  }
  
  if (address) {
    const zipMatch = address.match(/\b(\d{5})\b/);
    return zipMatch ? zipMatch[1] : null;
  }
  
  return null;
}

/**
 * Extract sublocality from Google's address_components
 */
function extractSublocality(addressComponents) {
  if (!addressComponents || !Array.isArray(addressComponents)) {
    return null;
  }
  
  const sublocality1 = addressComponents.find(comp => 
    comp.types && comp.types.includes('sublocality_level_1')
  );
  if (sublocality1 && sublocality1.long_name) {
    return sublocality1.long_name;
  }
  
  const sublocality = addressComponents.find(comp => 
    comp.types && comp.types.includes('sublocality')
  );
  if (sublocality && sublocality.long_name) {
    return sublocality.long_name;
  }
  
  return null;
}

/**
 * Map Google's sublocality names to our area names
 */
function mapGoogleSublocalityToArea(googleSublocality) {
  if (!googleSublocality) return null;
  
  const normalized = googleSublocality.toLowerCase().trim();
  
  const mapping = {
    'mount pleasant': 'Mount Pleasant',
    'mt pleasant': 'Mount Pleasant',
    'mt. pleasant': 'Mount Pleasant',
    'downtown charleston': 'Downtown Charleston',
    'downtown': 'Downtown Charleston',
    'historic district': 'Downtown Charleston',
    'french quarter': 'Downtown Charleston',
    'james island': 'James Island',
    "sullivan's island": "Sullivan's Island",
    'sullivans island': "Sullivan's Island",
    'north charleston': 'North Charleston',
    'n charleston': 'North Charleston',
    'west ashley': 'West Ashley',
    'daniel island': 'Daniel Island',
  };
  
  return mapping[normalized] || null;
}

/**
 * Extract area name from address string
 */
function extractAreaFromAddress(address) {
  if (!address) return null;
  
  const addressLower = address.toLowerCase();
  
  const explicitAreaKeywords = {
    'north charleston': 'North Charleston',
    'n charleston': 'North Charleston',
    'downtown': 'Downtown Charleston',
    'downtown charleston': 'Downtown Charleston',
    'mount pleasant': 'Mount Pleasant',
    'mt pleasant': 'Mount Pleasant',
    'mt. pleasant': 'Mount Pleasant',
    'west ashley': 'West Ashley',
    'james island': 'James Island',
    "sullivan's island": "Sullivan's Island",
    'sullivans island': "Sullivan's Island",
    'daniel island': 'Daniel Island',
  };
  
  const sortedExplicit = Object.keys(explicitAreaKeywords).sort((a, b) => b.length - a.length);
  for (const keyword of sortedExplicit) {
    if (addressLower.includes(keyword)) {
      return explicitAreaKeywords[keyword];
    }
  }
  
  // King Street: 1-2000 = Downtown, 2000+ = West Ashley
  if (addressLower.includes('king street')) {
    const numberMatch = address.match(/(\d+)\s+king street/i);
    if (numberMatch) {
      const streetNumber = parseInt(numberMatch[1]);
      if (streetNumber >= 1 && streetNumber <= 2000) {
        return 'Downtown Charleston';
      } else if (streetNumber > 2000) {
        return 'West Ashley';
      }
    }
  }
  
  // East Bay Street: Downtown Charleston
  if (addressLower.includes('east bay street') || addressLower.includes('east bay st')) {
    return 'Downtown Charleston';
  }
  
  // Meeting Street: 1-400 = Downtown, 400+ = North Charleston
  if (addressLower.includes('meeting street')) {
    const numberMatch = address.match(/(\d+)\s+meeting street/i);
    if (numberMatch) {
      const streetNumber = parseInt(numberMatch[1]);
      if (streetNumber >= 1 && streetNumber <= 400) {
        return 'Downtown Charleston';
      } else if (streetNumber >= 400) {
        return 'North Charleston';
      }
    }
  }
  
  // Pittsburgh Avenue: North Charleston
  if (addressLower.includes('pittsburgh avenue') || addressLower.includes('pittsburgh ave')) {
    return 'North Charleston';
  }
  
  // Clements Ferry Road: Daniel Island (when zip 29492)
  if (addressLower.includes('clements ferry') || addressLower.includes('clements ferry road')) {
    return 'Daniel Island';
  }
  
  // Island Park Drive: Daniel Island
  if (addressLower.includes('island park') || addressLower.includes('island park drive')) {
    return 'Daniel Island';
  }
  
  // Seven Farms Drive: Daniel Island
  if (addressLower.includes('seven farms') || addressLower.includes('seven farms drive')) {
    return 'Daniel Island';
  }
  
  return null;
}

/**
 * Validate if coordinates fall within area bounds
 */
function isInBounds(lat, lng, area) {
  if (!area.bounds || !lat || !lng) return false;
  const { south, west, north, east } = area.bounds;
  return lat >= south && lat <= north && lng >= west && lng <= east;
}

/**
 * Find which area a venue belongs to using accurate logic from seed-venues.js
 */
function findAreaForVenue(lat, lng, address, addressComponents, areasConfig) {
  // Priority 1: Use Google's sublocality
  const googleSublocality = extractSublocality(addressComponents);
  if (googleSublocality) {
    const mappedArea = mapGoogleSublocalityToArea(googleSublocality);
    if (mappedArea) {
      const areaExists = areasConfig.find(a => a.name === mappedArea);
      if (areaExists) {
        logVerbose(`  ✅ Area from Google sublocality: ${googleSublocality} → ${mappedArea}`);
        return mappedArea;
      }
    }
  }
  
  // Priority 2: Parse address string
  const addressArea = extractAreaFromAddress(address);
  if (addressArea) {
    const areaExists = areasConfig.find(a => a.name === addressArea);
    if (areaExists) {
      const isStreetNumberBased = (address.toLowerCase().includes('king street') || 
                                   address.toLowerCase().includes('meeting street'));
      const isEastBayStreet = address.toLowerCase().includes('east bay street') || 
                              address.toLowerCase().includes('east bay st');
      const isClementsFerry = address.toLowerCase().includes('clements ferry');
      
      if (isStreetNumberBased || isEastBayStreet) {
        logVerbose(`  ✅ Area from address string: "${addressArea}" (street-based, authoritative)`);
        return addressArea;
      }
      
      if (isClementsFerry && addressArea === 'Daniel Island') {
        const zipCode = extractZipCode(address, addressComponents);
        if (zipCode === '29492') {
          logVerbose(`  ✅ Area from address string: "${addressArea}" (Clements Ferry Road with zip 29492, authoritative)`);
          return addressArea;
        }
      }
      
      if (isInBounds(lat, lng, areaExists)) {
        logVerbose(`  ✅ Area from address string: "${addressArea}" (validated with coordinates)`);
        return addressArea;
      }
    }
  }
  
  // Priority 3: Check zip codes
  const zipCode = extractZipCode(address, addressComponents);
  if (zipCode) {
    for (const area of areasConfig) {
      if (area.zipCodes && Array.isArray(area.zipCodes) && area.zipCodes.includes(zipCode)) {
        if (area.name === 'Daniel Island' && zipCode === '29492') {
          const buffer = 0.05;
          const { south, west, north, east } = area.bounds;
          const inBufferedBounds = lat >= (south - buffer) && lat <= (north + buffer) && 
                                   lng >= (west - buffer) && lng <= (east + buffer);
          if (inBufferedBounds) {
            logVerbose(`  ✅ Area from zip code ${zipCode}: ${area.name} (zip code 29492 is definitive for Daniel Island)`);
            return area.name;
          }
        } else {
          if (isInBounds(lat, lng, area)) {
            logVerbose(`  ✅ Area from zip code ${zipCode}: ${area.name} (validated with coordinates)`);
            return area.name;
          }
        }
      }
    }
  }
  
  // Priority 4: Bounds checking (sorted by size)
  const sortedAreas = [...areasConfig].sort((a, b) => {
    const areaA = (a.bounds ? (a.bounds.north - a.bounds.south) * (a.bounds.east - a.bounds.west) : Infinity);
    const areaB = (b.bounds ? (b.bounds.north - b.bounds.south) * (b.bounds.east - b.bounds.west) : Infinity);
    return areaA - areaB;
  });
  
  if (!lat || !lng) {
    return null;
  }
  
  for (const area of sortedAreas) {
    if (area.bounds && isInBounds(lat, lng, area)) {
      logVerbose(`  ⚠️  Area from bounds check: ${area.name} (fallback - no sublocality/address/zip match)`);
      return area.name;
    }
  }
  
  return null;
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
        url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?pagetoken=${nextPageToken}&key=${GOOGLE_MAPS_API_KEY}`;
      } else {
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
      
      if (nextPageToken) {
        await delay(2000);
      }
    } while (nextPageToken && pageCount < maxPages);
    
    return allResults;
  } catch (error) {
    log(`   ⚠️  Error fetching pages: ${error.message}`);
    return allResults;
  }
}

// Fetch place details from Google Places Details API (with address_components)
async function fetchPlaceDetails(placeId) {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,website,formatted_address,address_components&key=${GOOGLE_MAPS_API_KEY}`;
  
  try {
    const response = await makeRequest(url);
    
    if (response.status === 'OK' && response.result) {
      return {
        website: response.result.website || null,
        formatted_address: response.result.formatted_address || null,
        address_components: response.result.address_components || null,
      };
    } else if (response.status === 'NOT_FOUND') {
      return { website: null, formatted_address: null, address_components: null };
    } else {
      throw new Error(`API returned status: ${response.status} - ${response.error_message || ''}`);
    }
  } catch (error) {
    throw error;
  }
}

// Extract venue data from Google Places result
function extractVenueData(result, areaName) {
  const addressComponents = result.address_components || null;
  const address = result.vicinity || result.formatted_address || 'Address not available';
  
  return {
    id: result.place_id,
    name: result.name || 'Unknown',
    address: address,
    addressComponents: addressComponents,
    lat: result.geometry?.location?.lat || null,
    lng: result.geometry?.location?.lng || null,
    website: result.website || null,
    types: result.types || [],
    area: areaName, // Will be reassigned using findAreaForVenue
  };
}

// Main incremental seeding function
async function seedIncremental() {
  log('🔄 Starting incremental venue seeding (Strategy 3: Optimized Full Search)...\n');
  log('   Strategy: 50% radius, 3 venue types (bar, restaurant, brewery), accurate area assignment\n');
  
  // Load existing venues
  let existingVenues = [];
  const seenPlaceIds = new Set(); // Track ALL existing venue IDs (whether they have websites or not)
  const existingVenuesWithWebsites = new Set(); // Track venues that already have websites (for reporting only)
  
  if (fs.existsSync(venuesFile)) {
    try {
      const existingData = fs.readFileSync(venuesFile, 'utf8');
      existingVenues = JSON.parse(existingData);
      existingVenues.forEach(v => {
        if (v.id) {
          // Add ALL existing venues to seenPlaceIds (not just those with websites)
          seenPlaceIds.add(v.id);
          // Track venues that already have websites (for reporting only)
          if (v.website && v.website.trim() !== '') {
            existingVenuesWithWebsites.add(v.id);
          }
        }
      });
      log(`📖 Loaded ${existingVenues.length} existing venues from ${path.resolve(venuesFile)}`);
      log(`   ${existingVenuesWithWebsites.size} venues already have websites\n`);
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
  const venuesNeedingWebsite = [];
  let totalQueries = 0;
  let successfulQueries = 0;
  let failedQueries = 0;
  let websitesEnriched = 0;
  let skippedExisting = 0;
  
  // Strategy 3: Process each area with 50% radius
  log(`📍 Processing ${AREAS_CONFIG.length} areas with 50% radius:\n`);
  
  for (const areaConfig of AREAS_CONFIG) {
    const areaName = areaConfig.name;
    // Strategy 3: Reduce radius to 50%
    const reducedRadius = Math.floor(areaConfig.radiusMeters * 0.5);
    
    log(`\n📍 Processing ${areaConfig.displayName || areaName}...`);
    log(`   Original radius: ${areaConfig.radiusMeters}m → Reduced radius: ${reducedRadius}m (50%)`);
    
    for (const venueType of VENUE_TYPES) {
      totalQueries++;
      const queryName = `${areaName} (${venueType})`;
      
      try {
        log(`🔍 Querying ${queryName}...`);
        logVerbose(`Query details: Area=${areaName} | Type=${venueType} | Center=(${areaConfig.center.lat}, ${areaConfig.center.lng}) | Radius=${reducedRadius}m (50% of original)`);
        
        // Strategy 3: Early exit - track consecutive duplicates
        let consecutiveDuplicates = 0;
        const EARLY_EXIT_THRESHOLD = 20; // Exit if 20 consecutive results are duplicates
        
        const results = await fetchAllPages(
          areaName,
          venueType,
          areaConfig.center.lat,
          areaConfig.center.lng,
          reducedRadius,
          5 // Limit to 5 pages max for efficiency
        );
        
        let addedCount = 0;
        let duplicateCount = 0;
        
        for (const result of results) {
          // Skip if venue already exists (check seenPlaceIds which includes ALL existing venues)
          if (seenPlaceIds.has(result.place_id)) {
            consecutiveDuplicates++;
            duplicateCount++;
            if (consecutiveDuplicates >= EARLY_EXIT_THRESHOLD) {
              log(`   ⏭️  Early exit: ${consecutiveDuplicates} consecutive duplicates found (likely no new venues)`);
              break;
            }
            continue;
          }
          
          // Reset consecutive duplicates counter when we find a new venue
          consecutiveDuplicates = 0;
          
          // Filter for alcohol-serving venues
          if (!isAlcoholServingVenue(result)) {
            continue;
          }
          
          // Extract venue data
          const venue = extractVenueData(result, areaName);
          
          // Fetch Place Details to get address_components for accurate area assignment
          try {
            const details = await fetchPlaceDetails(venue.id);
            if (details.formatted_address) {
              venue.address = details.formatted_address;
            }
            if (details.address_components) {
              venue.addressComponents = details.address_components;
            }
            if (details.website && !venue.website) {
              venue.website = details.website;
            }
            
            // Use accurate area assignment logic
            const actualArea = findAreaForVenue(
              venue.lat,
              venue.lng,
              venue.address,
              venue.addressComponents,
              AREAS_CONFIG
            );
            
            if (!actualArea) {
              logVerbose(`  Skipped (no area match): ${venue.name} at (${venue.lat}, ${venue.lng}) - ${venue.address}`);
              continue;
            }
            
            venue.area = actualArea;
            
            // Add new venue
            seenPlaceIds.add(venue.id);
            newVenues.push(venue);
            addedCount++;
            
            logVerbose(`  Found venue: ${venue.name} | Place ID: ${venue.id} | Location: (${venue.lat}, ${venue.lng}) | Area: ${actualArea} | Address: ${venue.address} | Website: ${venue.website || 'N/A'}`);
            
            // Track venues needing website
            if (!venue.website || venue.website.trim() === '') {
              venuesNeedingWebsite.push(venue);
            }
            
            // Small delay between venue processing
            await delay(500);
          } catch (error) {
            logVerbose(`  Error fetching details for ${venue.name}: ${error.message}`);
            // Still add venue but without address_components
            const actualArea = findAreaForVenue(
              venue.lat,
              venue.lng,
              venue.address,
              null,
              AREAS_CONFIG
            );
            if (actualArea) {
              venue.area = actualArea;
              seenPlaceIds.add(venue.id);
              newVenues.push(venue);
              addedCount++;
            }
          }
        }
        
        log(`   ✅ Found ${results.length} results (${addedCount} new, ${duplicateCount} duplicates, ${skippedExisting} skipped existing)`);
        logVerbose(`  Query complete: Total results=${results.length} | New venues=${addedCount} | Duplicates=${duplicateCount} | Area=${areaName} | Type=${venueType}`);
        successfulQueries++;
        
        await delay(1000); // Delay between queries
      } catch (error) {
        log(`   ❌ Error querying ${queryName}: ${error.message}`);
        failedQueries++;
      }
    }
  }
  
  log(`\n📊 Processed ${AREAS_CONFIG.length} areas`);
  log(`   ✅ Added ${newVenues.length} new venues`);
  log(`   ⏭️  Skipped ${skippedExisting} existing venues with websites`);
  
  // Enrich missing websites for new venues
  if (venuesNeedingWebsite.length > 0) {
    log(`\n🌐 Enriching missing websites for ${venuesNeedingWebsite.length} new venues...\n`);
    
    for (let i = 0; i < venuesNeedingWebsite.length; i++) {
      const venue = venuesNeedingWebsite[i];
      const progress = `[${i + 1}/${venuesNeedingWebsite.length}]`;
      
      try {
        const details = await fetchPlaceDetails(venue.id);
        if (details.website) {
          venue.website = details.website;
          websitesEnriched++;
          log(`${progress} ✅ ${venue.name}: Found website`);
        } else {
          log(`${progress} ⬜ ${venue.name}: No website found`);
        }
      } catch (error) {
        log(`${progress} ❌ ${venue.name}: ${error.message}`);
      }
      
      if (i < venuesNeedingWebsite.length - 1) {
        await delay(2000);
      }
    }
    
    log(`\n🌐 Website enrichment complete:`);
    log(`   ✅ Enriched ${websitesEnriched} missing websites`);
  }
  
  // Find remaining venues with missing websites
  const stillMissingWebsites = newVenues.filter(v => !v.website || v.website.trim() === '');
  
  // Combine existing and new venues, deduplicate by id
  const allVenuesMap = new Map();
  
  existingVenues.forEach(venue => {
    if (venue.id) {
      allVenuesMap.set(venue.id, venue);
    }
  });
  
  newVenues.forEach(venue => {
    if (venue.id) {
      allVenuesMap.set(venue.id, venue);
    }
  });
  
  const allVenues = Array.from(allVenuesMap.values());
  
  // Sort venues by area, then by name
  allVenues.sort((a, b) => {
    if (a.area !== b.area) {
      return (a.area || '').localeCompare(b.area || '');
    }
    return (a.name || '').localeCompare(b.name || '');
  });
  
  // Write to file
  try {
    fs.writeFileSync(venuesFile, JSON.stringify(allVenues, null, 2), 'utf8');
    log(`\n📝 Successfully wrote ${allVenues.length} total venues to ${path.resolve(venuesFile)}`);
    log(`   ✨ Added ${newVenues.length} new venues`);
    log(`   🌐 Enriched ${websitesEnriched} missing websites`);
  } catch (error) {
    log(`\n❌ Error writing to file: ${error.message}`);
    process.exit(1);
  }
  
  // Summary
  log(`\n📊 Summary:`);
  log(`   ✅ Processed ${AREAS_CONFIG.length} areas`);
  log(`   ✅ Added ${newVenues.length} new venues`);
  log(`   ✅ Enriched ${websitesEnriched} missing websites`);
  log(`   ⏭️  Skipped ${skippedExisting} existing venues with websites`);
  log(`   ✅ Successful queries: ${successfulQueries}/${totalQueries}`);
  log(`   ❌ Failed queries: ${failedQueries}/${totalQueries}`);
  log(`   🍺 Total venues: ${allVenues.length} (${existingVenues.length} existing + ${newVenues.length} new)`);
  
  const venuesWithWebsites = allVenues.filter(v => v.website && v.website.trim() !== '').length;
  const websitePercentage = allVenues.length > 0 ? Math.round((venuesWithWebsites / allVenues.length) * 100) : 0;
  log(`   🌐 Venues with websites: ${venuesWithWebsites}/${allVenues.length} (${websitePercentage}%)`);
  
  // Show breakdown by area
  const areaCounts = {};
  for (const venue of allVenues) {
    const area = venue.area || 'Unknown';
    areaCounts[area] = (areaCounts[area] || 0) + 1;
  }
  
  log(`\n📍 Venues by area:`);
  const sortedAreas = Object.entries(areaCounts).sort((a, b) => b[1] - a[1]);
  for (const [area, count] of sortedAreas) {
    const newCount = newVenues.filter(v => v.area === area).length;
    log(`   ${area}: ${count} venues${newCount > 0 ? ` (+${newCount} new)` : ''}`);
  }
  
  log(`\n✨ Incremental seeding complete!`);
  log(`Done! Log saved to logs/seed-incremental.log`);
  
  return {
    newVenuesCount: newVenues.length,
    newVenues: newVenues
  };
}

// Run the seeding
log('🔑 Using API key: ' + GOOGLE_MAPS_API_KEY.substring(0, 10) + '...\n');
seedIncremental().catch((error) => {
  log('❌ Fatal error during seeding: ' + (error.message || error));
  process.exit(1);
});
