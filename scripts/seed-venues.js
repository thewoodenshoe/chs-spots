/**
 * seed-venues.js - Manual Venue Seeding Script
 * 
 * ⚠️  WARNING: This script uses Google Maps API and can incur significant costs.
 * 
 * Venues are now treated as STATIC - this script should only be run manually when:
 * - You need to add new venues
 * - You need to update existing venue data
 * - You explicitly want to refresh venue information
 * 
 * This script is NOT part of the automated pipeline.
 * 
 * Usage: node scripts/seed-venues.js --confirm
 * 
 * The --confirm flag is REQUIRED to prevent accidental execution.
 */

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
 * Shared logger function: logs to console and file with ISO timestamp
 */
function logToFileAndConsole(message, logPath) {
  const ts = new Date().toISOString();
  console.log(message);
  fs.appendFileSync(logPath, `[${ts}] ${message}\n`);
}

/**
 * File-only logger: logs verbose details only to file, not console
 */
function logToFileOnly(message, logPath) {
  const ts = new Date().toISOString();
  fs.appendFileSync(logPath, `[${ts}] ${message}\n`);
}

// Alias for backward compatibility - console output + file
const log = (message) => logToFileAndConsole(message, logPath);

// Verbose logging - file only (for detailed diagnostics)
const logVerbose = (message) => logToFileOnly(message, logPath);

// SAFETY CHECK: Require BOTH --confirm flag AND GOOGLE_PLACES_ENABLED=true
// Google Maps API costs can be high - this script should only run manually
// Check this FIRST before loading API keys or dotenv
const REQUIRED_FLAG = '--confirm';
const REQUIRED_ENV_VAR = 'GOOGLE_PLACES_ENABLED';
const hasConfirmFlag = process.argv.includes(REQUIRED_FLAG);
const isGooglePlacesEnabled = process.env[REQUIRED_ENV_VAR] === 'true';

if (!hasConfirmFlag || !isGooglePlacesEnabled) {
  console.log('❌ ERROR: This script uses Google Maps API and can incur significant costs.');
  console.log('   Venues are now treated as static - this script should only run manually when needed.');
  console.log('');
  console.log('   To run this script, you must:');
  console.log('   1. Add --confirm flag');
  console.log('   2. Set GOOGLE_PLACES_ENABLED=true environment variable');
  console.log('');
  console.log('   Example:');
  console.log(`   GOOGLE_PLACES_ENABLED=true node scripts/seed-venues.js ${REQUIRED_FLAG}`);
  console.log('');
  if (!hasConfirmFlag) {
    console.log('   ❌ Missing: --confirm flag');
  }
  if (!isGooglePlacesEnabled) {
    console.log(`   ❌ Missing: ${REQUIRED_ENV_VAR}=true environment variable`);
  }
  console.log('');
  console.log('   ⚠️  This script will make Google Maps API calls and may incur costs.');
  process.exit(1);
}

// Only load dotenv AFTER safety checks pass
// Try to load dotenv if available (check both .env and .env.local)
try {
  require('dotenv').config({ path: '.env.local' });
} catch (e) {
  try {
    require('dotenv').config();
  } catch (e2) {
    // dotenv not available, assume env vars are set
  }
}

// Re-check GOOGLE_PLACES_ENABLED after loading dotenv (in case it was in .env file)
const isGooglePlacesEnabledAfterDotenv = process.env[REQUIRED_ENV_VAR] === 'true';
if (!isGooglePlacesEnabledAfterDotenv) {
  log(`❌ Error: ${REQUIRED_ENV_VAR} must be set to 'true' (after loading .env files)`);
  log(`   Current value: ${process.env[REQUIRED_ENV_VAR] || 'not set'}`);
  process.exit(1);
}

// Google Maps API Key
const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || process.env.GOOGLE_PLACES_KEY;
if (!GOOGLE_MAPS_API_KEY) {
  log('❌ Error: NEXT_PUBLIC_GOOGLE_MAPS_KEY or GOOGLE_PLACES_KEY must be set in .env');
  process.exit(1);
}

log('⚠️  WARNING: Running seed-venues.js with Google Maps API');
log('   This will make API calls and may incur costs.');
log('   Venues are now treated as static - only run this when explicitly needed.\n');

// Paths - Read from and write to reporting/venues.json (incremental, preserves existing data)
const dataDir = path.join(__dirname, '..', 'data');
const reportingDir = path.join(dataDir, 'reporting');
const backupDir = path.join(dataDir, 'backup');
// Primary output: reporting/venues.json (static file, incremental updates only)
const outputFile = path.join(reportingDir, 'venues.json');
// Also write to data/venues.json for backwards compatibility
const dataVenuesFile = path.join(dataDir, 'venues.json');
const areasConfigFile = path.join(dataDir, 'config', 'areas.json');

// Ensure reporting directory exists
if (!fs.existsSync(reportingDir)) {
  fs.mkdirSync(reportingDir, { recursive: true });
}

// Ensure backup directory exists
if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

// Configuration
const PARALLEL_WORKERS = 5; // Parallel workers for website fetching (Google API allows concurrent requests)
const MAX_RETRIES = 3; // Maximum retries for failed searches

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
  
  // Warning if areas.json has fewer than expected areas (should have 7)
  if (AREAS_CONFIG.length < 7) {
    log(`⚠️  WARNING: areas.json only has ${AREAS_CONFIG.length} areas, expected 7.`);
    log(`   This will cause the script to only query ${AREAS_CONFIG.length} area(s).`);
    log(`   Run 'node scripts/create-areas.js' to regenerate areas.json with all 7 areas.`);
  }
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

// Known venues per area that should be found via explicit name-based search
// This ensures 100% coverage for known venues and validates search strategy
// Pattern can be extended to other areas as needed
const KNOWN_VENUES = {
  'Daniel Island': [
    'the dime',
    'Mpishi Restaurant',
    // Note: Other venues are found via generic search, but these might need explicit search
  ],
  // Add other areas as needed
  // 'Mount Pleasant': [...],
  // 'Downtown Charleston': [...],
};

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
        await delay(2000);
      }
    } while (nextPageToken && pageCount < maxPages);
  } catch (error) {
    log(`   ❌ Error fetching pages: ${error.message}`);
    throw error;
  }
  
  return allResults;
}

/**
 * Check if a venue serves alcohol (restaurant, bar, cafe, night_club, brewery, breakfast place, hotel with bar/restaurant)
 * Excludes pure stores, hospitals, schools, etc.
 */
function isAlcoholServingVenue(result) {
  if (!result.types || !Array.isArray(result.types)) {
    return false;
  }
  
  const types = result.types;
  const primaryTypes = types.slice(0, 3); // First 3 types are usually most relevant
  
  // Must have restaurant, bar, cafe, night_club, brewery, wine_bar, breakfast, OR lodging (hotel with bar/restaurant)
  const hasFoodOrLodgingType = primaryTypes.some(type => 
    ['restaurant', 'bar', 'cafe', 'night_club', 'brewery', 'wine_bar', 'breakfast', 'lodging'].includes(type)
  );
  
  if (!hasFoodOrLodgingType) {
    return false;
  }
  
  // Exclude if primarily a store, hospital, school, etc. (but allow hotels/lodging)
  const excludeTypes = ['store', 'supermarket', 'grocery_or_supermarket', 
    'convenience_store', 'hospital', 'university', 'school', 'locality', 'political',
    'electronics_store', 'department_store', 'hardware_store', 'clothing_store'];
  const isExcluded = types.some(type => excludeTypes.includes(type));
  
  // If it has restaurant/bar/breakfast/hotel in primary types AND is not excluded, it serves alcohol
  return !isExcluded;
}

/**
 * Extract zip code from address string or address_components
 */
function extractZipCode(address, addressComponents) {
  // First try address_components (more reliable)
  if (addressComponents && Array.isArray(addressComponents)) {
    const postalCode = addressComponents.find(comp => 
      comp.types && comp.types.includes('postal_code')
    );
    if (postalCode && postalCode.long_name) {
      return postalCode.long_name;
    }
  }
  
  // Fall back to regex extraction from address string
  if (address) {
    const zipMatch = address.match(/\b(\d{5})\b/);
    return zipMatch ? zipMatch[1] : null;
  }
  
  return null;
}

/**
 * Extract sublocality from Google's address_components
 * Returns the sublocality name (e.g., "Mount Pleasant", "Downtown Charleston")
 */
function extractSublocality(addressComponents) {
  if (!addressComponents || !Array.isArray(addressComponents)) {
    return null;
  }
  
  // Try sublocality_level_1 first (most specific)
  const sublocality1 = addressComponents.find(comp => 
    comp.types && comp.types.includes('sublocality_level_1')
  );
  if (sublocality1 && sublocality1.long_name) {
    return sublocality1.long_name;
  }
  
  // Fall back to sublocality
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
 * Google uses various names, we need to normalize them
 */
function mapGoogleSublocalityToArea(googleSublocality) {
  if (!googleSublocality) return null;
  
  const normalized = googleSublocality.toLowerCase().trim();
  
  // Mapping from Google's sublocality names to our area names
  const mapping = {
    // Mount Pleasant variations
    'mount pleasant': 'Mount Pleasant',
    'mt pleasant': 'Mount Pleasant',
    'mt. pleasant': 'Mount Pleasant',
    
    // Downtown Charleston variations
    'downtown charleston': 'Downtown Charleston',
    'downtown': 'Downtown Charleston',
    'historic district': 'Downtown Charleston',
    'french quarter': 'Downtown Charleston',
    
    // James Island
    'james island': 'James Island',
    
    // Sullivan's Island
    "sullivan's island": "Sullivan's Island",
    'sullivans island': "Sullivan's Island",
    
    // North Charleston
    'north charleston': 'North Charleston',
    'n charleston': 'North Charleston',
    
    // West Ashley
    'west ashley': 'West Ashley',
    
    // Daniel Island - Google may not have this as a sublocality, we'll use zip code
    'daniel island': 'Daniel Island',
  };
  
  return mapping[normalized] || null;
}

/**
 * Extract area name from address string (e.g., "North Charleston", "Downtown", "Mount Pleasant")
 * Uses street names and street numbers to determine area
 * Returns the area name if found in the address, null otherwise
 */
function extractAreaFromAddress(address) {
  if (!address) return null;
  
  const addressLower = address.toLowerCase();
  
  // Map explicit area names in address (most reliable)
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
  
  // Check for explicit area names first (prioritize longer matches)
  const sortedExplicit = Object.keys(explicitAreaKeywords).sort((a, b) => b.length - a.length);
  for (const keyword of sortedExplicit) {
    if (addressLower.includes(keyword)) {
      return explicitAreaKeywords[keyword];
    }
  }
  
  // Map street names to areas (with number-based logic where needed)
  // Note: Some streets span multiple areas, so we use street numbers
  
  // King Street: Lower numbers (1-2000) = Downtown, Higher (2000+) = West Ashley
  // This is authoritative - don't override with bounds for these street numbers
  // Note: Extended range to 2000 based on actual venue locations (e.g., 1505, 1503, 1337 are Downtown)
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
  
  // East Bay Street: Primarily Downtown Charleston (authoritative - override sublocality)
  // This is authoritative - don't override with bounds for these street numbers
  if (addressLower.includes('east bay street') || addressLower.includes('east bay st')) {
    return 'Downtown Charleston';
  }
  
  // Meeting Street: Lower numbers (1-400) = Downtown, Higher (>400) = North Charleston
  // This is authoritative - don't override with bounds for these street numbers
  if (addressLower.includes('meeting street')) {
    const numberMatch = address.match(/(\d+)\s+meeting street/i);
    if (numberMatch) {
      const streetNumber = parseInt(numberMatch[1]);
      if (streetNumber >= 1 && streetNumber <= 400) {
        return 'Downtown Charleston';
      } else if (streetNumber > 400) {
        return 'North Charleston';
      }
    }
  }
  
  // Pittsburgh Avenue: North Charleston
  if (addressLower.includes('pittsburgh avenue') || addressLower.includes('pittsburgh ave')) {
    return 'North Charleston';
  }
  
  // Clements Ferry Road: Daniel Island (when zip code 29492 matches)
  // Note: This will be validated with zip code in findAreaForVenue, but we return it here
  // so it can be checked against zip code 29492
  if (addressLower.includes('clements ferry') || addressLower.includes('clements ferry road')) {
    // Return Daniel Island - will be validated with zip code in findAreaForVenue
    return 'Daniel Island';
  }
  
  if (addressLower.includes('island park') || addressLower.includes('island park drive')) {
    return 'Daniel Island';
  }
  
  if (addressLower.includes('seven farms') || addressLower.includes('seven farms drive')) {
    return 'Daniel Island';
  }
  
  // Point Hope Pkwy: North Charleston (exclude from Daniel Island)
  if (addressLower.includes('point hope') || addressLower.includes('point hope pkwy')) {
    return 'North Charleston';
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
 * Find which area a venue belongs to using Google's address_components (sublocality)
 * Falls back to address string parsing, zip code matching, then bounds checking
 */
function findAreaForVenue(lat, lng, address, addressComponents, areasConfig) {
  // EXCLUSION: Point Hope addresses should NEVER be assigned to Daniel Island
  // Check this first before any other logic
  const addressLower = address.toLowerCase();
  if (addressLower.includes('point hope') || addressLower.includes('point hope pkwy')) {
    // Point Hope is in North Charleston, exclude from Daniel Island
    const northCharlestonArea = areasConfig.find(a => a.name === 'North Charleston');
    if (northCharlestonArea) {
      logVerbose(`  ✅ Point Hope address excluded from Daniel Island, assigned to North Charleston`);
      return 'North Charleston';
    }
  }
  
  // Priority 1: Use Google's sublocality (most reliable)
  const googleSublocality = extractSublocality(addressComponents);
  if (googleSublocality) {
    const mappedArea = mapGoogleSublocalityToArea(googleSublocality);
    if (mappedArea) {
      // Verify the mapped area exists in our config
      const areaExists = areasConfig.find(a => a.name === mappedArea);
      if (areaExists) {
        logVerbose(`  ✅ Area from Google sublocality: ${googleSublocality} → ${mappedArea}`);
        return mappedArea;
      }
    } else {
      logVerbose(`  ⚠️  Google sublocality "${googleSublocality}" not mapped to any area`);
    }
  }
  
  // Priority 2: Parse address string for area name (e.g., "North Charleston", "Downtown")
  // For known streets with number-based logic (King Street, Meeting Street), this is authoritative
  const addressArea = extractAreaFromAddress(address);
  if (addressArea) {
    const areaExists = areasConfig.find(a => a.name === addressArea);
    if (areaExists) {
      // For street number-based assignments (King Street, Meeting Street, East Bay Street), trust the address
      // For Clements Ferry Road, validate with zip code first
      // For other address keywords, validate coordinates are in bounds
      const isStreetNumberBased = (address.toLowerCase().includes('king street') || 
                                   address.toLowerCase().includes('meeting street'));
      const isEastBayStreet = address.toLowerCase().includes('east bay street') || 
                              address.toLowerCase().includes('east bay st');
      const isClementsFerry = address.toLowerCase().includes('clements ferry');
      const isPointHope = address.toLowerCase().includes('point hope') || 
                          address.toLowerCase().includes('point hope pkwy');
      
      // East Bay Street, Point Hope Pkwy, and street number-based assignments are authoritative
      if (isStreetNumberBased || isEastBayStreet || isPointHope) {
        logVerbose(`  ✅ Area from address string: "${addressArea}" (street-based, authoritative)`);
        return addressArea;
      }
      
      // Clements Ferry Road: validate with zip code 29492
      if (isClementsFerry && addressArea === 'Daniel Island') {
        const zipCode = extractZipCode(address, addressComponents);
        if (zipCode === '29492') {
          logVerbose(`  ✅ Area from address string: "${addressArea}" (Clements Ferry Road with zip 29492, authoritative)`);
          return addressArea;
        } else {
          logVerbose(`  ⚠️  Clements Ferry Road but zip code is ${zipCode}, not 29492 - will check bounds`);
        }
      }
      
      // For other address keywords, validate coordinates are in bounds
      if (isInBounds(lat, lng, areaExists)) {
        logVerbose(`  ✅ Area from address string: "${addressArea}" (validated with coordinates)`);
        return addressArea;
      } else {
        logVerbose(`  ⚠️  Address says "${addressArea}" but coordinates (${lat}, ${lng}) are outside bounds`);
      }
    }
  }
  
  // Priority 3: Check zip codes for ALL areas (not just Daniel Island)
  const zipCode = extractZipCode(address, addressComponents);
  if (zipCode) {
    for (const area of areasConfig) {
      if (area.zipCodes && Array.isArray(area.zipCodes) && area.zipCodes.includes(zipCode)) {
        // For Daniel Island, zip code 29492 is definitive (includes Clements Ferry Road extensions)
        // Allow a larger buffer (0.05 degrees ≈ 5.5km) for Clements Ferry Road venues
        if (area.name === 'Daniel Island' && zipCode === '29492') {
          const buffer = 0.05; // ~5.5km buffer for Clements Ferry Road (increased from 0.03)
          const { south, west, north, east } = area.bounds;
          const inBufferedBounds = lat >= (south - buffer) && lat <= (north + buffer) && 
                                   lng >= (west - buffer) && lng <= (east + buffer);
          if (inBufferedBounds) {
            logVerbose(`  ✅ Area from zip code ${zipCode}: ${area.name} (zip code 29492 is definitive for Daniel Island, including Clements Ferry Road)`);
            return area.name;
          } else {
            logVerbose(`  ⚠️  Zip code ${zipCode} matches ${area.name} but coordinates (${lat}, ${lng}) are too far outside bounds`);
          }
        } else {
          // For other areas, validate coordinates are in bounds (zip codes can span areas)
          if (isInBounds(lat, lng, area)) {
            logVerbose(`  ✅ Area from zip code ${zipCode}: ${area.name} (validated with coordinates)`);
            return area.name;
          } else {
            logVerbose(`  ⚠️  Zip code ${zipCode} matches ${area.name} but coordinates (${lat}, ${lng}) are outside bounds`);
          }
        }
      }
    }
  }
  
  // Priority 4: Fall back to bounds checking (only if all above failed)
  // Sort areas by size (smaller/more specific areas first) to avoid incorrect assignments
  const sortedAreas = [...areasConfig].sort((a, b) => {
    const areaA = (a.bounds ? (a.bounds.north - a.bounds.south) * (a.bounds.east - a.bounds.west) : Infinity);
    const areaB = (b.bounds ? (b.bounds.north - b.bounds.south) * (b.bounds.east - b.bounds.west) : Infinity);
    return areaA - areaB; // Smaller areas first
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

// Extract venue data from Google Places result
function extractVenueData(result, areaName) {
  // Extract address_components if available
  const addressComponents = result.address_components || null;
  
  // Build address string (for backward compatibility)
  const address = result.vicinity || result.formatted_address || 'Address not available';
  
  return {
    id: result.place_id,
    name: result.name || 'Unknown',
    address: address,
    addressComponents: addressComponents, // Store address_components for area detection
    lat: result.geometry?.location?.lat || null,
    lng: result.geometry?.location?.lng || null,
    website: result.website || null,
    types: result.types || [],
    area: areaName, // Will be reassigned based on Google's sublocality or zip code
  };
}

// Fetch place details from Google Places Details API
async function fetchPlaceDetails(placeId, retries = MAX_RETRIES) {
  // Request address_components in the fields to get sublocality data
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,website,formatted_address,address_components&key=${GOOGLE_MAPS_API_KEY}`;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
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
      if (attempt === retries) {
        throw error;
      }
      // Exponential backoff for retries
      await delay(2000 * (attempt + 1));
    }
  }
}

/**
 * Find website using free Google search (fallback when Places API doesn't have website)
 * Uses Google Custom Search API if available, otherwise returns null
 */
async function findWebsiteViaGoogleSearch(venueName, address) {
  const GOOGLE_SEARCH_API_KEY = process.env.GOOGLE_SEARCH_API_KEY;
  const GOOGLE_SEARCH_ENGINE_ID = process.env.GOOGLE_SEARCH_ENGINE_ID;
  
  if (!GOOGLE_SEARCH_API_KEY || !GOOGLE_SEARCH_ENGINE_ID) {
    return null;
  }
  
  try {
    // Build search query: "{venue name}" "{address}" site:
    const query = `"${venueName}" "${address}"`;
    const encodedQuery = encodeURIComponent(query);
    const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_SEARCH_API_KEY}&cx=${GOOGLE_SEARCH_ENGINE_ID}&q=${encodedQuery}&num=3`;
    
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json();
    
    if (data.items && data.items.length > 0) {
      // Look for official website (usually first result or one with venue name in title)
      for (const item of data.items) {
        const link = item.link;
        const title = (item.title || '').toLowerCase();
        const venueNameLower = venueName.toLowerCase();
        
        // Prefer results that have venue name in title and look like official websites
        if (title.includes(venueNameLower) && 
            (link.includes('.com') || link.includes('.org') || link.includes('.net'))) {
          // Exclude social media and review sites
          if (!link.includes('facebook.com') && 
              !link.includes('yelp.com') && 
              !link.includes('tripadvisor.com') &&
              !link.includes('google.com/maps')) {
            logVerbose(`  🔍 Google search found website: ${link}`);
            return link;
          }
        }
      }
      
      // Fallback: return first result if it looks like a website
      const firstLink = data.items[0].link;
      if (firstLink.includes('.com') || firstLink.includes('.org') || firstLink.includes('.net')) {
        if (!firstLink.includes('facebook.com') && 
            !firstLink.includes('yelp.com') && 
            !firstLink.includes('tripadvisor.com')) {
          logVerbose(`  🔍 Google search found website (fallback): ${firstLink}`);
          return firstLink;
        }
      }
    }
    
    return null;
  } catch (error) {
    logVerbose(`  ⚠️  Google search fallback failed: ${error.message}`);
    return null;
  }
}

/**
 * Find website for a venue with fallback strategy
 * 1. Try Places Details API (already called, but retry if needed)
 * 2. Try Google search fallback
 */
async function findVenueWebsite(venue, retries = MAX_RETRIES) {
  // First try Places Details API
  try {
    const details = await fetchPlaceDetails(venue.id, retries);
    if (details.website) {
      return details.website;
    }
  } catch (error) {
    logVerbose(`  ⚠️  Places API failed for ${venue.name}: ${error.message}`);
  }
  
  // Fallback to Google search
  if (venue.name && venue.address) {
    const searchResult = await findWebsiteViaGoogleSearch(venue.name, venue.address);
    if (searchResult) {
      return searchResult;
    }
  }
  
  return null;
}

/**
 * Generate grid points for an area (4 overlapping quadrants)
 * Returns array of {lat, lng, radius, name} objects
 */
function generateGridPoints(areaConfig) {
  const { center, radiusMeters } = areaConfig;
  const centerLat = center.lat;
  const centerLng = center.lng;
  
  // Use 60% of original radius for each quadrant (overlaps for coverage)
  const quadrantRadius = Math.floor(radiusMeters * 0.6);
  
  // Calculate offsets for 4 quadrants (NE, NW, SE, SW)
  const latOffset = (areaConfig.bounds.north - areaConfig.bounds.south) * 0.25;
  const lngOffset = (areaConfig.bounds.east - areaConfig.bounds.west) * 0.25;
  
  return [
    { lat: centerLat + latOffset, lng: centerLng + lngOffset, radius: quadrantRadius, name: 'NE' },
    { lat: centerLat + latOffset, lng: centerLng - lngOffset, radius: quadrantRadius, name: 'NW' },
    { lat: centerLat - latOffset, lng: centerLng + lngOffset, radius: quadrantRadius, name: 'SE' },
    { lat: centerLat - latOffset, lng: centerLng - lngOffset, radius: quadrantRadius, name: 'SW' },
  ];
}

/**
 * Fetch venues using Text Search API (complements Nearby Search)
 * @param {string} areaName - Area name (e.g., "Daniel Island")
 * @param {string} venueType - Venue type (e.g., "restaurant") OR custom query text
 * @param {number} maxPages - Maximum pages to fetch (default: 3)
 * @param {boolean} isCustomQuery - If true, venueType is used as direct query text
 */
async function fetchTextSearch(areaName, venueType, maxPages = 3, isCustomQuery = false) {
  const allResults = [];
  let nextPageToken = null;
  let pageCount = 0;
  
  try {
    let query;
    if (isCustomQuery) {
      // Direct query text (for name-based searches)
      query = encodeURIComponent(`${venueType} ${areaName} Charleston SC`);
    } else {
      // Map venue types to search-friendly terms
      const searchTerms = {
        'bar': 'bars',
        'restaurant': 'restaurants',
        'brewery': 'breweries',
        'night_club': 'night clubs',
        'wine_bar': 'wine bars',
        'breakfast': 'breakfast restaurants'
      };
      
      const searchTerm = searchTerms[venueType] || venueType;
      query = encodeURIComponent(`${searchTerm} in ${areaName} Charleston SC`);
    }
    
    do {
      let url;
      if (nextPageToken) {
        // Use next_page_token for pagination
        url = `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${nextPageToken}&key=${GOOGLE_MAPS_API_KEY}`;
      } else {
        // Initial request
        url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&key=${GOOGLE_MAPS_API_KEY}`;
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
        await delay(2000);
      }
    } while (nextPageToken && pageCount < maxPages);
  } catch (error) {
    log(`   ❌ Error in text search: ${error.message}`);
    throw error;
  }
  
  return allResults;
}

/**
 * Fetch known venues by explicit name-based search
 * This ensures 100% coverage for known venues that might not be found by generic searches
 * @param {string} areaName - Area name (e.g., "Daniel Island")
 * @param {string[]} knownVenueNames - Array of venue names to search for
 * @returns {Promise<Array>} Array of venue results from Google Places API
 */
async function fetchKnownVenuesByName(areaName, knownVenueNames) {
  if (!knownVenueNames || knownVenueNames.length === 0) {
    return [];
  }
  
  const allResults = [];
  
  logVerbose(`  Known venues search: Searching for ${knownVenueNames.length} known venue(s) in ${areaName}`);
  
  for (const venueName of knownVenueNames) {
    try {
      // Use explicit name-based search: "{venueName} {areaName} Charleston SC"
      const results = await fetchTextSearch(areaName, venueName, 1, true); // maxPages=1, isCustomQuery=true
      
      // Filter results by name similarity (fuzzy match)
      const matched = results.filter(r => {
        if (!r.name) return false;
        const resultName = r.name.toLowerCase();
        const searchName = venueName.toLowerCase();
        
        // Check if result name contains search name or vice versa
        return resultName.includes(searchName) || searchName.includes(resultName);
      });
      
      if (matched.length > 0) {
        allResults.push(...matched);
        logVerbose(`    ✅ Found: "${venueName}" → ${matched.length} result(s): ${matched.map(r => r.name).join(', ')}`);
      } else {
        logVerbose(`    ⚠️  Not found: "${venueName}" (may not exist in Google Places API)`);
      }
      
      // Small delay between known venue searches
      await delay(500);
    } catch (error) {
      logVerbose(`    ❌ Error searching for "${venueName}": ${error.message}`);
      // Continue with other venues even if one fails
    }
  }
  
  return allResults;
}

// Main execution
(async () => {
  // Parse command-line arguments for area filtering
  const args = process.argv.slice(2);
  let areaFilter = null;
  if (args.length > 0) {
    areaFilter = args[0].trim();
    log(`🔍 Area filter specified: "${areaFilter}"`);
    log('');
  }
  
  // Filter areas if area filter is specified
  let areasToProcess = AREAS_CONFIG;
  if (areaFilter) {
    const filterLower = areaFilter.toLowerCase();
    areasToProcess = AREAS_CONFIG.filter(area => {
      const areaName = (area.name || '').toLowerCase();
      const displayName = (area.displayName || '').toLowerCase();
      return areaName.includes(filterLower) || displayName.includes(filterLower);
    });
    
    if (areasToProcess.length === 0) {
      log(`❌ Error: No areas found matching "${areaFilter}"`);
      log(`   Available areas: ${AREAS_CONFIG.map(a => a.name).join(', ')}`);
      process.exit(1);
    }
    
    log(`✅ Filtered to ${areasToProcess.length} area(s): ${areasToProcess.map(a => a.name).join(', ')}`);
    log('');
  }
  
  log('🍺 Starting venue seeding using areas from areas.json...');
  log('');
  
  log(`📍 Processing ${areasToProcess.length} area(s):`);
  areasToProcess.forEach(area => {
    log(`   ${area.displayName || area.name}:`);
    log(`     Center: ${area.center.lat}, ${area.center.lng}`);
    log(`     Radius: ${area.radiusMeters}m`);
    log(`     Bounds: lat ${area.bounds.south} to ${area.bounds.north}, lng ${area.bounds.west} to ${area.bounds.east}`);
    if (area.description) {
      log(`     ${area.description}`);
    }
  });
  log('');
  
  // Load existing venues if file exists
  let existingVenues = [];
  const seenPlaceIds = new Set();
  const beforeVenueCounts = {}; // Track before counts per area
  
  if (fs.existsSync(outputFile)) {
    try {
      const existingData = fs.readFileSync(outputFile, 'utf8');
      existingVenues = JSON.parse(existingData);
      existingVenues.forEach(v => {
        if (v.id) seenPlaceIds.add(v.id);
        // Count venues per area before
        const area = v.area || 'Unknown';
        beforeVenueCounts[area] = (beforeVenueCounts[area] || 0) + 1;
      });
      log(`📖 Loaded ${existingVenues.length} existing venues from ${path.resolve(outputFile)}`);
      log(`   (will append new venues without overwriting)\n`);
      // Log before counts per area
      log(`Before venue counts per area:`);
      for (const [area, count] of Object.entries(beforeVenueCounts).sort((a, b) => b[1] - a[1])) {
        log(`   ${area}: ${count} venues`);
      }
      log('');
    } catch (error) {
      log(`⚠️  Error loading existing venues: ${error.message}`);
      log(`   (starting fresh)\n`);
    }
  } else {
    log(`📄 No existing venues.json found, creating new file\n`);
  }
  
  const areaNewVenues = {}; // Track new venues per area
  const newVenues = [];
  let totalQueries = 0;
  let successfulQueries = 0;
  let failedQueries = 0;
  
  // Process each area
  for (const areaConfig of areasToProcess) {
    const areaName = areaConfig.name;
    
    // Initialize area tracking
    if (!areaNewVenues[areaName]) {
      areaNewVenues[areaName] = [];
    }
    
    log(`\n📍 Processing ${areaConfig.displayName || areaName}...`);
    
    // Generate grid points for this area (4 overlapping quadrants)
    const gridPoints = generateGridPoints(areaConfig);
    log(`   🗺️  Using grid approach: ${gridPoints.length} quadrants (${gridPoints[0].radius}m radius each)`);
    
    for (const venueType of VENUE_TYPES) {
      totalQueries++;
      const queryName = `${areaName} (${venueType})`;
      
      // Collect results from all grid points
      const allNearbyResults = [];
      
      try {
        // Terminal: Simple message
        log(`🔍 Querying ${queryName} (grid search + text search)...`);
        // File: Detailed query information
        logVerbose(`Query details: Area=${areaName} | Type=${venueType} | Grid points=${gridPoints.length} | Original radius=${areaConfig.radiusMeters}m`);
        
        // 1. Grid-based Nearby Search (search each quadrant)
        for (let i = 0; i < gridPoints.length; i++) {
          const gridPoint = gridPoints[i];
          logVerbose(`  Grid point ${i + 1}/${gridPoints.length} (${gridPoint.name}): Center=(${gridPoint.lat}, ${gridPoint.lng}) | Radius=${gridPoint.radius}m`);
          
          const gridResults = await fetchAllPages(
            areaName,
            venueType,
            gridPoint.lat,
            gridPoint.lng,
            gridPoint.radius
          );
          
          allNearbyResults.push(...gridResults);
          logVerbose(`    Found ${gridResults.length} results from grid point ${gridPoint.name}`);
          
          // Small delay between grid point queries
          if (i < gridPoints.length - 1) {
            await delay(500);
          }
        }
        
        // 2. Text Search API (complement to Nearby Search)
        logVerbose(`  Text Search: "${venueType} in ${areaName}"`);
        const textSearchResults = await fetchTextSearch(areaName, venueType);
        logVerbose(`    Found ${textSearchResults.length} results from Text Search`);
        
        // 3. Known venues search (explicit name-based search for known venues)
        // This ensures 100% coverage for known venues that might not be found by generic searches
        let knownVenueResults = [];
        if (KNOWN_VENUES[areaName] && KNOWN_VENUES[areaName].length > 0) {
          knownVenueResults = await fetchKnownVenuesByName(areaName, KNOWN_VENUES[areaName]);
          logVerbose(`    Found ${knownVenueResults.length} results from Known Venues Search`);
        }
        
        // Combine all results (grid search + text search + known venues search)
        const allResults = [...allNearbyResults, ...textSearchResults, ...knownVenueResults];
        
        // Filter for alcohol-serving venues
        const alcoholServingResults = allResults.filter(isAlcoholServingVenue);
        logVerbose(`  Filtered: ${allResults.length} unique results → ${alcoholServingResults.length} alcohol-serving venues (excluded ${allResults.length - alcoholServingResults.length} stores/hospitals/etc.)`);
        
        // Deduplicate by place_id
        const uniqueResults = [];
        const seenResultIds = new Set();
        const skippedCounts = { outOfBounds: 0, duplicate: 0, notAlcoholServing: 0 };
        
        for (const result of alcoholServingResults) {
          if (!result.place_id) continue;
          
          // Skip if we've seen this place_id
          if (seenResultIds.has(result.place_id) || seenPlaceIds.has(result.place_id)) {
            skippedCounts.duplicate++;
            continue;
          }
          
          seenResultIds.add(result.place_id);
          
          // Extract venue data
          const venueData = extractVenueData(result, areaName);
          
          const lat = venueData.lat;
          const lng = venueData.lng;
          const address = venueData.address;
          const addressComponents = venueData.addressComponents;
          
          // Find which area this venue actually belongs to using Google's sublocality
          const actualArea = findAreaForVenue(lat, lng, address, addressComponents, AREAS_CONFIG);
          
          if (!actualArea) {
            skippedCounts.outOfBounds++;
            logVerbose(`  Skipped (no area match): ${venueData.name} at (${lat}, ${lng}) - ${address}`);
            continue;
          }
          
          // If area filter is specified, skip venues that don't belong to filtered areas
          if (areaFilter && !areasToProcess.find(a => a.name === actualArea)) {
            skippedCounts.outOfBounds++;
            logVerbose(`  Skipped (outside filtered area): ${venueData.name} at (${lat}, ${lng}) - ${address} (assigned to ${actualArea}, filter is ${areaFilter})`);
            continue;
          }
          
          // Update venue with correct area
          venueData.area = actualArea;
          
          // Log found venue (verbose only)
          logVerbose(`  Found venue: ${venueData.name} | Place ID: ${result.place_id} | Location: (${lat}, ${lng}) | Area: ${actualArea} | Zip: ${extractZipCode(address, addressComponents) || 'N/A'} | Address: ${address} | Types: ${(result.types || []).slice(0, 5).join(', ')}`);
          
          uniqueResults.push(venueData);
        }
        
        // Add new venues (those not in existingVenues)
        let addedCount = 0;
        const addedNames = [];
        
        for (const venueData of uniqueResults) {
          if (!seenPlaceIds.has(venueData.id)) {
            newVenues.push(venueData);
            seenPlaceIds.add(venueData.id);
            
            // Track by actual area
            const venueArea = venueData.area || 'Unknown';
            if (!areaNewVenues[venueArea]) {
              areaNewVenues[venueArea] = [];
            }
            areaNewVenues[venueArea].push(venueData);
            
            addedCount++;
            if (addedNames.length < 10) {
              addedNames.push(venueData.name);
            }
          }
        }
        
        if (skippedCounts.outOfBounds > 0 || skippedCounts.notAlcoholServing > 0) {
          logVerbose(`  Skipped: ${skippedCounts.outOfBounds} out of bounds, ${skippedCounts.duplicate} duplicates`);
        }
        
        // Terminal: Simple message
        const knownVenuesCount = knownVenueResults.length;
        log(`   ✅ Found ${uniqueResults.length} unique results (${allNearbyResults.length} from grid, ${textSearchResults.length} from text search${knownVenuesCount > 0 ? `, ${knownVenuesCount} from known venues search` : ''}, ${addedCount} new venues)`);
        if (addedCount > 0 && addedNames.length <= 5) {
          log(`   📝 Added: ${addedNames.join(', ')}`);
        } else if (addedCount > 0) {
          log(`   📝 Added: ${addedNames.slice(0, 5).join(', ')} and ${addedCount - 5} more`);
        }
        // File: Detailed summary
        logVerbose(`  Query complete: Total results=${allResults.length} | Unique results=${uniqueResults.length} | New venues=${addedCount} | Area=${areaName} | Type=${venueType}`);
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
  
  // Combine existing and new venues, deduplicate by id (using Map for safety)
  const allVenuesMap = new Map();
  
  // Add existing venues first (preserves all existing venues)
  existingVenues.forEach(venue => {
    if (venue.id) {
      allVenuesMap.set(venue.id, venue);
    }
  });
  
  // Add/update with new venues (won't duplicate because seenPlaceIds was checked)
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
  
  // Fetch website details for new venues missing websites (with parallel processing)
  if (newVenues.length > 0) {
    log(`\n🌐 Fetching website details for new venues (with parallel processing and Google search fallback)...\n`);
    const venuesNeedingWebsites = newVenues.filter(v => !v.website || v.website.trim() === '');
    const totalNeedingWebsites = venuesNeedingWebsites.length;
    let detailsFetched = 0;
    let websitesFound = 0;
    let detailsErrors = 0;
    let googleSearchFound = 0;
    
    if (totalNeedingWebsites > 0) {
      // Parallel processing for website fetching
      const workers = [];
      
      async function fetchWebsiteWithStats(venue, index) {
        const progress = `[${index + 1}/${totalNeedingWebsites}]`;
        
        try {
          // Verbose: Log search details
          logVerbose(`Searching website for: ${venue.name} | Place ID: ${venue.id} | Area: ${venue.area} | Location: (${venue.lat}, ${venue.lng}) | Address: ${venue.address || 'N/A'}`);
          
          // Try Places API first
          let details = null;
          try {
            details = await fetchPlaceDetails(venue.id);
            detailsFetched++;
            
            if (details.website) {
              venue.website = details.website;
              websitesFound++;
              
              // Update address_components if we got them from details API
              if (details.address_components && !venue.addressComponents) {
                venue.addressComponents = details.address_components;
              }
              
              if (details.formatted_address && (!venue.address || venue.address === 'Address not available')) {
                venue.address = details.formatted_address;
              }
              
              // Terminal: Simple message
              log(`${progress} ✅ ${venue.name}: Found website (Places API)`);
              // File: Detailed message
              logVerbose(`  -> Website found: ${details.website} | Updated address: ${venue.address} | Area: ${venue.area} | Coordinates: (${venue.lat}, ${venue.lng})`);
              return;
            }
          } catch (error) {
            logVerbose(`  ⚠️  Places API failed for ${venue.name}: ${error.message}`);
          }
          
          // Fallback to Google search
          if (!venue.website && venue.name && venue.address) {
            const searchWebsite = await findWebsiteViaGoogleSearch(venue.name, venue.address);
            if (searchWebsite) {
              venue.website = searchWebsite;
              websitesFound++;
              googleSearchFound++;
              log(`${progress} ✅ ${venue.name}: Found website (Google search)`);
              logVerbose(`  -> Website found via Google search: ${searchWebsite} | Area: ${venue.area}`);
              return;
            }
          }
          
          // No website found
          log(`${progress} ⬜ ${venue.name}: No website available`);
          logVerbose(`  -> No website found | Area: ${venue.area} | Coordinates: (${venue.lat}, ${venue.lng})`);
          
        } catch (error) {
          detailsErrors++;
          log(`${progress} ❌ ${venue.name}: Error - ${error.message}`);
          logVerbose(`  -> Error: ${error.message} | Area: ${venue.area}`);
        }
      }
      
      // Process venues in parallel batches
      for (let i = 0; i < venuesNeedingWebsites.length; i++) {
        const venue = venuesNeedingWebsites[i];
        
        // Start worker
        const workerPromise = fetchWebsiteWithStats(venue, i).finally(() => {
          // Remove self from workers array when done
          const index = workers.indexOf(workerPromise);
          if (index > -1) {
            workers.splice(index, 1);
          }
        });
        workers.push(workerPromise);
        
        // Wait if we have too many active workers
        if (workers.length >= PARALLEL_WORKERS) {
          await Promise.race(workers);
        }
        
        // Small delay between starting workers (rate limiting)
        if (i < venuesNeedingWebsites.length - 1) {
          await delay(200); // Small delay to avoid overwhelming APIs
        }
      }
      
      // Wait for all remaining workers to complete
      await Promise.all(workers);
      
      // Progress update
      log(`\n🌐 Website fetching complete:`);
      log(`   ✅ Processed: ${totalNeedingWebsites} venues`);
      log(`   🌐 Found ${websitesFound} websites (${websitesFound - googleSearchFound} from Places API, ${googleSearchFound} from Google search)`);
      log(`   ❌ Errors: ${detailsErrors}\n`);
    }
  }
  
  // Create backup before writing
  if (fs.existsSync(outputFile)) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5); // Format: 2026-01-12T10-30-45
    const backupFile = path.join(backupDir, `venues-${timestamp}.json`);
    try {
      fs.copyFileSync(outputFile, backupFile);
      log(`\n💾 Created backup: ${path.resolve(backupFile)}`);
    } catch (error) {
      log(`\n⚠️  Warning: Failed to create backup: ${error.message}`);
    }
  }
  
  // Write to reporting/venues.json (primary location - static file, incremental updates)
  try {
    fs.writeFileSync(outputFile, JSON.stringify(allVenues, null, 2), 'utf8');
    log(`\n📝 Successfully wrote ${allVenues.length} total venues to ${path.resolve(outputFile)}`);
    
    // Also write to data/venues.json for backwards compatibility with other scripts
    fs.writeFileSync(dataVenuesFile, JSON.stringify(allVenues, null, 2), 'utf8');
    log(`   📋 Also wrote to ${path.resolve(dataVenuesFile)} for backwards compatibility`);
    
    log(`   ✨ Added ${newVenues.length} new venues across ${areasToProcess.length} area(s)`);
    for (const areaConfig of areasToProcess) {
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
  
  // Detailed breakdown by area and type
  log(`\n📋 Detailed breakdown by area and type:\n`);
  for (const areaConfig of areasToProcess) {
    const areaName = areaConfig.name;
    const areaVenues = allVenues.filter(v => v.area === areaName);
    
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
      
      log(`   ${areaConfig.displayName || areaName} (${areaVenues.length} total):`);
      const sortedAreaTypes = Object.entries(areaTypeCounts).sort((a, b) => b[1] - a[1]);
      for (const [type, count] of sortedAreaTypes) {
        log(`     ${type}: ${count}`);
      }
      log('');
    }
  }
  
  log(`✨ Venue seeding complete for all areas from areas.json!`);
  log(`Done! Log saved to ${logPath}`);
})();
