const fs = require('fs');
const path = require('path');
const https = require('https');

const dataDir = path.join(process.cwd(), 'data');
const outputFile = path.join(dataDir, 'all-restaurants.json');

// Bounding boxes for each area (south, west, north, east)
const AREA_BOUNDS = {
  'Daniel Island': {
    south: 32.82,
    west: -79.96,
    north: 32.88,
    east: -79.88,
  },
  'Mount Pleasant': {
    south: 32.78,
    west: -79.88,
    north: 32.82,
    east: -79.82,
  },
  'James Island': {
    south: 32.70,
    west: -79.96,
    north: 32.75,
    east: -79.90,
  },
  'Downtown Charleston': {
    south: 32.76,
    west: -79.96,
    north: 32.80,
    east: -79.91,
  },
  "Sullivan's Island": {
    south: 32.75,
    west: -79.87,
    north: 32.77,
    east: -79.83,
  },
};

// Overpass API endpoint (kumi.systems is less rate-limited)
const OVERPASS_URL = 'https://overpass.kumi.systems/api/interpreter';

// Rate limiting delays (ms)
const INITIAL_DELAY = 5000; // Initial delay before first request
const REQUEST_DELAY = 2000; // Delay between area requests
const MAX_RETRIES = 3; // Maximum retry attempts
const RETRY_DELAYS = [5000, 10000, 20000]; // Exponential backoff delays

function makeRequest(url, data) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    };

    const req = https.request(options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        // Check for XML error responses (rate limit, etc.)
        if (responseData.trim().startsWith('<?xml')) {
          const isRateLimit = responseData.includes('rate limit') || 
                              responseData.includes('Rate limit') ||
                              responseData.includes('timeout') ||
                              responseData.includes('Timeout');
          reject(new Error(isRateLimit ? 'RATE_LIMIT' : `XML error response: ${responseData.substring(0, 200)}`));
          return;
        }

        // Check for rate limit in text responses
        if (responseData.toLowerCase().includes('rate limit')) {
          reject(new Error('RATE_LIMIT'));
          return;
        }

        try {
          const json = JSON.parse(responseData);
          resolve(json);
        } catch (error) {
          reject(new Error(`Failed to parse response: ${error.message}. Response: ${responseData.substring(0, 200)}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(data);
    req.end();
  });
}

async function queryRestaurantsForArea(areaName, bounds, attempt = 0) {
  const { south, west, north, east } = bounds;
  
  if (attempt > 0) {
    console.log(`\n🔄 Retry attempt ${attempt}/${MAX_RETRIES} for ${areaName}...`);
  } else {
    console.log(`\n📍 Querying restaurants for ${areaName}...`);
  }
  console.log(`   Bounds: ${south}, ${west}, ${north}, ${east}`);

  // Overpass query for restaurants in bounding box
  const query = `
    [out:json][timeout:60];
    (
      node["amenity"="restaurant"](${south},${west},${north},${east});
      way["amenity"="restaurant"](${south},${west},${north},${east});
      relation["amenity"="restaurant"](${south},${west},${north},${east});
    );
    out center;
  `;

  const queryData = `data=${encodeURIComponent(query)}`;

  try {
    const data = await makeRequest(OVERPASS_URL, queryData);
    console.log(`   ✅ Found ${data.elements?.length || 0} elements`);
    return { success: true, elements: data.elements || [] };
  } catch (error) {
    const errorMsg = error.message;
    const isRateLimit = errorMsg === 'RATE_LIMIT' || errorMsg.includes('rate limit');
    const isXmlError = errorMsg.includes('XML error response');
    
    // Check if we should retry
    if ((isRateLimit || isXmlError) && attempt < MAX_RETRIES) {
      const delay = RETRY_DELAYS[attempt] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
      console.warn(`   ⚠️  ${isRateLimit ? 'Rate limit' : 'XML error'} detected for ${areaName}. Retrying in ${delay}ms...`);
      return { success: false, retry: true, retryAttempt: attempt + 1, elements: [] };
    }
    
    // Max retries reached or other error
    if (isRateLimit || isXmlError) {
      console.error(`   ❌ ${isRateLimit ? 'Rate limit' : 'XML error'} persists for ${areaName} after ${MAX_RETRIES} retries. Continuing with empty results.`);
    } else {
      console.error(`   ❌ Error querying ${areaName}: ${errorMsg.substring(0, 100)}`);
    }
    
    // Return empty but don't skip - continue processing
    return { success: false, retry: false, elements: [] };
  }
}

function extractRestaurantData(element) {
  const tags = element.tags || {};
  
  // Get coordinates
  const lat = element.lat || element.center?.lat;
  const lng = element.lon || element.center?.lon;

  if (!lat || !lng) {
    return null;
  }

  // Get name
  const name = tags.name || tags['name:en'] || 'Unnamed Restaurant';

  // Build address
  const addressParts = [
    tags['addr:housenumber'],
    tags['addr:street'],
    tags['addr:city'] || 'Charleston',
    tags['addr:state'] || 'SC',
    tags['addr:postcode'],
  ].filter(Boolean);
  
  const address = tags['addr:full'] || 
                 (addressParts.length > 0 ? addressParts.join(' ') : undefined);

  // Get contact info
  const phone = tags.phone || tags['contact:phone'] || undefined;
  const website = tags.website || tags['contact:website'] || undefined;

  // Generate unique ID
  const osmId = `${element.type}-${element.id}`;
  const id = `restaurant-${osmId}`;

  return {
    id,
    lat,
    lng,
    name,
    address,
    phone,
    website,
    osmId,
  };
}

function deduplicateRestaurants(restaurants) {
  const seenById = new Map();
  const seenByNameAddress = new Map();
  const unique = [];

  for (const restaurant of restaurants) {
    // First try deduplication by osmId (most reliable)
    if (restaurant.osmId && seenById.has(restaurant.osmId)) {
      continue;
    }
    
    // Then try by name + address (fallback)
    const nameAddressKey = `${restaurant.name.toLowerCase()}-${restaurant.address?.toLowerCase() || ''}`;
    if (nameAddressKey.length > 1 && seenByNameAddress.has(nameAddressKey)) {
      continue;
    }
    
    // Add to unique list
    if (restaurant.osmId) {
      seenById.set(restaurant.osmId, true);
    }
    if (nameAddressKey.length > 1) {
      seenByNameAddress.set(nameAddressKey, true);
    }
    unique.push(restaurant);
  }

  return unique;
}

async function importAllRestaurants() {
  console.log('🍽️  Starting restaurant import process...\n');
  console.log(`📁 Output file: ${outputFile}`);
  console.log(`🌐 Using Overpass endpoint: ${OVERPASS_URL}\n`);

  // Initial delay before starting
  console.log(`⏳ Initial delay: ${INITIAL_DELAY}ms...`);
  await new Promise(resolve => setTimeout(resolve, INITIAL_DELAY));

  const allRestaurants = [];
  const areaNames = Object.keys(AREA_BOUNDS);
  const failedAreas = [];

  // Query each area
  for (let i = 0; i < areaNames.length; i++) {
    const areaName = areaNames[i];
    const bounds = AREA_BOUNDS[areaName];

    let result = await queryRestaurantsForArea(areaName, bounds, 0);

    // Retry with exponential backoff if needed
    let attempt = 0;
    while (!result.success && result.retry && attempt < MAX_RETRIES) {
      attempt = result.retryAttempt || attempt + 1;
      const delay = RETRY_DELAYS[attempt - 1] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
      console.log(`   ⏳ Waiting ${delay}ms before retry ${attempt}/${MAX_RETRIES}...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      result = await queryRestaurantsForArea(areaName, bounds, attempt);
    }

    // Extract restaurant data if successful
    if (result.success) {
      for (const element of result.elements) {
        const restaurant = extractRestaurantData(element);
        if (restaurant) {
          allRestaurants.push(restaurant);
        }
      }
    } else {
      failedAreas.push(areaName);
      console.log(`   ⚠️  ${areaName} returned no results (may have failed after retries)`);
    }

    // Rate limiting: wait between requests (except for last one)
    if (i < areaNames.length - 1) {
      console.log(`   ⏳ Waiting ${REQUEST_DELAY}ms before next request...`);
      await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY));
    }
  }

  console.log(`\n📊 Total restaurants found: ${allRestaurants.length}`);

  // Deduplicate
  const uniqueRestaurants = deduplicateRestaurants(allRestaurants);
  console.log(`📊 After deduplication: ${uniqueRestaurants.length} unique restaurants`);

  // Sort by name for better organization
  uniqueRestaurants.sort((a, b) => {
    const nameA = a.name.toLowerCase();
    const nameB = b.name.toLowerCase();
    return nameA.localeCompare(nameB);
  });

  // Ensure data directory exists
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Write to file
  fs.writeFileSync(
    outputFile,
    JSON.stringify(uniqueRestaurants, null, 2),
    'utf8'
  );

  console.log(`\n✅ Successfully wrote ${uniqueRestaurants.length} restaurants to ${outputFile}`);
  
  if (failedAreas.length > 0) {
    console.log(`\n⚠️  Areas with no results (may have failed after retries): ${failedAreas.join(', ')}`);
  }
  
  console.log(`\n📋 Summary by area:`);
  
  // Count restaurants per area (approximate)
  for (const areaName of areaNames) {
    const bounds = AREA_BOUNDS[areaName];
    const count = uniqueRestaurants.filter(r => 
      r.lat >= bounds.south && r.lat <= bounds.north &&
      r.lng >= bounds.west && r.lng <= bounds.east
    ).length;
    console.log(`   ${areaName}: ${count} restaurants`);
  }

  // Preview top 10 restaurants (sorted by name)
  console.log(`\n📖 Preview (first 10 restaurants, sorted by name):`);
  uniqueRestaurants.slice(0, 10).forEach((restaurant, index) => {
    console.log(`   ${index + 1}. ${restaurant.name}${restaurant.address ? ` - ${restaurant.address}` : ''}`);
  });

  console.log(`\n✨ Import complete! Total unique restaurants: ${uniqueRestaurants.length}`);
}

// Run the import
importAllRestaurants().catch((error) => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});

