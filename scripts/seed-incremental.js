/**
 * Step 2: Incremental venue seeding and website enrichment
 * 
 * This script runs nightly or on-demand to:
 * - Append new venues from Google Places API
 * - Enrich missing websites using Google Text Search
 * - Write missing websites to CSV for manual review
 * 
 * Run with: node scripts/seed-incremental.js
 */

const fs = require('fs');
const path = require('path');

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
  console.error('❌ Error: NEXT_PUBLIC_GOOGLE_MAPS_KEY or GOOGLE_PLACES_KEY must be set in .env');
  process.exit(1);
}

// Paths
const dataDir = path.join(__dirname, '..', 'data');
const venuesFile = path.join(dataDir, 'venues.json');
const areasConfigFile = path.join(dataDir, 'areas.json');
const missingWebsitesFile = path.join(dataDir, 'venue-website-not-found.csv');

// Venue types to query (alcohol-serving establishments)
const VENUE_TYPES = [
  'bar',
  'restaurant',
  'brewery',
  'night_club',
  'wine_bar'
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
  
  console.log(`✅ Loaded ${AREAS_CONFIG.length} areas from ${path.resolve(areasConfigFile)}`);
} catch (error) {
  console.error(`❌ Error loading areas.json: ${error.message}`);
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
      
      // Wait between requests to handle next_page_token (2s delay)
      if (nextPageToken) {
        await delay(2000);
      }
    } while (nextPageToken && pageCount < maxPages);
    
    return allResults;
  } catch (error) {
    console.error(`   ⚠️  Error fetching pages: ${error.message}`);
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

// Search for website using Google Text Search API
async function searchWebsite(name, address) {
  // Use Google Places Text Search API to find the venue's website
  const query = encodeURIComponent(`${name} ${address} official website`);
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&key=${GOOGLE_MAPS_API_KEY}`;
  
  try {
    const response = await makeRequest(url);
    
    if (response.status === 'OK' && response.results && response.results.length > 0) {
      // Get the first result's place_id and fetch details
      const placeId = response.results[0].place_id;
      const details = await fetchPlaceDetails(placeId);
      return details.website;
    }
    
    return null;
  } catch (error) {
    console.error(`   ⚠️  Error searching website for ${name}: ${error.message}`);
    return null;
  }
}

// Write CSV file for venues with missing websites
function writeMissingWebsitesCSV(venues) {
  if (venues.length === 0) {
    return;
  }
  
  // CSV header
  const csvLines = ['name,address,area'];
  
  // Add data rows
  venues.forEach(venue => {
    const name = (venue.name || '').replace(/,/g, ';'); // Replace commas in name
    const address = (venue.address || '').replace(/,/g, ';'); // Replace commas in address
    const area = (venue.area || '').replace(/,/g, ';'); // Replace commas in area
    csvLines.push(`${name},${address},${area}`);
  });
  
  fs.writeFileSync(missingWebsitesFile, csvLines.join('\n'), 'utf8');
  console.log(`📄 Wrote ${venues.length} venues with missing websites to ${path.resolve(missingWebsitesFile)}`);
}

// Main incremental seeding function
async function seedIncremental() {
  console.log('🔄 Starting incremental venue seeding and website enrichment...\n');
  
  // Load existing venues
  let existingVenues = [];
  const seenPlaceIds = new Set();
  
  if (fs.existsSync(venuesFile)) {
    try {
      const existingData = fs.readFileSync(venuesFile, 'utf8');
      existingVenues = JSON.parse(existingData);
      existingVenues.forEach(v => {
        if (v.id) {
          seenPlaceIds.add(v.id);
        }
      });
      console.log(`📖 Loaded ${existingVenues.length} existing venues from ${path.resolve(venuesFile)}`);
    } catch (error) {
      console.error(`⚠️  Error loading existing venues: ${error.message}`);
      console.log(`   (starting fresh)\n`);
    }
  } else {
    console.log(`📄 No existing venues.json found, creating new file\n`);
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
  
  // Process each area from areas.json
  console.log(`📍 Processing ${AREAS_CONFIG.length} areas:\n`);
  
  for (const areaConfig of AREAS_CONFIG) {
    const areaName = areaConfig.name;
    console.log(`\n📍 Processing ${areaConfig.displayName || areaName}...`);
    
    for (const venueType of VENUE_TYPES) {
      totalQueries++;
      const queryName = `${areaName} (${venueType})`;
      
      try {
        console.log(`🔍 Querying ${queryName}...`);
        
        const results = await fetchAllPages(
          areaName,
          venueType,
          areaConfig.center.lat,
          areaConfig.center.lng,
          areaConfig.radiusMeters
        );
        
        let addedCount = 0;
        for (const result of results) {
          // Skip if already exists (deduplicate by googlePlaceId)
          if (seenPlaceIds.has(result.place_id)) {
            continue;
          }
          
          // Add new venue
          seenPlaceIds.add(result.place_id);
          const venue = extractVenueData(result, areaName);
          newVenues.push(venue);
          addedCount++;
          
          // Track venues needing website
          if (!venue.website || venue.website.trim() === '') {
            venuesNeedingWebsite.push(venue);
          }
        }
        
        console.log(`   ✅ Found ${results.length} results (${addedCount} new venues)`);
        successfulQueries++;
        
        await delay(1000); // Delay between queries
      } catch (error) {
        console.error(`   ❌ Error querying ${queryName}: ${error.message}`);
        failedQueries++;
      }
    }
  }
  
  console.log(`\n📊 Processed ${AREAS_CONFIG.length} areas`);
  console.log(`   ✅ Added ${newVenues.length} new venues`);
  
  // Enrich missing websites for new venues
  if (venuesNeedingWebsite.length > 0) {
    console.log(`\n🌐 Enriching missing websites for ${venuesNeedingWebsite.length} venues...\n`);
    
    for (let i = 0; i < venuesNeedingWebsite.length; i++) {
      const venue = venuesNeedingWebsite[i];
      const progress = `[${i + 1}/${venuesNeedingWebsite.length}]`;
      
      try {
        // First try Place Details API
        const details = await fetchPlaceDetails(venue.id);
        if (details.website) {
          venue.website = details.website;
          websitesEnriched++;
          console.log(`${progress} ✅ ${venue.name}: Found website via Place Details`);
        } else {
          // Try Text Search API
          await delay(2000); // 2s delay between searches
          const website = await searchWebsite(venue.name, venue.address);
          if (website) {
            venue.website = website;
            websitesEnriched++;
            console.log(`${progress} ✅ ${venue.name}: Found website via Text Search`);
          } else {
            console.log(`${progress} ⬜ ${venue.name}: No website found`);
          }
        }
      } catch (error) {
        console.log(`${progress} ❌ ${venue.name}: ${error.message}`);
      }
      
      // Delay between venue processing
      if (i < venuesNeedingWebsite.length - 1) {
        await delay(2000); // 2s delay
      }
    }
    
    console.log(`\n🌐 Website enrichment complete:`);
    console.log(`   ✅ Enriched ${websitesEnriched} missing websites`);
  }
  
  // Find remaining venues with missing websites (after enrichment)
  const stillMissingWebsites = [];
  
  // Check new venues
  newVenues.forEach(venue => {
    if (!venue.website || venue.website.trim() === '') {
      stillMissingWebsites.push(venue);
    }
  });
  
  // Check existing venues that might need enrichment (optional - can be enabled)
  // For now, only check new venues
  
  // Write CSV for venues with missing websites
  if (stillMissingWebsites.length > 0) {
    writeMissingWebsitesCSV(stillMissingWebsites);
    console.log(`📄 Wrote ${stillMissingWebsites.length} venues with missing websites to CSV for manual review`);
  } else {
    console.log(`✅ All venues have websites - no CSV file needed`);
  }
  
  // Combine existing and new venues, deduplicate by id
  const allVenuesMap = new Map();
  
  // Add existing venues first
  existingVenues.forEach(venue => {
    if (venue.id) {
      allVenuesMap.set(venue.id, venue);
    }
  });
  
  // Add/update with new venues
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
    console.log(`\n📝 Successfully wrote ${allVenues.length} total venues to ${path.resolve(venuesFile)}`);
    console.log(`   ✨ Added ${newVenues.length} new venues`);
    console.log(`   🌐 Enriched ${websitesEnriched} missing websites`);
  } catch (error) {
    console.error(`\n❌ Error writing to file: ${error.message}`);
    process.exit(1);
  }
  
  // Summary
  console.log(`\n📊 Summary:`);
  console.log(`   ✅ Processed ${AREAS_CONFIG.length} areas`);
  console.log(`   ✅ Added ${newVenues.length} new venues`);
  console.log(`   ✅ Enriched ${websitesEnriched} missing websites`);
  if (stillMissingWebsites.length > 0) {
    console.log(`   📄 Wrote ${stillMissingWebsites.length} missing to CSV for manual review`);
  }
  console.log(`   ✅ Successful queries: ${successfulQueries}/${totalQueries}`);
  console.log(`   ❌ Failed queries: ${failedQueries}/${totalQueries}`);
  console.log(`   🍺 Total venues: ${allVenues.length} (${existingVenues.length} existing + ${newVenues.length} new)`);
  
  const venuesWithWebsites = allVenues.filter(v => v.website && v.website.trim() !== '').length;
  const websitePercentage = allVenues.length > 0 ? Math.round((venuesWithWebsites / allVenues.length) * 100) : 0;
  console.log(`   🌐 Venues with websites: ${venuesWithWebsites}/${allVenues.length} (${websitePercentage}%)`);
  
  console.log(`\n✨ Incremental seeding complete!`);
}

// Run the seeding
console.log('🔑 Using API key:', GOOGLE_MAPS_API_KEY.substring(0, 10) + '...\n');
seedIncremental().catch((error) => {
  console.error('❌ Fatal error during seeding:', error);
  process.exit(1);
});
