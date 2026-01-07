const fs = require('fs');
const path = require('path');

const dataFilePath = path.join(process.cwd(), 'data', 'spots.json');

// New spots to add
const newSpots = [
  {
    lat: 32.8466,
    lng: -79.9301,
    title: "The Kingstide",
    description: "Happy Hour Mon-Fri 4-6 PM: $2 off drafts, wines $9-13, cocktails $13, bites like chicken BLT. Waterfront views.",
    type: "Happy Hour"
  },
  {
    lat: 32.8450,
    lng: -79.9080,
    title: "Vinea Courtyard Kitchen",
    description: "No specific happy hour; cocktails like Rosemary Negroni Sour available.",
    type: "Happy Hour"
  },
  {
    lat: 32.8455,
    lng: -79.9085,
    title: "Ristorante LIDI",
    description: "Happy Hour Mon, Wed, Thu, Fri 4-6 PM: Beer $1.75, wine $3, cocktails; bar bites. Pizza 3-5 PM Tue-Sat.",
    type: "Happy Hour"
  },
  {
    lat: 32.8452,
    lng: -79.9082,
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
    lat: 32.8460,
    lng: -79.9300,
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
  console.log(`Read ${existingSpots.length} existing spots`);
} catch (error) {
  console.error('Error reading spots file:', error.message);
  process.exit(1);
}

// Find max ID
const maxId = existingSpots.length > 0 
  ? Math.max(...existingSpots.map(spot => spot.id))
  : 0;

console.log(`Max existing ID: ${maxId}`);

// Get existing titles (case-insensitive for duplicate checking)
const existingTitles = new Set(
  existingSpots.map(spot => spot.title.toLowerCase().trim())
);

// Add new spots with unique IDs and check for duplicates
let nextId = maxId + 1;
const addedSpots = [];
const skippedSpots = [];

newSpots.forEach(spot => {
  const normalizedTitle = spot.title.toLowerCase().trim();
  
  if (existingTitles.has(normalizedTitle)) {
    skippedSpots.push(spot.title);
    console.log(`⚠️  Skipped duplicate: "${spot.title}"`);
  } else {
    const newSpot = {
      id: nextId++,
      lat: spot.lat,
      lng: spot.lng,
      title: spot.title,
      description: spot.description,
      type: spot.type
    };
    
    existingSpots.push(newSpot);
    existingTitles.add(normalizedTitle);
    addedSpots.push(newSpot);
    console.log(`✅ Added: "${spot.title}" (ID: ${newSpot.id})`);
  }
});

// Write back to file
try {
  fs.writeFileSync(dataFilePath, JSON.stringify(existingSpots, null, 2), 'utf8');
  console.log(`\n📝 Successfully wrote ${existingSpots.length} spots to ${dataFilePath}`);
  console.log(`\n📊 Summary:`);
  console.log(`   - Added: ${addedSpots.length} new spots`);
  console.log(`   - Skipped: ${skippedSpots.length} duplicates`);
  console.log(`   - Total spots: ${existingSpots.length}`);
  
  if (addedSpots.length > 0) {
    console.log(`\n✨ New spots added:`);
    addedSpots.forEach(spot => {
      console.log(`   - ${spot.title} (ID: ${spot.id})`);
    });
  }
  
  if (skippedSpots.length > 0) {
    console.log(`\n⚠️  Skipped duplicates:`);
    skippedSpots.forEach(title => {
      console.log(`   - ${title}`);
    });
  }
} catch (error) {
  console.error('Error writing spots file:', error.message);
  process.exit(1);
}

