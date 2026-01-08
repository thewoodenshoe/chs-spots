require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Google Maps API Key
const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || process.env.GOOGLE_PLACES_KEY;
if (!GOOGLE_MAPS_API_KEY) {
  console.error('❌ Error: NEXT_PUBLIC_GOOGLE_MAPS_KEY or GOOGLE_PLACES_KEY must be set in .env');
  process.exit(1);
}

// Paths
const dataDir = path.join(__dirname, '..', 'data');
const outputFile = path.join(dataDir, 'venues.json');

// Venue types to query (alcohol-serving establishments)
const VENUE_TYPES = [
  'bar',
  'restaurant',
  'night_club',
  'cafe'
];

// Extended Daniel Island configuration
const DANIEL_ISLAND_EXTENDED = {
  name: 'Daniel Island',
  lat: 32.845,
  lng: -79.908,
  radius: 8000, // Extended to 8000m to cover Clements Ferry Road (north to 32.89, west to -79.96)
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
        await delay(2000); // Wait 2 seconds for token to become valid
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

// Main seeding function - Daniel Island extended coverage only
async function seedVenuesExtended() {
  console.log('🍺 Starting extended Daniel Island venue seeding...\n');
  console.log(`📍 Extended Coverage:`);
  console.log(`   Center: ${DANIEL_ISLAND_EXTENDED.lat}, ${DANIEL_ISLAND_EXTENDED.lng}`);
  console.log(`   Radius: ${DANIEL_ISLAND_EXTENDED.radius}m (covers Clements Ferry Road)`);
  console.log(`   Bounds: North to 32.89, West to -79.96\n`);
  
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
      console.log(`📖 Loaded ${existingVenues.length} existing venues from ${path.resolve(outputFile)}`);
      console.log(`   (will append new venues without overwriting)\n`);
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
  let totalQueries = 0;
  let successfulQueries = 0;
  let failedQueries = 0;
  
  // Query Daniel Island only with extended coverage
  for (const venueType of VENUE_TYPES) {
    totalQueries++;
    const queryName = `Daniel Island Extended (${venueType})`;
    
    try {
      console.log(`🔍 Querying ${queryName}...`);
      
      const results = await fetchAllPages(
        DANIEL_ISLAND_EXTENDED.name,
        venueType,
        DANIEL_ISLAND_EXTENDED.lat,
        DANIEL_ISLAND_EXTENDED.lng,
        DANIEL_ISLAND_EXTENDED.radius
      );
      
      let addedCount = 0;
      for (const result of results) {
        if (!seenPlaceIds.has(result.place_id)) {
          seenPlaceIds.add(result.place_id);
          const venue = extractVenueData(result, DANIEL_ISLAND_EXTENDED.name);
          newVenues.push(venue);
          addedCount++;
        }
      }
      
      console.log(`   ✅ Found ${results.length} results (${addedCount} new venues)`);
      successfulQueries++;
      
      await delay(1000);
    } catch (error) {
      console.error(`   ❌ Error querying ${queryName}: ${error.message}`);
      failedQueries++;
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
    console.log(`\n🌐 Fetching website details for new venues...\n`);
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
          const details = await fetchPlaceDetails(venue.id);
          detailsFetched++;
          
          if (details.website) {
            venue.website = details.website;
            websitesFound++;
            
            if (details.formatted_address && (!venue.address || venue.address === 'Address not available')) {
              venue.address = details.formatted_address;
            }
            
            console.log(`${progress} ✅ ${venue.name}: Found website`);
          } else {
            console.log(`${progress} ⬜ ${venue.name}: No website available`);
          }
        } catch (error) {
          detailsErrors++;
          console.log(`${progress} ❌ ${venue.name}: ${error.message}`);
        }
        
        if (i < venuesNeedingWebsites.length - 1) {
          const delayMs = 1000 + Math.floor(Math.random() * 1000);
          await delay(delayMs);
        }
        
        if ((i + 1) % 10 === 0 || i === venuesNeedingWebsites.length - 1) {
          console.log(`   📊 Progress: Fetched details for ${detailsFetched}/${i + 1} venues, found ${websitesFound} websites\n`);
        }
      }
      
      console.log(`\n🌐 Website fetching complete:`);
      console.log(`   ✅ Fetched details for ${detailsFetched}/${totalNeedingWebsites} venues`);
      console.log(`   🌐 Found ${websitesFound} websites`);
      console.log(`   ❌ Errors: ${detailsErrors}\n`);
    }
  }
  
  // Write to file
  try {
    fs.writeFileSync(outputFile, JSON.stringify(allVenues, null, 2), 'utf8');
    console.log(`📝 Successfully wrote ${allVenues.length} total venues to ${path.resolve(outputFile)}`);
    console.log(`   ✨ Added ${newVenues.length} new venues from extended Daniel Island coverage`);
  } catch (error) {
    console.error(`\n❌ Error writing to file: ${error.message}`);
    process.exit(1);
  }
  
  // Summary
  console.log(`\n📊 Summary:`);
  console.log(`   ✅ Successful queries: ${successfulQueries}/${totalQueries}`);
  console.log(`   ❌ Failed queries: ${failedQueries}/${totalQueries}`);
  console.log(`   🍺 Total venues: ${allVenues.length} (${existingVenues.length} existing + ${newVenues.length} new)`);
  
  const venuesWithWebsites = allVenues.filter(v => v.website && v.website.trim() !== '').length;
  console.log(`   🌐 Venues with websites: ${venuesWithWebsites}/${allVenues.length} (${Math.round(venuesWithWebsites / allVenues.length * 100)}%)`);
  
  // Show breakdown by area
  const areaCounts = {};
  for (const venue of allVenues) {
    areaCounts[venue.area] = (areaCounts[venue.area] || 0) + 1;
  }
  
  console.log(`\n📍 Venues by area:`);
  for (const [area, count] of Object.entries(areaCounts)) {
    console.log(`   ${area}: ${count} venues`);
  }
  
  // Show Daniel Island breakdown by type
  const danielIslandVenues = allVenues.filter(v => v.area === 'Daniel Island');
  const typeCounts = {};
  for (const venue of danielIslandVenues) {
    for (const type of venue.types) {
      if (VENUE_TYPES.includes(type)) {
        typeCounts[type] = (typeCounts[type] || 0) + 1;
      }
    }
  }
  
  console.log(`\n🏢 Daniel Island venues by type:`);
  for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${type}: ${count} venues`);
  }
  
  console.log(`\n✨ Extended Daniel Island coverage complete!`);
}

// Run the seeding
console.log('🔑 Using API key:', GOOGLE_MAPS_API_KEY.substring(0, 10) + '...\n');
seedVenuesExtended().catch((error) => {
  console.error('❌ Fatal error during seeding:', error);
  process.exit(1);
});