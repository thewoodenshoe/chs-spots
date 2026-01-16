/**
 * Script to fix misassigned venues in venues.json based on validation results
 * This applies the corrected area assignment logic to existing venues
 */

const fs = require('fs');
const path = require('path');

const venuesPath = path.join(__dirname, '..', 'data', 'venues.json');
const areasPath = path.join(__dirname, '..', 'data', 'config', 'areas.json');

// Load data
const venues = JSON.parse(fs.readFileSync(venuesPath, 'utf8'));
const areas = JSON.parse(fs.readFileSync(areasPath, 'utf8'));

// Create area lookup map
const areaMap = {};
areas.forEach(area => {
  areaMap[area.name] = area;
});

/**
 * Extract zip code from address string or addressComponents
 */
function extractZipCode(address, addressComponents) {
  // First try address_components (more reliable)
  if (addressComponents && Array.isArray(addressComponents)) {
    const postalCode = addressComponents.find(comp => 
      comp.types && comp.types.includes('postal_code')
    );
    if (postalCode && postalCode.long_name) {
      return postalCode.long_name;
    }
  }
  
  // Fall back to regex extraction from address string
  if (address) {
    const zipMatch = address.match(/\b(\d{5})\b/);
    return zipMatch ? zipMatch[1] : null;
  }
  
  return null;
}

/**
 * Extract area from address string using the same logic as seed-venues.js
 */
function extractAreaFromAddress(address, addressComponents) {
  if (!address) return null;
  
  const addressLower = address.toLowerCase();
  
  // Map explicit area names in address
  const explicitAreaKeywords = {
    'north charleston': 'North Charleston',
    'n charleston': 'North Charleston',
    'downtown': 'Downtown Charleston',
    'downtown charleston': 'Downtown Charleston',
    'mount pleasant': 'Mount Pleasant',
    'mt pleasant': 'Mount Pleasant',
    'mt. pleasant': 'Mount Pleasant',
    'west ashley': 'West Ashley',
    'james island': 'James Island',
    "sullivan's island": "Sullivan's Island",
    'sullivans island': "Sullivan's Island",
    'daniel island': 'Daniel Island',
  };
  
  // Check for explicit area names first
  const sortedExplicit = Object.keys(explicitAreaKeywords).sort((a, b) => b.length - a.length);
  for (const keyword of sortedExplicit) {
    if (addressLower.includes(keyword)) {
      return explicitAreaKeywords[keyword];
    }
  }
  
  // King Street: 1-2000 = Downtown, 2000+ = West Ashley
  if (addressLower.includes('king street')) {
    const numberMatch = address.match(/(\d+)\s+king street/i);
    if (numberMatch) {
      const streetNumber = parseInt(numberMatch[1]);
      if (streetNumber >= 1 && streetNumber <= 2000) {
        return 'Downtown Charleston';
      } else if (streetNumber > 2000) {
        return 'West Ashley';
      }
    }
  }
  
  // East Bay Street: Downtown Charleston
  if (addressLower.includes('east bay street') || addressLower.includes('east bay st')) {
    return 'Downtown Charleston';
  }
  
  // Meeting Street: 1-400 = Downtown, 400+ = North Charleston
  if (addressLower.includes('meeting street')) {
    const numberMatch = address.match(/(\d+)\s+meeting street/i);
    if (numberMatch) {
      const streetNumber = parseInt(numberMatch[1]);
      if (streetNumber >= 1 && streetNumber <= 400) {
        return 'Downtown Charleston';
      } else if (streetNumber >= 400) {
        return 'North Charleston';
      }
    }
  }
  
  // Pittsburgh Avenue: North Charleston
  if (addressLower.includes('pittsburgh avenue') || addressLower.includes('pittsburgh ave')) {
    return 'North Charleston';
  }
  
  // Clements Ferry Road: Daniel Island (if zip 29492)
  if (addressLower.includes('clements ferry') || addressLower.includes('clements ferry road')) {
    const zipCode = extractZipCode(address, addressComponents);
    if (zipCode === '29492') {
      return 'Daniel Island';
    }
  }
  
  // Island Park Drive: Daniel Island
  if (addressLower.includes('island park') || addressLower.includes('island park drive')) {
    return 'Daniel Island';
  }
  
  // Seven Farms Drive: Daniel Island
  if (addressLower.includes('seven farms') || addressLower.includes('seven farms drive')) {
    return 'Daniel Island';
  }
  
  return null;
}

/**
 * Validate if coordinates fall within area bounds
 */
function isInBounds(lat, lng, area) {
  if (!area || !area.bounds || !lat || !lng) return false;
  const { south, west, north, east } = area.bounds;
  return lat >= south && lat <= north && lng >= west && lng <= east;
}

/**
 * Find correct area for venue using the same logic as seed-venues.js
 */
function findCorrectArea(venue) {
  const { lat, lng, address, addressComponents } = venue;
  
  // Priority 1: Address string parsing (for known streets)
  const addressArea = extractAreaFromAddress(address, addressComponents);
  if (addressArea) {
    const area = areaMap[addressArea];
    if (area) {
      // For street-based assignments, trust the address (authoritative)
      const isStreetBased = address.toLowerCase().includes('king street') ||
                            address.toLowerCase().includes('meeting street') ||
                            address.toLowerCase().includes('east bay street') ||
                            address.toLowerCase().includes('east bay st') ||
                            address.toLowerCase().includes('pittsburgh avenue') ||
                            address.toLowerCase().includes('pittsburgh ave') ||
                            (address.toLowerCase().includes('clements ferry') && extractZipCode(address, addressComponents) === '29492');
      
      if (isStreetBased || isInBounds(lat, lng, area)) {
        return addressArea;
      }
    }
  }
  
  // Priority 2: Clements Ferry Road with zip 29492 OR within buffered bounds
  const zipCode = extractZipCode(address, addressComponents);
  const isClementsFerry = address.toLowerCase().includes('clements ferry');
  
  if (isClementsFerry) {
    const danielIsland = areaMap['Daniel Island'];
    if (danielIsland) {
      const buffer = 0.05; // ~5.5km buffer
      const { south, west, north, east } = danielIsland.bounds;
      const inBufferedBounds = lat >= (south - buffer) && lat <= (north + buffer) && 
                               lng >= (west - buffer) && lng <= (east + buffer);
      // If zip is 29492 OR within buffered bounds, assign to Daniel Island
      if (zipCode === '29492' || inBufferedBounds) {
        return 'Daniel Island';
      }
    }
  }
  
  // Priority 2b: Zip code matching (for Daniel Island with 29492, non-Clements Ferry)
  if (zipCode === '29492' && !isClementsFerry) {
    const danielIsland = areaMap['Daniel Island'];
    if (danielIsland) {
      const buffer = 0.05; // ~5.5km buffer
      const { south, west, north, east } = danielIsland.bounds;
      const inBufferedBounds = lat >= (south - buffer) && lat <= (north + buffer) && 
                               lng >= (west - buffer) && lng <= (east + buffer);
      if (inBufferedBounds) {
        return 'Daniel Island';
      }
    }
  }
  
  // Priority 3: Check zip codes for all areas
  if (zipCode) {
    for (const area of areas) {
      if (area.zipCodes && Array.isArray(area.zipCodes) && area.zipCodes.includes(zipCode)) {
        if (isInBounds(lat, lng, area)) {
          return area.name;
        }
      }
    }
  }
  
  // Priority 4: Bounds checking (sorted by size)
  const sortedAreas = [...areas].sort((a, b) => {
    const areaA = (a.bounds ? (a.bounds.north - a.bounds.south) * (a.bounds.east - a.bounds.west) : Infinity);
    const areaB = (b.bounds ? (b.bounds.north - b.bounds.south) * (b.bounds.east - b.bounds.west) : Infinity);
    return areaA - areaB;
  });
  
  for (const area of sortedAreas) {
    if (isInBounds(lat, lng, area)) {
      return area.name;
    }
  }
  
  return null;
}

console.log('🔧 Fixing venue area assignments...\n');

let fixedCount = 0;
const fixes = [];

for (const venue of venues) {
  const currentArea = venue.area;
  const correctArea = findCorrectArea(venue);
  
  if (correctArea && correctArea !== currentArea) {
    fixes.push({
      name: venue.name,
      address: venue.address,
      oldArea: currentArea,
      newArea: correctArea,
      reason: `Address/zip code indicates ${correctArea}`
    });
    venue.area = correctArea;
    fixedCount++;
  }
}

if (fixedCount > 0) {
  console.log(`✅ Fixed ${fixedCount} venue(s):\n`);
  fixes.forEach(fix => {
    console.log(`  ${fix.name}`);
    console.log(`    ${fix.address}`);
    console.log(`    ${fix.oldArea} → ${fix.newArea}`);
    console.log('');
  });
  
  // Write updated venues.json
  fs.writeFileSync(venuesPath, JSON.stringify(venues, null, 2), 'utf8');
  console.log(`\n✅ Updated venues.json with ${fixedCount} corrected area assignment(s)`);
} else {
  console.log('✅ No venue assignments needed fixing');
}

process.exit(0);
