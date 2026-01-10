/**
 * Script to create/update areas.json configuration file
 * This generates the areas configuration used by seed-venues.js and the UI
 * Run with: node scripts/create-areas.js
 */

const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const areasFile = path.join(dataDir, 'areas.json');

// Define all areas (excluding Park Circle)
const areas = [
  {
    name: "Daniel Island",
    displayName: "Daniel Island",
    description: "Includes Clements Ferry Road and northern extensions",
    center: { lat: 32.845, lng: -79.908 },
    radiusMeters: 8000,
    bounds: { south: 32.82, west: -79.96, north: 32.89, east: -79.88 }
  },
  {
    name: "Mount Pleasant",
    displayName: "Mount Pleasant",
    description: "Broad coverage including Shem Creek",
    center: { lat: 32.795, lng: -79.875 },
    radiusMeters: 12000,
    bounds: { south: 32.75, west: -80.00, north: 32.90, east: -79.80 }
  },
  {
    name: "Downtown Charleston",
    displayName: "Downtown Charleston",
    description: "Historic downtown and surrounding neighborhoods",
    center: { lat: 32.776, lng: -79.931 },
    radiusMeters: 5000,
    bounds: { south: 32.76, west: -79.96, north: 32.79, east: -79.91 }
  },
  {
    name: "Sullivan's Island",
    displayName: "Sullivan's Island",
    description: "Beach community and restaurants",
    center: { lat: 32.760, lng: -79.840 },
    radiusMeters: 3000,
    bounds: { south: 32.75, west: -79.87, north: 32.77, east: -79.83 }
  },
  {
    name: "North Charleston",
    displayName: "North Charleston",
    description: "North Charleston area including Tanger Outlets and airport area",
    center: { lat: 32.888, lng: -80.006 },
    radiusMeters: 10000,
    bounds: { south: 32.82, west: -80.10, north: 32.95, east: -79.90 }
  },
  {
    name: "West Ashley",
    displayName: "West Ashley",
    description: "West Ashley area across the Ashley River",
    center: { lat: 32.785, lng: -80.040 },
    radiusMeters: 8000,
    bounds: { south: 32.72, west: -80.10, north: 32.85, east: -79.95 }
  },
  {
    name: "James Island",
    displayName: "James Island",
    description: "James Island including western coverage like The Harlow",
    center: { lat: 32.737, lng: -79.965 },
    radiusMeters: 10000,
    bounds: { south: 32.7, west: -79.98, north: 32.75, east: -79.9 }
  }
];

// Ensure data directory exists
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log(`📁 Created data directory: ${dataDir}`);
}

// Write areas.json
try {
  fs.writeFileSync(areasFile, JSON.stringify(areas, null, 2), 'utf8');
  console.log(`✅ Successfully created/updated ${path.resolve(areasFile)}`);
  console.log(`\n📍 Generated ${areas.length} areas:`);
  areas.forEach((area, index) => {
    console.log(`   ${index + 1}. ${area.displayName || area.name}`);
    console.log(`      Center: (${area.center.lat}, ${area.center.lng})`);
    console.log(`      Radius: ${area.radiusMeters}m\n`);
  });
  
  // Validate no Park Circle
  const hasParkCircle = areas.some(area => area.name === 'Park Circle' || area.name.includes('Park Circle'));
  if (hasParkCircle) {
    console.warn('⚠️  WARNING: Park Circle found in areas list!');
    process.exit(1);
  } else {
    console.log('✅ Verified: Park Circle is NOT included in areas list');
  }
  
  console.log(`\n✨ Areas configuration file created successfully!`);
} catch (error) {
  console.error(`❌ Error writing areas.json: ${error.message}`);
  process.exit(1);
}
