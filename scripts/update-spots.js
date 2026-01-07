const fs = require('fs');
const path = require('path');

const dataFilePath = path.join(process.cwd(), 'data', 'spots.json');

// Spots to add/update
const spotsToUpdate = [
  {
    lat: 32.85867,
    lng: -79.91203,
    title: "The Kingstide",
    description: "Happy Hour Mon-Fri 4-6 PM: $2 off drafts, wines $9-13, cocktails $13, bites like chicken BLT. Waterfront views.",
    type: "Happy Hour"
  },
  {
    lat: 32.85867,
    lng: -79.91203,
    title: "Vinea Courtyard Kitchen",
    description: "No specific happy hour; cocktails like Rosemary Negroni Sour available.",
    type: "Happy Hour"
  },
  {
    lat: 32.845,
    lng: -79.908,
    title: "Ristorante LIDI",
    description: "Happy Hour Mon, Wed, Thu, Fri 4-6 PM: Beer $1.75, wine $3, cocktails; bar bites. Pizza 3-5 PM Tue-Sat.",
    type: "Happy Hour"
  },
  {
    lat: 32.86248,
    lng: -79.90398,
    title: "Mpishi Restaurant",
    description: "Happy Hour Thu-Fri 4-7 PM: Drink specials, small plates, BBQ menu. Pre-concert too.",
    type: "Happy Hour"
  },
  {
    lat: 32.8453,
    lng: -79.9083,
    title: "Heavy's Barburger",
    description: "Happy Hour Weekdays 4-6 PM: $5 margaritas, drinks; smashburgers and more.",
    type: "Happy Hour"
  },
  {
    lat: 32.8454,
    lng: -79.9084,
    title: "New Realm Brewery",
    description: "Happy Hour Mon-Fri 4-6 PM, Sun all day: Beers/mules $7, nachos/pretzel $10.",
    type: "Happy Hour"
  },
  {
    lat: 32.8451,
    lng: -79.9081,
    title: "Mac's Place",
    description: "Happy Hour Daily 3-6 PM (some 9-11 PM): $5 cocktails/beers/wines, $5/$10 plates.",
    type: "Happy Hour"
  },
  {
    lat: 32.85567,
    lng: -79.90348,
    title: "The Dime",
    description: "Happy Hour Tue-Fri 4-6 PM, Fri 5-9 PM: Cocktails, marg specials.",
    type: "Happy Hour"
  },
  {
    lat: 32.8465,
    lng: -79.9300,
    title: "Salute",
    description: "Happy Hour All day Mon-Tue 3-9 PM, Wed-Sat 3-6 PM: Liquor $6, wine/beer discounts.",
    type: "Happy Hour"
  },
  {
    lat: 32.8456,
    lng: -79.9086,
    title: "Agave's Mexican Cantina",
    description: "Happy Hour Everyday: $1 off beers/margs, $18 pitcher, $4 liquors.",
    type: "Happy Hour"
  }
];

// Read existing spots
let existingSpots = [];
try {
  const fileContent = fs.readFileSync(dataFilePath, 'utf8');
  existingSpots = JSON.parse(fileContent);
  console.log(`📖 Read ${existingSpots.length} existing spots`);
} catch (error) {
  console.error('❌ Error reading spots file:', error.message);
  process.exit(1);
}

// Find max ID
const maxId = existingSpots.length > 0 
  ? Math.max(...existingSpots.map(spot => spot.id))
  : 0;

console.log(`🔢 Max existing ID: ${maxId}\n`);

// Create a map of existing spots by normalized title for quick lookup
const spotsByTitle = new Map();
existingSpots.forEach(spot => {
  const normalizedTitle = spot.title.toLowerCase().trim();
  spotsByTitle.set(normalizedTitle, spot);
});

// Process spots to add/update
let nextId = maxId + 1;
const updatedSpots = [];
const addedSpots = [];
const skippedSpots = [];

spotsToUpdate.forEach(newSpot => {
  const normalizedTitle = newSpot.title.toLowerCase().trim();
  const existingSpot = spotsByTitle.get(normalizedTitle);
  
  if (existingSpot) {
    // Update existing spot
    existingSpot.lat = newSpot.lat;
    existingSpot.lng = newSpot.lng;
    existingSpot.description = newSpot.description;
    existingSpot.type = newSpot.type;
    // Keep existing ID
    
    updatedSpots.push({
      id: existingSpot.id,
      title: existingSpot.title,
      oldLat: existingSpots.find(s => s.id === existingSpot.id)?.lat,
      oldLng: existingSpots.find(s => s.id === existingSpot.id)?.lng,
      newLat: newSpot.lat,
      newLng: newSpot.lng
    });
    
    console.log(`🔄 Updated: "${newSpot.title}" (ID: ${existingSpot.id})`);
    console.log(`   Location: (${existingSpots.find(s => s.id === existingSpot.id)?.lat}, ${existingSpots.find(s => s.id === existingSpot.id)?.lng}) → (${newSpot.lat}, ${newSpot.lng})`);
  } else {
    // Add new spot
    const newSpotWithId = {
      id: nextId++,
      lat: newSpot.lat,
      lng: newSpot.lng,
      title: newSpot.title,
      description: newSpot.description,
      type: newSpot.type
    };
    
    existingSpots.push(newSpotWithId);
    spotsByTitle.set(normalizedTitle, newSpotWithId);
    addedSpots.push(newSpotWithId);
    
    console.log(`✅ Added: "${newSpot.title}" (ID: ${newSpotWithId.id})`);
  }
});

// Write back to file
try {
  fs.writeFileSync(dataFilePath, JSON.stringify(existingSpots, null, 2), 'utf8');
  
  console.log(`\n📝 Successfully wrote ${existingSpots.length} spots to ${dataFilePath}`);
  console.log(`\n📊 Summary:`);
  console.log(`   - Updated: ${updatedSpots.length} existing spots`);
  console.log(`   - Added: ${addedSpots.length} new spots`);
  console.log(`   - Total spots: ${existingSpots.length}`);
  
  if (updatedSpots.length > 0) {
    console.log(`\n🔄 Updated spots:`);
    updatedSpots.forEach(spot => {
      console.log(`   - ${spot.title} (ID: ${spot.id})`);
      console.log(`     Location updated: (${spot.oldLat}, ${spot.oldLng}) → (${spot.newLat}, ${spot.newLng})`);
    });
  }
  
  if (addedSpots.length > 0) {
    console.log(`\n✨ New spots added:`);
    addedSpots.forEach(spot => {
      console.log(`   - ${spot.title} (ID: ${spot.id})`);
    });
  }
  
} catch (error) {
  console.error('❌ Error writing spots file:', error.message);
  process.exit(1);
}

