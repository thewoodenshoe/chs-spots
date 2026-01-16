/**
 * Test script to verify area assignment logic before running full seed-venues.js
 * This tests the findAreaForVenue function logic without making API calls
 */

const path = require('path');
const fs = require('fs');

// Load areas config
const areasConfigPath = path.join(__dirname, '..', 'data', 'config', 'areas.json');
const areasConfig = JSON.parse(fs.readFileSync(areasConfigPath, 'utf8'));

// Mock the helper functions (simplified versions)
function extractZipCode(address, addressComponents) {
  if (addressComponents && Array.isArray(addressComponents)) {
    const postalCode = addressComponents.find(comp => 
      comp.types && comp.types.includes('postal_code')
    );
    if (postalCode && postalCode.long_name) {
      return postalCode.long_name;
    }
  }
  if (address) {
    const zipMatch = address.match(/\b(\d{5})\b/);
    return zipMatch ? zipMatch[1] : null;
  }
  return null;
}

function extractSublocality(addressComponents) {
  if (!addressComponents || !Array.isArray(addressComponents)) {
    return null;
  }
  const sublocality1 = addressComponents.find(comp => 
    comp.types && comp.types.includes('sublocality_level_1')
  );
  if (sublocality1 && sublocality1.long_name) {
    return sublocality1.long_name;
  }
  const sublocality = addressComponents.find(comp => 
    comp.types && comp.types.includes('sublocality')
  );
  if (sublocality && sublocality.long_name) {
    return sublocality.long_name;
  }
  return null;
}

function mapGoogleSublocalityToArea(googleSublocality) {
  if (!googleSublocality) return null;
  const normalized = googleSublocality.toLowerCase().trim();
  const mapping = {
    'mount pleasant': 'Mount Pleasant',
    'mt pleasant': 'Mount Pleasant',
    'downtown charleston': 'Downtown Charleston',
    'downtown': 'Downtown Charleston',
    'historic district': 'Downtown Charleston',
    'james island': 'James Island',
    "sullivan's island": "Sullivan's Island",
    'sullivans island': "Sullivan's Island",
    'north charleston': 'North Charleston',
    'west ashley': 'West Ashley',
    'daniel island': 'Daniel Island',
  };
  return mapping[normalized] || null;
}

function findAreaForVenue(lat, lng, address, addressComponents, areasConfig) {
  // Priority 1: Use Google's sublocality
  const googleSublocality = extractSublocality(addressComponents);
  if (googleSublocality) {
    const mappedArea = mapGoogleSublocalityToArea(googleSublocality);
    if (mappedArea) {
      const areaExists = areasConfig.find(a => a.name === mappedArea);
      if (areaExists) {
        return mappedArea;
      }
    }
  }
  
  // Priority 2: Check zip codes for ALL areas
  const zipCode = extractZipCode(address, addressComponents);
  if (zipCode) {
    for (const area of areasConfig) {
      if (area.zipCodes && Array.isArray(area.zipCodes) && area.zipCodes.includes(zipCode)) {
        return area.name;
      }
    }
  }
  
  // Priority 3: Bounds checking (sorted by size)
  const sortedAreas = [...areasConfig].sort((a, b) => {
    const areaA = (a.bounds ? (a.bounds.north - a.bounds.south) * (a.bounds.east - a.bounds.west) : Infinity);
    const areaB = (b.bounds ? (b.bounds.north - b.bounds.south) * (b.bounds.east - b.bounds.west) : Infinity);
    return areaA - areaB;
  });
  
  if (!lat || !lng) {
    return null;
  }
  
  for (const area of sortedAreas) {
    if (area.bounds) {
      const { south, west, north, east } = area.bounds;
      if (lat >= south && lat <= north && lng >= west && lng <= east) {
        return area.name;
      }
    }
  }
  
  return null;
}

// Test cases
console.log('🧪 Testing Area Assignment Logic\n');

const tests = [
  // Test 1: Zip code matching for Downtown Charleston
  {
    name: 'Downtown Charleston zip code 29401',
    lat: 32.78,
    lng: -79.93,
    address: '123 King Street, Charleston, SC 29401',
    addressComponents: [
      { types: ['postal_code'], long_name: '29401' }
    ],
    expected: 'Downtown Charleston'
  },
  // Test 2: Zip code matching for Sullivan's Island
  {
    name: "Sullivan's Island zip code 29482",
    lat: 32.76,
    lng: -79.84,
    address: '123 Middle Street, Sullivan\'s Island, SC 29482',
    addressComponents: [
      { types: ['postal_code'], long_name: '29482' }
    ],
    expected: "Sullivan's Island"
  },
  // Test 3: Zip code matching for Mount Pleasant
  {
    name: 'Mount Pleasant zip code 29464',
    lat: 32.80,
    lng: -79.86,
    address: '123 Coleman Boulevard, Mount Pleasant, SC 29464',
    addressComponents: [
      { types: ['postal_code'], long_name: '29464' }
    ],
    expected: 'Mount Pleasant'
  },
  // Test 4: Downtown Charleston venue (King Street) that was misassigned
  {
    name: 'Downtown King Street venue (should be Downtown, not Mount Pleasant)',
    lat: 32.78,  // Downtown coordinates
    lng: -79.93,
    address: '467 King Street, Charleston, SC 29401',
    addressComponents: [
      { types: ['postal_code'], long_name: '29401' }
    ],
    expected: 'Downtown Charleston'
  },
  // Test 5: Bounds check prioritization (smaller area first)
  {
    name: 'Overlapping bounds - should prefer Downtown over Mount Pleasant',
    lat: 32.78,  // In both Downtown and Mount Pleasant bounds
    lng: -79.93,
    address: '123 Street, Charleston, SC',  // No zip code
    addressComponents: [],  // No sublocality
    expected: 'Downtown Charleston'  // Smaller area should win
  },
  // Test 6: Daniel Island zip code (existing test)
  {
    name: 'Daniel Island zip code 29492',
    lat: 32.85,
    lng: -79.90,
    address: '123 Island Park Drive, Charleston, SC 29492',
    addressComponents: [
      { types: ['postal_code'], long_name: '29492' }
    ],
    expected: 'Daniel Island'
  },
  // Test 7: Sublocality priority over zip code
  {
    name: 'Sublocality should take priority over zip code',
    lat: 32.78,
    lng: -79.93,
    address: '123 Street, Charleston, SC 29401',
    addressComponents: [
      { types: ['postal_code'], long_name: '29401' },
      { types: ['sublocality'], long_name: 'Mount Pleasant' }
    ],
    expected: 'Mount Pleasant'  // Sublocality should win even if zip suggests Downtown
  }
];

let passed = 0;
let failed = 0;

tests.forEach(test => {
  const result = findAreaForVenue(test.lat, test.lng, test.address, test.addressComponents, areasConfig);
  if (result === test.expected) {
    console.log(`✅ ${test.name}`);
    console.log(`   Expected: ${test.expected}, Got: ${result}\n`);
    passed++;
  } else {
    console.log(`❌ ${test.name}`);
    console.log(`   Expected: ${test.expected}, Got: ${result}\n`);
    failed++;
  }
});

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.log('\n❌ Some tests failed. Please review the logic before running seed-venues.js');
  process.exit(1);
} else {
  console.log('\n✅ All tests passed! The area assignment logic looks correct.');
  process.exit(0);
}
