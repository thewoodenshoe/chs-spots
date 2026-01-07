const fs = require('fs');
const path = require('path');
const https = require('https');

const dataFilePath = path.join(process.cwd(), 'data', 'spots.json');

// Google Places API Text Search endpoint
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;

if (!GOOGLE_PLACES_API_KEY) {
  console.error('❌ Error: GOOGLE_PLACES_KEY or NEXT_PUBLIC_GOOGLE_MAPS_KEY environment variable is required');
  console.error('   Set it in your .env.local file or export it before running this script');
  process.exit(1);
}

// Search for a place using Google Places Text Search API
function searchPlace(query) {
  return new Promise((resolve, reject) => {
    const encodedQuery = encodeURIComponent(query);
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodedQuery}&key=${GOOGLE_PLACES_API_KEY}`;
    
    https.get(url, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          
          // Check for API errors
          if (response.status === 'REQUEST_DENIED') {
            reject(new Error(`API Error: ${response.error_message || 'Request denied. Check your API key and ensure Places API is enabled.'}`));
            return;
          }
          
          if (response.status === 'OVER_QUERY_LIMIT') {
            reject(new Error('API Error: Over query limit. Please wait and try again later.'));
            return;
          }
          
          if (response.status === 'ZERO_RESULTS') {
            resolve(null); // No results found
            return;
          }
          
          if (response.status === 'OK' && response.results && response.results.length > 0) {
            const firstResult = response.results[0];
            if (firstResult.geometry && firstResult.geometry.location) {
              resolve({
                lat: firstResult.geometry.location.lat,
                lng: firstResult.geometry.location.lng,
                placeId: firstResult.place_id,
                formattedAddress: firstResult.formatted_address,
              });
            } else {
              resolve(null);
            }
          } else {
            resolve(null);
          }
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', (error) => {
      reject(error);
    });
  });
}

// Read existing spots
let spots = [];
try {
  const fileContent = fs.readFileSync(dataFilePath, 'utf8');
  spots = JSON.parse(fileContent);
  console.log(`📖 Read ${spots.length} existing spots from ${dataFilePath}`);
} catch (error) {
  console.error('❌ Error reading spots file:', error.message);
  process.exit(1);
}

// Align spots to Google Maps locations
async function alignSpots() {
  const updatedSpots = [];
  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  console.log('\n🗺️  Starting alignment process...\n');

  for (let i = 0; i < spots.length; i++) {
    const spot = spots[i];
    const title = spot.title;
    const oldLat = spot.lat;
    const oldLng = spot.lng;
    
    // Construct search query: "Title Charleston, SC"
    const query = `${title} Charleston, SC`;
    
    console.log(`📍 Spot ${i + 1}/${spots.length}: ${title}`);
    console.log(`   Current coordinates: (${oldLat}, ${oldLng})`);
    console.log(`   Searching: "${query}"`);
    
    try {
      const result = await searchPlace(query);
      
      if (result) {
        const newLat = result.lat;
        const newLng = result.lng;
        
        // Calculate distance change (rough estimate in degrees)
        const latDiff = Math.abs(newLat - oldLat);
        const lngDiff = Math.abs(newLng - oldLng);
        const distanceChange = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);
        
        // Update coordinates
        spot.lat = newLat;
        spot.lng = newLng;
        
        console.log(`   ✅ Updated to: (${newLat}, ${newLng})`);
        console.log(`   📍 Address: ${result.formattedAddress || 'N/A'}`);
        console.log(`   📏 Distance change: ~${(distanceChange * 111).toFixed(2)} km`);
        console.log(`   🆔 Place ID: ${result.placeId}`);
        updatedCount++;
      } else {
        console.log(`   ⚠️  No results found - keeping original coordinates`);
        skippedCount++;
      }
    } catch (error) {
      console.error(`   ❌ Error: ${error.message}`);
      console.log(`   ⚠️  Keeping original coordinates`);
      errorCount++;
      
      // If rate limited, wait longer before continuing
      if (error.message.includes('OVER_QUERY_LIMIT') || error.message.includes('rate limit')) {
        console.log(`   ⏳ Waiting 5 seconds before continuing...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    
    updatedSpots.push(spot);
    
    // Rate limiting: wait 1 second between requests to avoid hitting quota
    // Google Places API has quotas, so be respectful
    if (i < spots.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log(''); // Empty line for readability
  }

  // Write back to file
  try {
    fs.writeFileSync(dataFilePath, JSON.stringify(updatedSpots, null, 2), 'utf8');
    console.log(`\n📝 Successfully wrote ${updatedSpots.length} spots to ${dataFilePath}`);
    console.log(`\n📊 Summary:`);
    console.log(`   ✅ Updated: ${updatedCount} spots`);
    console.log(`   ⚠️  Skipped (no results): ${skippedCount} spots`);
    console.log(`   ❌ Errors: ${errorCount} spots`);
  } catch (error) {
    console.error('❌ Error writing spots file:', error.message);
    process.exit(1);
  }
}

// Run alignment
console.log('🔑 Using API key:', GOOGLE_PLACES_API_KEY.substring(0, 10) + '...');
alignSpots().catch((error) => {
  console.error('❌ Error during alignment:', error);
  process.exit(1);
});

