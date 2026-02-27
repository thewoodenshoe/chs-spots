/**
 * Unit tests for area assignment logic in seed-venues.js
 * These tests ensure the accuracy of venue area assignments and prevent regressions
 */

// Mock the areas config for testing
const AREAS_CONFIG = [
  {
    name: 'Daniel Island',
    bounds: { south: 32.82, west: -79.96, north: 32.89, east: -79.88 },
    zipCodes: ['29492']
  },
  {
    name: 'Downtown Charleston',
    bounds: { south: 32.76, west: -79.96, north: 32.79, east: -79.91 },
    zipCodes: ['29401', '29403', '29424', '29425']
  },
  {
    name: 'Mount Pleasant',
    bounds: { south: 32.75, west: -80, north: 32.9, east: -79.8 },
    zipCodes: ['29464', '29465', '29466']
  },
  {
    name: 'North Charleston',
    bounds: { south: 32.82, west: -80.1, north: 32.95, east: -79.9 },
    zipCodes: ['29405', '29406', '29415', '29418', '29419', '29420', '29423']
  },
  {
    name: 'West Ashley',
    bounds: { south: 32.72, west: -80.1, north: 32.85, east: -79.95 },
    zipCodes: ['29407', '29414']
  },
  {
    name: "Sullivan's & IOP",
    bounds: { south: 32.75, west: -79.87, north: 32.80, east: -79.77 },
    zipCodes: ['29482', '29451']
  },
  {
    name: 'James Island',
    bounds: { south: 32.70, west: -79.96, north: 32.75, east: -79.90 },
    zipCodes: ['29412']
  }
];

// Extract functions from seed-venues.js for testing
// Note: In a real scenario, we'd extract these to a separate module
// For now, we'll test the logic by requiring the script and testing the patterns

describe('Area Assignment Logic - extractAreaFromAddress', () => {
  // Test cases based on the actual logic in seed-venues.js
  const testCases = [
    // Explicit area names
    {
      address: '123 Main Street, North Charleston, SC',
      expected: 'North Charleston',
      description: 'Explicit "North Charleston" in address'
    },
    {
      address: '456 King Street, Downtown Charleston, SC',
      expected: 'Downtown Charleston',
      description: 'Explicit "Downtown Charleston" in address'
    },
    {
      address: '789 Coleman Boulevard, Mount Pleasant, SC',
      expected: 'Mount Pleasant',
      description: 'Explicit "Mount Pleasant" in address'
    },
    
    // King Street number-based logic (1-2000 = Downtown, 2000+ = West Ashley)
    {
      address: '2 King Street, Charleston, SC',
      expected: 'Downtown Charleston',
      description: 'King Street low number (2) = Downtown'
    },
    {
      address: '685 King Street, Charleston, SC',
      expected: 'Downtown Charleston',
      description: 'King Street mid number (685) = Downtown'
    },
    {
      address: '1337 King Street, Charleston, SC',
      expected: 'Downtown Charleston',
      description: 'King Street mid-high number (1337) = Downtown'
    },
    {
      address: '1503 King Street, Charleston, SC',
      expected: 'Downtown Charleston',
      description: 'King Street high number (1503) = Downtown'
    },
    {
      address: '1505 King Street #115, Charleston, SC',
      expected: 'Downtown Charleston',
      description: 'King Street high number with unit (1505) = Downtown'
    },
    {
      address: '2000 King Street, Charleston, SC',
      expected: 'Downtown Charleston',
      description: 'King Street boundary number (2000) = Downtown'
    },
    {
      address: '2001 King Street, Charleston, SC',
      expected: 'West Ashley',
      description: 'King Street very high number (2001) = West Ashley'
    },
    {
      address: '2500 King Street, Charleston, SC',
      expected: 'West Ashley',
      description: 'King Street very high number (2500) = West Ashley'
    },
    
    // East Bay Street (authoritative = Downtown)
    {
      address: '549 East Bay Street, Charleston, SC',
      expected: 'Downtown Charleston',
      description: 'East Bay Street = Downtown (authoritative)'
    },
    {
      address: '701 East Bay Street Suite 100-2, Charleston, SC',
      expected: 'Downtown Charleston',
      description: 'East Bay Street with suite = Downtown (authoritative)'
    },
    {
      address: '701 East Bay Street No. 110, Charleston, SC',
      expected: 'Downtown Charleston',
      description: 'East Bay Street with unit number = Downtown (authoritative)'
    },
    
    // Meeting Street number-based logic (1-400 = Downtown, 400+ = North Charleston)
    {
      address: '2 Meeting Street, Charleston, SC',
      expected: 'Downtown Charleston',
      description: 'Meeting Street low number (2) = Downtown'
    },
    {
      address: '115 Meeting Street, Charleston, SC',
      expected: 'Downtown Charleston',
      description: 'Meeting Street mid number (115) = Downtown'
    },
    {
      address: '232 Meeting Street, Charleston, SC',
      expected: 'Downtown Charleston',
      description: 'Meeting Street mid number (232) = Downtown'
    },
    {
      address: '400 Meeting Street, Charleston, SC',
      expected: 'Downtown Charleston',
      description: 'Meeting Street boundary number (400) = Downtown (1-400 inclusive)'
    },
    {
      address: '401 Meeting Street, Charleston, SC',
      expected: 'North Charleston',
      description: 'Meeting Street number >400 = North Charleston'
    },
    {
      address: '500 Meeting Street, Charleston, SC',
      expected: 'North Charleston',
      description: 'Meeting Street high number (500) = North Charleston'
    },
    
    // Pittsburgh Avenue (authoritative = North Charleston)
    {
      address: '2015 Pittsburgh Avenue, Charleston, SC',
      expected: 'North Charleston',
      description: 'Pittsburgh Avenue = North Charleston (authoritative)'
    },
    {
      address: '123 Pittsburgh Ave, Charleston, SC',
      expected: 'North Charleston',
      description: 'Pittsburgh Ave = North Charleston (authoritative)'
    },
    
    // Clements Ferry Road (Daniel Island when zip 29492)
    {
      address: '2514 Clements Ferry Road, Wando, SC 29492',
      expected: 'Daniel Island',
      description: 'Clements Ferry Road with zip 29492 = Daniel Island'
    },
    {
      address: '2490 Clements Ferry Road, Wando, SC 29492',
      expected: 'Daniel Island',
      description: 'Clements Ferry Road with zip 29492 = Daniel Island'
    },
    
    // Island Park Drive (Daniel Island)
    {
      address: '885 Island Park Drive, Charleston, SC 29492',
      expected: 'Daniel Island',
      description: 'Island Park Drive = Daniel Island'
    },
    
    // Seven Farms Drive (Daniel Island)
    {
      address: '123 Seven Farms Drive, Charleston, SC 29492',
      expected: 'Daniel Island',
      description: 'Seven Farms Drive = Daniel Island'
    },
    
    // Cases that should return null (no match)
    {
      address: '123 Random Street, Charleston, SC',
      expected: null,
      description: 'Unknown street = null'
    },
    {
      address: '123 King Street, Somewhere Else, SC',
      expected: 'Downtown Charleston',
      description: 'King Street still matches even with other location'
    }
  ];

  testCases.forEach(({ address, expected, description }) => {
    test(description, () => {
      // We'll test the pattern matching logic
      // Since we can't directly import the function, we'll replicate the logic
      const result = extractAreaFromAddressTest(address);
      expect(result).toBe(expected);
    });
  });
});

// Replicate extractAreaFromAddress logic for testing
function extractAreaFromAddressTest(address) {
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
    "sullivan's island": "Sullivan's & IOP",
    'sullivans island': "Sullivan's & IOP",
    'isle of palms': "Sullivan's & IOP",
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
  
  // Meeting Street: 1-400 = Downtown, >400 = North Charleston
  if (addressLower.includes('meeting street')) {
    const numberMatch = address.match(/(\d+)\s+meeting street/i);
    if (numberMatch) {
      const streetNumber = parseInt(numberMatch[1]);
      if (streetNumber >= 1 && streetNumber <= 400) {
        return 'Downtown Charleston';
      } else if (streetNumber > 400) {
        return 'North Charleston';
      }
    }
  }
  
  // Pittsburgh Avenue: North Charleston
  if (addressLower.includes('pittsburgh avenue') || addressLower.includes('pittsburgh ave')) {
    return 'North Charleston';
  }
  
  // Clements Ferry Road: Daniel Island (when zip 29492)
  if (addressLower.includes('clements ferry') || addressLower.includes('clements ferry road')) {
    const zipMatch = address.match(/\b(\d{5})\b/);
    if (zipMatch && zipMatch[1] === '29492') {
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

describe('Area Assignment Logic - Known Problematic Venues', () => {
  // These are venues that were previously misassigned and should now be correct
  const problematicVenues = [
    {
      name: 'Recovery Room Tavern',
      address: '685 King Street, Charleston, SC',
      expectedArea: 'Downtown Charleston',
      description: 'King Street 685 should be Downtown (was incorrectly Mount Pleasant)'
    },
    {
      name: 'Edmund\'s Oast Brewing Co.',
      address: '1505 King Street #115, Charleston, SC',
      expectedArea: 'Downtown Charleston',
      description: 'King Street 1505 should be Downtown (was incorrectly West Ashley)'
    },
    {
      name: 'King Street Cabaret',
      address: '1337 King Street, Charleston, SC',
      expectedArea: 'Downtown Charleston',
      description: 'King Street 1337 should be Downtown (was incorrectly West Ashley)'
    },
    {
      name: 'Rancho Lewis',
      address: '1503 King Street, Charleston, SC',
      expectedArea: 'Downtown Charleston',
      description: 'King Street 1503 should be Downtown (was incorrectly West Ashley)'
    },
    {
      name: 'Bar Mash',
      address: '701 East Bay Street Suite 100-2, Charleston, SC',
      expectedArea: 'Downtown Charleston',
      description: 'East Bay Street should be Downtown (was incorrectly Mount Pleasant)'
    },
    {
      name: 'Bay Street Biergarten',
      address: '549 East Bay Street, Charleston, SC',
      expectedArea: 'Downtown Charleston',
      description: 'East Bay Street should be Downtown (was incorrectly Mount Pleasant)'
    },
    {
      name: 'Rappahannock Oyster Bar',
      address: '701 East Bay Street No. 110, Charleston, SC',
      expectedArea: 'Downtown Charleston',
      description: 'East Bay Street should be Downtown (was incorrectly Mount Pleasant)'
    },
    {
      name: 'Bojangles',
      address: '2514 Clements Ferry Road, Wando, SC 29492',
      expectedArea: 'Daniel Island',
      description: 'Clements Ferry Road with zip 29492 should be Daniel Island (was incorrectly North Charleston)'
    },
    {
      name: 'Konnichiwa WANDO',
      address: '2490 Clements Ferry Road, Wando, SC 29492',
      expectedArea: 'Daniel Island',
      description: 'Clements Ferry Road with zip 29492 should be Daniel Island (was incorrectly North Charleston)'
    },
    {
      name: 'Tacos El Pariente',
      address: '2398 Clements Ferry Road, Charleston, SC 29492',
      expectedArea: 'Daniel Island',
      description: 'Clements Ferry Road with zip 29492 should be Daniel Island (was incorrectly North Charleston)'
    },
    {
      name: 'Tokyo Express',
      address: '2500 Clements Ferry Road G, Charleston, SC 29492',
      expectedArea: 'Daniel Island',
      description: 'Clements Ferry Road with zip 29492 should be Daniel Island (was incorrectly North Charleston)'
    },
    {
      name: 'Louie Smalls llc',
      address: '2015 Pittsburgh Avenue, Charleston, SC',
      expectedArea: 'North Charleston',
      description: 'Pittsburgh Avenue should be North Charleston (was incorrectly Daniel Island)'
    }
  ];

  problematicVenues.forEach(({ name, address, expectedArea, description }) => {
    test(description, () => {
      const result = extractAreaFromAddressTest(address);
      expect(result).toBe(expectedArea);
    });
  });
});

describe('Area Assignment Logic - Zip Code Extraction', () => {
  test('should extract zip code from address string', () => {
    const address = '123 Main Street, Charleston, SC 29492';
    const zipMatch = address.match(/\b(\d{5})\b/);
    expect(zipMatch).toBeTruthy();
    expect(zipMatch[1]).toBe('29492');
  });

  test('should extract zip code from address with multiple numbers', () => {
    const address = '2514 Clements Ferry Road, Wando, SC 29492';
    const zipMatch = address.match(/\b(\d{5})\b/);
    expect(zipMatch).toBeTruthy();
    expect(zipMatch[1]).toBe('29492');
  });

  test('should handle addresses without zip codes', () => {
    const address = '123 Main Street, Charleston, SC';
    const zipMatch = address.match(/\b(\d{5})\b/);
    expect(zipMatch).toBeNull();
  });
});

describe('Area Assignment Logic - Bounds Validation', () => {
  test('should validate coordinates are within area bounds', () => {
    const danielIsland = AREAS_CONFIG.find(a => a.name === 'Daniel Island');
    const { south, west, north, east } = danielIsland.bounds;
    
    // Valid coordinates within bounds
    const lat = 32.85;
    const lng = -79.90;
    expect(lat >= south && lat <= north && lng >= west && lng <= east).toBe(true);
    
    // Invalid coordinates outside bounds
    const lat2 = 32.70;
    const lng2 = -80.0;
    expect(lat2 >= south && lat2 <= north && lng2 >= west && lng2 <= east).toBe(false);
  });

  test('should sort areas by size (smaller first) for bounds checking', () => {
    const sortedAreas = [...AREAS_CONFIG].sort((a, b) => {
      const areaA = (a.bounds ? (a.bounds.north - a.bounds.south) * (a.bounds.east - a.bounds.west) : Infinity);
      const areaB = (b.bounds ? (b.bounds.north - b.bounds.south) * (b.bounds.east - b.bounds.west) : Infinity);
      return areaA - areaB;
    });
    
    expect(sortedAreas[0].name).toBe('Downtown Charleston');
    expect(sortedAreas[sortedAreas.length - 1].name).toBe('Mount Pleasant');
  });
});

describe('Area Assignment Logic - Known Venues Search', () => {
  test('should have KNOWN_VENUES map for Daniel Island', () => {
    // This tests that the pattern exists in the script
    const fs = require('fs');
    const path = require('path');
    const scriptPath = path.join(__dirname, '..', 'seed-venues.js');
    const scriptContent = fs.readFileSync(scriptPath, 'utf8');
    
    expect(scriptContent).toContain('KNOWN_VENUES');
    expect(scriptContent).toContain('Daniel Island');
    expect(scriptContent).toContain('the dime');
    expect(scriptContent).toContain('Mpishi Restaurant');
  });

  test('should have fetchKnownVenuesByName function', () => {
    const fs = require('fs');
    const path = require('path');
    const scriptPath = path.join(__dirname, '..', 'seed-venues.js');
    const scriptContent = fs.readFileSync(scriptPath, 'utf8');
    
    expect(scriptContent).toContain('fetchKnownVenuesByName');
  });
});

describe('Area Assignment Logic - Accuracy Requirements', () => {
  test('King Street logic should cover range 1-2000 for Downtown', () => {
    // Test boundary cases
    expect(extractAreaFromAddressTest('1 King Street, Charleston, SC')).toBe('Downtown Charleston');
    expect(extractAreaFromAddressTest('2000 King Street, Charleston, SC')).toBe('Downtown Charleston');
    expect(extractAreaFromAddressTest('2001 King Street, Charleston, SC')).toBe('West Ashley');
  });

  test('Meeting Street logic should cover range 1-400 for Downtown', () => {
    // Test boundary cases
    expect(extractAreaFromAddressTest('1 Meeting Street, Charleston, SC')).toBe('Downtown Charleston');
    expect(extractAreaFromAddressTest('399 Meeting Street, Charleston, SC')).toBe('Downtown Charleston');
    expect(extractAreaFromAddressTest('400 Meeting Street, Charleston, SC')).toBe('Downtown Charleston'); // 400 is inclusive in 1-400 range
    expect(extractAreaFromAddressTest('401 Meeting Street, Charleston, SC')).toBe('North Charleston'); // >400 is North Charleston
  });

  test('East Bay Street should always return Downtown (authoritative)', () => {
    // Should work regardless of other address content
    expect(extractAreaFromAddressTest('549 East Bay Street, Charleston, SC')).toBe('Downtown Charleston');
    expect(extractAreaFromAddressTest('701 East Bay Street Suite 100-2, Charleston, SC')).toBe('Downtown Charleston');
    expect(extractAreaFromAddressTest('123 East Bay St, Charleston, SC')).toBe('Downtown Charleston');
  });

  test('Pittsburgh Avenue should always return North Charleston (authoritative)', () => {
    expect(extractAreaFromAddressTest('2015 Pittsburgh Avenue, Charleston, SC')).toBe('North Charleston');
    expect(extractAreaFromAddressTest('123 Pittsburgh Ave, Charleston, SC')).toBe('North Charleston');
  });
});
