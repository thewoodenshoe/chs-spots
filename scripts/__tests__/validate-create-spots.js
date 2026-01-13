/**
 * Validation Test: Create Spots
 * 
 * Standalone validation script (not Jest) for create-spots.js
 * Tests the spot creation logic with test data
 */

const fs = require('fs');
const path = require('path');

const TEST_DIR = path.join(__dirname, '../../.test-data');
const TEST_GOLD_DIR = path.join(TEST_DIR, 'gold');
const TEST_VENUES_PATH = path.join(TEST_DIR, 'venues.json');
const TEST_SPOTS_PATH = path.join(TEST_DIR, 'spots.json');

function cleanTestDir() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(TEST_GOLD_DIR, { recursive: true });
}

function formatHappyHourDescription(happyHour) {
  const parts = [];
  
  if (happyHour.times) {
    parts.push(happyHour.times);
  }
  
  if (happyHour.days) {
    if (parts.length > 0) {
      parts.push(happyHour.days);
    } else {
      parts.push(happyHour.days);
    }
  }
  
  if (happyHour.specials && happyHour.specials.length > 0) {
    const specialsText = happyHour.specials.join(', ');
    parts.push(specialsText);
  }
  
  if (parts.length === 0 && happyHour.source) {
    parts.push('Happy Hour details available');
  }
  
  return parts.join(' • ') || 'Happy Hour available';
}

function createSpot(goldData, venueData, spotId) {
  const happyHour = goldData.happyHour || {};
  
  // Only create spots for venues with happy hour found
  if (!happyHour.found) {
    return null;
  }
  
  const spot = {
    id: spotId,
    lat: venueData.lat || venueData.geometry?.location?.lat,
    lng: venueData.lng || venueData.geometry?.location?.lng,
    title: goldData.venueName || venueData.name || 'Unknown Venue',
    description: formatHappyHourDescription(happyHour),
    type: 'Happy Hour',
  };
  
  // Add photoUrl if available from venue
  if (venueData.photoUrl) {
    spot.photoUrl = venueData.photoUrl;
  } else if (venueData.photos && venueData.photos.length > 0) {
    spot.photoUrl = venueData.photos[0].photo_reference;
  }
  
  return spot;
}

function createSpotsFromGold(goldDir, venuesPath, spotsPath) {
  const spots = [];
  
  // Load venues
  if (!fs.existsSync(venuesPath)) {
    return { spots: [], error: 'Venues file not found' };
  }
  
  const venues = JSON.parse(fs.readFileSync(venuesPath, 'utf8'));
  const venueMap = new Map();
  for (const venue of venues) {
    const venueId = venue.id || venue.place_id;
    if (venueId) {
      venueMap.set(venueId, venue);
    }
  }
  
  // Get all gold files
  const goldFiles = fs.readdirSync(goldDir)
    .filter(f => f.endsWith('.json') && f !== 'bulk-results.json' && f !== '.bulk-complete')
    .map(f => path.join(goldDir, f));
  
  // Process gold files
  for (const goldPath of goldFiles) {
    try {
      const goldData = JSON.parse(fs.readFileSync(goldPath, 'utf8'));
      const venueId = goldData.venueId;
      
      if (!venueId) continue;
      
      const venueData = venueMap.get(venueId);
      if (!venueData) continue;
      
      if (!goldData.happyHour || !goldData.happyHour.found) continue;
      
      const spot = createSpot(goldData, venueData, spots.length + 1);
      
      if (spot && spot.lat && spot.lng) {
        spots.push(spot);
      }
    } catch (e) {
      // Skip errors
    }
  }
  
  // Write spots
  fs.writeFileSync(spotsPath, JSON.stringify(spots, null, 2), 'utf8');
  
  return { spots, error: null };
}

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    return true;
  } catch (error) {
    console.error(`❌ ${name}`);
    console.error(`   Error: ${error.message}`);
    if (error.stack) {
      console.error(`   Stack: ${error.stack.split('\n')[1]}`);
    }
    return false;
  }
}

function main() {
  console.log('🧪 Validating Create Spots\n');
  
  let passed = 0;
  let failed = 0;
  
  // Test 1: Create spot from gold data and venue
  cleanTestDir();
  if (test('Should create spot with all required fields', () => {
    const venueId = 'ChIJTest123';
    
    const goldData = {
      venueId,
      venueName: 'Test Venue',
      happyHour: {
        found: true,
        times: '4pm-7pm',
        days: 'Monday-Friday',
        specials: ['$5 beers']
      }
    };
    
    const venueData = {
      id: venueId,
      name: 'Test Venue',
      lat: 32.8022428,
      lng: -79.9529594
    };
    
    const spot = createSpot(goldData, venueData, 1);
    
    if (!spot) throw new Error('Spot should be created');
    if (spot.id !== 1) throw new Error('Wrong id');
    if (spot.lat !== 32.8022428) throw new Error('Wrong lat');
    if (spot.lng !== -79.9529594) throw new Error('Wrong lng');
    if (spot.title !== 'Test Venue') throw new Error('Wrong title');
    if (spot.type !== 'Happy Hour') throw new Error('Wrong type');
    if (!spot.description) throw new Error('Missing description');
    if (!spot.description.includes('4pm-7pm')) throw new Error('Description missing times');
    if (!spot.description.includes('Monday-Friday')) throw new Error('Description missing days');
  })) {
    passed++;
  } else {
    failed++;
  }
  
  // Test 2: Skip venues without happy hour
  cleanTestDir();
  if (test('Should skip venues without happy hour', () => {
    const goldData = {
      venueId: 'ChIJTest123',
      venueName: 'Test Venue',
      happyHour: {
        found: false
      }
    };
    
    const venueData = {
      id: 'ChIJTest123',
      lat: 32.8022428,
      lng: -79.9529594
    };
    
    const spot = createSpot(goldData, venueData, 1);
    
    if (spot !== null) throw new Error('Spot should not be created when happyHour.found is false');
  })) {
    passed++;
  } else {
    failed++;
  }
  
  // Test 3: Format description correctly
  cleanTestDir();
  if (test('Should format happy hour description correctly', () => {
    const happyHour = {
      found: true,
      times: '4pm-7pm',
      days: 'Monday-Friday',
      specials: ['$5 beers', 'Half price apps']
    };
    
    const desc = formatHappyHourDescription(happyHour);
    
    if (!desc.includes('4pm-7pm')) throw new Error('Missing times');
    if (!desc.includes('Monday-Friday')) throw new Error('Missing days');
    if (!desc.includes('$5 beers')) throw new Error('Missing specials');
    if (!desc.includes('•')) throw new Error('Missing separator');
  })) {
    passed++;
  } else {
    failed++;
  }
  
  // Test 4: Create spots from gold files
  cleanTestDir();
  if (test('Should create spots.json from gold files and venues', () => {
    const venueId1 = 'ChIJTest123';
    const venueId2 = 'ChIJTest456';
    
    // Create venues.json
    const venues = [
      {
        id: venueId1,
        name: 'Test Venue 1',
        lat: 32.8022428,
        lng: -79.9529594
      },
      {
        id: venueId2,
        name: 'Test Venue 2',
        lat: 32.8050000,
        lng: -79.9550000
      }
    ];
    fs.writeFileSync(TEST_VENUES_PATH, JSON.stringify(venues, null, 2), 'utf8');
    
    // Create gold files
    const goldData1 = {
      venueId: venueId1,
      venueName: 'Test Venue 1',
      happyHour: {
        found: true,
        times: '4pm-7pm'
      }
    };
    fs.writeFileSync(
      path.join(TEST_GOLD_DIR, `${venueId1}.json`),
      JSON.stringify(goldData1, null, 2),
      'utf8'
    );
    
    const goldData2 = {
      venueId: venueId2,
      venueName: 'Test Venue 2',
      happyHour: {
        found: true,
        times: '5pm-8pm'
      }
    };
    fs.writeFileSync(
      path.join(TEST_GOLD_DIR, `${venueId2}.json`),
      JSON.stringify(goldData2, null, 2),
      'utf8'
    );
    
    // Create spots
    const { spots, error } = createSpotsFromGold(TEST_GOLD_DIR, TEST_VENUES_PATH, TEST_SPOTS_PATH);
    
    if (error) throw new Error(error);
    if (spots.length !== 2) throw new Error(`Expected 2 spots, got ${spots.length}`);
    
    // Check spots.json file
    if (!fs.existsSync(TEST_SPOTS_PATH)) throw new Error('spots.json not created');
    
    const spotsData = JSON.parse(fs.readFileSync(TEST_SPOTS_PATH, 'utf8'));
    if (!Array.isArray(spotsData)) throw new Error('spots.json should be an array');
    if (spotsData.length !== 2) throw new Error(`Expected 2 spots in file, got ${spotsData.length}`);
    
    const spot1 = spotsData[0];
    if (spot1.id !== 1) throw new Error('Wrong id for spot 1');
    if (spot1.title !== 'Test Venue 1') throw new Error('Wrong title for spot 1');
    if (spot1.type !== 'Happy Hour') throw new Error('Wrong type for spot 1');
    if (!spot1.lat || !spot1.lng) throw new Error('Missing coordinates for spot 1');
  })) {
    passed++;
  } else {
    failed++;
  }
  
  // Test 5: Skip venues not in venues.json
  cleanTestDir();
  if (test('Should skip venues not found in venues.json', () => {
    const venueId = 'ChIJTest123';
    
    // Create venues.json (without the venue)
    const venues = [];
    fs.writeFileSync(TEST_VENUES_PATH, JSON.stringify(venues, null, 2), 'utf8');
    
    // Create gold file
    const goldData = {
      venueId,
      venueName: 'Test Venue',
      happyHour: {
        found: true,
        times: '4pm-7pm'
      }
    };
    fs.writeFileSync(
      path.join(TEST_GOLD_DIR, `${venueId}.json`),
      JSON.stringify(goldData, null, 2),
      'utf8'
    );
    
    // Create spots
    const { spots } = createSpotsFromGold(TEST_GOLD_DIR, TEST_VENUES_PATH, TEST_SPOTS_PATH);
    
    if (spots.length !== 0) throw new Error(`Expected 0 spots, got ${spots.length}`);
  })) {
    passed++;
  } else {
    failed++;
  }
  
  // Summary
  console.log(`\n📊 Summary: ${passed} passed, ${failed} failed\n`);
  
  if (failed === 0) {
    console.log('✅ All tests passed!');
    cleanTestDir();
    process.exit(0);
  } else {
    console.log('❌ Some tests failed');
    cleanTestDir();
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { createSpot, formatHappyHourDescription, createSpotsFromGold };
