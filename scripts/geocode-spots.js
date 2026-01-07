const fs = require('fs');
const path = require('path');
const https = require('https');

const dataFilePath = path.join(process.cwd(), 'data', 'spots.json');

// Geocode using Nominatim API
function geocodeAddress(address) {
  return new Promise((resolve, reject) => {
    const encodedAddress = encodeURIComponent(address);
    const url = `https://nominatim.openstreetmap.org/search?q=${encodedAddress}&format=json&limit=1`;
    
    const options = {
      headers: {
        'User-Agent': 'Charleston Local Spots App',
      },
    };

    https.get(url, options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const results = JSON.parse(data);
          if (results && results.length > 0) {
            resolve({
              lat: parseFloat(results[0].lat),
              lng: parseFloat(results[0].lon),
            });
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

    // Rate limiting: wait 1 second between requests (Nominatim requires this)
    setTimeout(() => {}, 1000);
  });
}

// Read existing spots
let spots = [];
try {
  const fileContent = fs.readFileSync(dataFilePath, 'utf8');
  spots = JSON.parse(fileContent);
  console.log(`📖 Read ${spots.length} existing spots`);
} catch (error) {
  console.error('❌ Error reading spots file:', error.message);
  process.exit(1);
}

// Geocode spots that might need updating
async function geocodeSpots() {
  const updatedSpots = [];
  let updatedCount = 0;

  for (let i = 0; i < spots.length; i++) {
    const spot = spots[i];
    const title = spot.title;
    
    // Try to geocode if we have a title that looks like it might need geocoding
    // For now, we'll just log - you can add logic to check if coordinates seem off
    console.log(`📍 Spot ${i + 1}/${spots.length}: ${title} (${spot.lat}, ${spot.lng})`);
    
    // Example: If you want to geocode by title, uncomment below
    // const geocoded = await geocodeAddress(`${title}, ${spot.area || 'Charleston, SC'}`);
    // if (geocoded) {
    //   const distance = Math.sqrt(
    //     Math.pow(geocoded.lat - spot.lat, 2) + Math.pow(geocoded.lng - spot.lng, 2)
    //   );
    //   if (distance > 0.01) { // If more than ~1km off
    //     console.log(`  ⚠️  Updating coordinates: (${spot.lat}, ${spot.lng}) → (${geocoded.lat}, ${geocoded.lng})`);
    //     spot.lat = geocoded.lat;
    //     spot.lng = geocoded.lng;
    //     updatedCount++;
    //   }
    // }
    
    updatedSpots.push(spot);
    
    // Rate limiting: wait 1 second between requests
    if (i < spots.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Write back to file
  try {
    fs.writeFileSync(dataFilePath, JSON.stringify(updatedSpots, null, 2), 'utf8');
    console.log(`\n📝 Successfully wrote ${updatedSpots.length} spots to ${dataFilePath}`);
    console.log(`📊 Updated: ${updatedCount} spots`);
  } catch (error) {
    console.error('❌ Error writing spots file:', error.message);
    process.exit(1);
  }
}

// Run geocoding
console.log('🗺️  Starting geocoding process...\n');
geocodeSpots().catch((error) => {
  console.error('❌ Error during geocoding:', error);
  process.exit(1);
});

