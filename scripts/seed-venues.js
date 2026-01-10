const fs = require('fs');
const path = require('path');

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
  console.error('❌ Error: NEXT_PUBLIC_GOOGLE_MAPS_KEY or GOOGLE_PLACES_KEY must be set in .env');
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
  
  console.log(`✅ Loaded ${AREAS_CONFIG.length} areas from ${path.resolve(areasConfigFile)}`);
  AREAS_CONFIG.forEach(area => {
    console.log(`   📍 ${area.displayName || area.name}: radius ${area.radiusMeters}m`);
  });
} catch (error) {
  console.error(`❌ Error loading areas.json: ${error.message}`);
  console.error(`   Please ensure ${areasConfigFile} exists and is valid JSON.`);
  process.exit(1);
}

// Venue types to query (alcohol-serving establishments)
const VENUE_TYPES = [
  'bar',
  'restaurant',
  'brewery',
  'night_club',
  'wine_bar'
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

// Main seeding function - processes all areas from areas.json
async function seedVenuesExtended() {
  console.log('🍺 Starting venue seeding using areas from areas.json...\n');
  console.log(`📍 Processing ${AREAS_CONFIG.length} areas:`);
  AREAS_CONFIG.forEach(area => {
    console.log(`   ${area.displayName || area.name}:`);
    console.log(`     Center: ${area.center.lat}, ${area.center.lng}`);
    console.log(`     Radius: ${area.radiusMeters}m`);
    if (area.bounds) {
      console.log(`     Bounds: lat ${area.bounds.south} to ${area.bounds.north}, lng ${area.bounds.west} to ${area.bounds.east}`);
    }
    if (area.description) {
      console.log(`     ${area.description}`);
    }
  });
  console.log('');
  
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
        const addedNames = [];
        for (const result of results) {
          if (!seenPlaceIds.has(result.place_id)) {
            seenPlaceIds.add(result.place_id);
            const venue = extractVenueData(result, areaName);
            newVenues.push(venue);
            areaNewVenues[areaName].push(venue);
            addedNames.push(venue.name);
            addedCount++;
          }
        }
        
        console.log(`   ✅ Found ${results.length} results (${addedCount} new venues)`);
        if (addedCount > 0 && addedNames.length <= 5) {
          console.log(`   📝 Added: ${addedNames.join(', ')}`);
        } else if (addedCount > 0) {
          console.log(`   📝 Added: ${addedNames.slice(0, 5).join(', ')} and ${addedCount - 5} more`);
        }
        successfulQueries++;
        
        await delay(1000);
      } catch (error) {
        console.error(`   ❌ Error querying ${queryName}: ${error.message}`);
        failedQueries++;
      }
    }
  }
  
  // Log summary by area
  console.log(`\n📊 New Venues by Area:`);
  for (const [areaName, venues] of Object.entries(areaNewVenues)) {
    if (venues.length > 0) {
      console.log(`   ${areaName}: Added ${venues.length} new venues`);
      // Log notable venues if found (sample first 3)
      if (venues.length > 0) {
        const sampleNames = venues.slice(0, 3).map(v => v.name);
        console.log(`     Sample: ${sampleNames.join(', ')}${venues.length > 3 ? ` and ${venues.length - 3} more` : ''}`);
      }
    } else {
      console.log(`   ${areaName}: No new venues`);
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
    console.log(`\n📝 Successfully wrote ${allVenues.length} total venues to ${path.resolve(outputFile)}`);
    console.log(`   ✨ Added ${newVenues.length} new venues across ${AREAS_CONFIG.length} areas`);
    for (const areaConfig of AREAS_CONFIG) {
      const areaName = areaConfig.name;
      if (areaNewVenues[areaName] && areaNewVenues[areaName].length > 0) {
        console.log(`      - ${areaConfig.displayName || areaName}: ${areaNewVenues[areaName].length} new venues`);
      }
    }
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
  const websitePercentage = allVenues.length > 0 ? Math.round((venuesWithWebsites / allVenues.length) * 100) : 0;
  console.log(`   🌐 Venues with websites: ${venuesWithWebsites}/${allVenues.length} (${websitePercentage}%)`);
  
  // Show breakdown by area (all areas)
  const areaCounts = {};
  for (const venue of allVenues) {
    const area = venue.area || 'Unknown';
    areaCounts[area] = (areaCounts[area] || 0) + 1;
  }
  
  console.log(`\n📍 Venues by area:`);
  const sortedAreas = Object.entries(areaCounts).sort((a, b) => b[1] - a[1]);
  for (const [area, count] of sortedAreas) {
    console.log(`   ${area}: ${count} venues`);
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
  
  console.log(`\n🏢 Venues by type (all areas):`);
  const sortedTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
  for (const [type, count] of sortedTypes) {
    console.log(`   ${type}: ${count} venues`);
  }
  
  // Show breakdown by area and type (detailed)
  console.log(`\n📋 Detailed breakdown by area and type:`);
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
        console.log(`\n   ${area} (${count} total):`);
        const sortedAreaTypes = Object.entries(areaTypeCounts).sort((a, b) => b[1] - a[1]);
        for (const [type, typeCount] of sortedAreaTypes) {
          console.log(`     ${type}: ${typeCount}`);
        }
      }
    }
  }
  
  console.log(`\n✨ Venue seeding complete for all areas from areas.json!`);
}

// Run the seeding
console.log('🔑 Using API key:', GOOGLE_MAPS_API_KEY.substring(0, 10) + '...\n');
seedVenuesExtended().catch((error) => {
  console.error('❌ Fatal error during seeding:', error);
  process.exit(1);
});