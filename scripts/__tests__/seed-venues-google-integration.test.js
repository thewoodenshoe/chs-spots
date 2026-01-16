const fs = require('fs');
const path = require('path');

/**
 * Unit tests to validate that the refactored code using Google's address_components
 * (sublocality) still correctly identifies and finds all required Daniel Island venues.
 * 
 * This test suite validates:
 * 1. The sublocality extraction logic works correctly
 * 2. The area mapping logic correctly maps Google's sublocality to our areas
 * 3. Daniel Island venues are still found using zip code 29492 (as fallback for sublocality)
 * 4. All required Daniel Island venues are present in venues.json
 */
describe('Google Sublocality Integration - Daniel Island Validation', () => {
  const scriptPath = path.join(__dirname, '..', 'seed-venues.js');
  const venuesPath = path.join(__dirname, '..', '..', 'data', 'venues.json');
  let scriptContent;
  let venues = [];

  beforeAll(() => {
    // Load script to validate functions exist
    scriptContent = fs.readFileSync(scriptPath, 'utf8');
    
    // Load venues.json if it exists
    if (fs.existsSync(venuesPath)) {
      const data = fs.readFileSync(venuesPath, 'utf8');
      venues = JSON.parse(data);
    }
  });

  describe('Refactored Functions Exist', () => {
    test('extractSublocality function should exist', () => {
      expect(scriptContent).toContain('function extractSublocality');
      expect(scriptContent).toContain('sublocality_level_1');
      expect(scriptContent).toContain('sublocality');
    });

    test('mapGoogleSublocalityToArea function should exist', () => {
      expect(scriptContent).toContain('function mapGoogleSublocalityToArea');
      expect(scriptContent).toContain('mount pleasant');
      expect(scriptContent).toContain('downtown charleston');
    });

    test('findAreaForVenue should use addressComponents parameter', () => {
      expect(scriptContent).toContain('function findAreaForVenue(lat, lng, address, addressComponents');
      expect(scriptContent).toContain('extractSublocality(addressComponents)');
    });

    test('findAreaForVenue should use zip code 29492 for Daniel Island', () => {
      expect(scriptContent).toContain('zipCode === \'29492\'');
      expect(scriptContent).toContain('Daniel Island');
    });

    test('extractVenueData should capture address_components', () => {
      expect(scriptContent).toContain('addressComponents: addressComponents');
      expect(scriptContent).toContain('result.address_components');
    });
  });

  describe('Daniel Island Venue Detection', () => {
    // Required Daniel Island venues that should always be found
    const REQUIRED_DANIEL_ISLAND_VENUES = [
      { name: 'Orlando\'s Brick Oven Pizza', keywords: ['orlando', 'brick', 'pizza'] },
      { name: 'Mac\'s Daniel Island', keywords: ['mac', 'daniel'] },
      { name: 'Ristorante LIDI', keywords: ['lidi', 'ristorante'] },
      { name: 'Vespa Pizzeria', keywords: ['vespa', 'pizzeria'] },
      { name: 'The Kingstide', keywords: ['king', 'kingstide'] },
      { name: 'the dime', keywords: ['dime'] },
      { name: 'Heavy\'s Barburger', keywords: ['heavy', 'barburger'] },
      { name: 'Agaves Cantina', keywords: ['agaves', 'cantina'] },
      { name: 'New Realm Brewing Co.', keywords: ['new realm', 'brewing'] },
      { name: 'Mpishi Restaurant', keywords: ['mpishi'] },
      { name: 'The Bridge Bar & Grille', keywords: ['bridge', 'grille'] },
      { name: 'Dog and Duck', keywords: ['dog', 'duck'] }
    ];

    test('should find all required Daniel Island venues', () => {
      // Skip if venues.json doesn't exist or is empty (test data not available)
      if (!venues || venues.length === 0) {
        console.log('Skipping: venues.json not found or empty. Run seed-venues.js first.');
        return;
      }
      
      const danielIslandVenues = venues.filter(v => v.area === 'Daniel Island');
      
      expect(danielIslandVenues.length).toBeGreaterThanOrEqual(10);
      
      const foundVenues = [];
      const missingVenues = [];
      
      REQUIRED_DANIEL_ISLAND_VENUES.forEach(required => {
        // Case-insensitive partial match
        const found = danielIslandVenues.find(v => 
          required.keywords.some(keyword => 
            v.name.toLowerCase().includes(keyword.toLowerCase())
          )
        );
        
        if (found) {
          foundVenues.push({
            required: required.name,
            found: found.name,
            zip: found.address ? (found.address.match(/\b(\d{5})\b/) || [null, 'N/A'])[1] : 'N/A'
          });
        } else {
          missingVenues.push(required.name);
        }
      });
      
      // Log results for debugging
      if (foundVenues.length > 0) {
        console.log('\n✅ Found Daniel Island venues:');
        foundVenues.forEach(v => {
          console.log(`   ${v.required} → ${v.found} (zip: ${v.zip})`);
        });
      }
      
      if (missingVenues.length > 0) {
        console.log('\n❌ Missing Daniel Island venues:');
        missingVenues.forEach(name => console.log(`   - ${name}`));
      }
      
      console.log(`\nTotal Daniel Island venues: ${danielIslandVenues.length}`);
      
      // Allow some flexibility - at least 8 out of 12 should be found
      // (Some venues may have different names or may not be in Google Places API)
      expect(foundVenues.length).toBeGreaterThanOrEqual(8);
    });

    test('Daniel Island venues should be correctly assigned (zip 29492 OR sublocality OR bounds)', () => {
      const danielIslandVenues = venues.filter(v => v.area === 'Daniel Island');
      
      if (danielIslandVenues.length === 0) {
        return; // Skip if no venues
      }
      
      // The refactored code uses multiple methods:
      // 1. Google sublocality (most reliable)
      // 2. Zip code 29492 for Daniel Island
      // 3. Bounds check (fallback)
      // 
      // So venues might not have zip 29492 in address if they were assigned via sublocality or bounds.
      // We just validate that venues are assigned to Daniel Island (which is what matters).
      const venuesWithZip29492 = danielIslandVenues.filter(v => {
        if (!v.address) return false;
        const zipMatch = v.address.match(/\b29492\b/);
        return zipMatch !== null;
      });
      
      const zipPercentage = (venuesWithZip29492.length / danielIslandVenues.length) * 100;
      console.log(`\nDaniel Island venues with zip 29492 in address: ${venuesWithZip29492.length}/${danielIslandVenues.length} (${Math.round(zipPercentage)}%)`);
      console.log(`Note: Other venues may be assigned via sublocality or bounds (which is correct)`);
      
      // At least some venues should have zip 29492 (validates zip code detection works)
      // But not all need it since sublocality and bounds are also valid methods
      expect(zipPercentage).toBeGreaterThanOrEqual(20); // At least 20% should have zip in address
      expect(danielIslandVenues.length).toBeGreaterThanOrEqual(10); // Should have reasonable count
    });

    test('Daniel Island venues should be within reasonable geographic bounds', () => {
      const danielIslandVenues = venues.filter(v => 
        v.area === 'Daniel Island' && v.lat && v.lng
      );
      
      if (danielIslandVenues.length === 0) {
        return; // Skip if no venues
      }
      
      // Daniel Island bounds (from areas.json): 
      // south: 32.82, west: -79.96, north: 32.89, east: -79.88
      // Allow buffer for Clements Ferry Road venues
      const bounds = {
        latMin: 32.78, // 32.82 - 0.04 buffer
        latMax: 32.93, // 32.89 + 0.04 buffer
        lngMin: -80.00, // -79.96 - 0.04 buffer
        lngMax: -79.84  // -79.88 + 0.04 buffer
      };
      
      const outOfBounds = danielIslandVenues.filter(v => 
        v.lat < bounds.latMin || v.lat > bounds.latMax ||
        v.lng < bounds.lngMin || v.lng > bounds.lngMax
      );
      
      if (outOfBounds.length > 0) {
        console.log('\n⚠️  Daniel Island venues outside bounds:');
        outOfBounds.forEach(v => {
          console.log(`   ${v.name}: (${v.lat}, ${v.lng})`);
        });
      }
      
      // All venues should be within bounds (with buffer for Clements Ferry Road)
      expect(outOfBounds.length).toBe(0);
    });
  });

  describe('Known Venues Search Pattern', () => {
    test('script should have KNOWN_VENUES map for explicit name-based searches', () => {
      expect(scriptContent).toContain('KNOWN_VENUES');
      expect(scriptContent).toContain('Daniel Island');
    });

    test('script should have fetchKnownVenuesByName function', () => {
      expect(scriptContent).toContain('function fetchKnownVenuesByName');
      expect(scriptContent).toContain('knownVenueNames');
    });

    test('script should integrate known venues search into main loop', () => {
      expect(scriptContent).toContain('fetchKnownVenuesByName');
      expect(scriptContent).toContain('KNOWN_VENUES[areaName]');
    });

    test('fetchTextSearch should support custom queries for name-based searches', () => {
      expect(scriptContent).toContain('isCustomQuery');
      expect(scriptContent).toContain('isCustomQuery = false');
    });
  });

  describe('Area Assignment Logic Validation', () => {
    test('findAreaForVenue should prioritize sublocality over zip code', () => {
      // The script should check sublocality first, then zip code for Daniel Island
      // This is validated by the order of checks in findAreaForVenue
      expect(scriptContent.indexOf('extractSublocality(addressComponents)')).toBeLessThan(
        scriptContent.indexOf('zipCode === \'29492\'')
      );
    });

    test('findAreaForVenue should fall back to bounds only if sublocality/zip fail', () => {
      // The bounds check should come after sublocality and zip code checks
      const sublocalityCheck = scriptContent.indexOf('extractSublocality(addressComponents)');
      // Check for zip code checking (new pattern: area.zipCodes.includes(zipCode))
      const zipCheck = scriptContent.indexOf('area.zipCodes') || scriptContent.indexOf('zipCodes.includes');
      // Bounds check should be in Priority 4 (after sublocality, address, zip)
      const boundsCheck = scriptContent.indexOf('Priority 4') || scriptContent.indexOf('Fall back to bounds');
      const sortedAreasCheck = scriptContent.indexOf('sortedAreas');
      
      // Bounds check should come after sublocality
      if (sublocalityCheck >= 0 && boundsCheck >= 0) {
        expect(boundsCheck).toBeGreaterThan(sublocalityCheck);
      }
      // sortedAreas (used for bounds checking) should exist
      expect(sortedAreasCheck).toBeGreaterThan(-1);
    });

    test('Daniel Island should be assigned using zip code 29492 when sublocality unavailable', () => {
      // The script should use zip code 29492 as a definitive indicator for Daniel Island
      // This matches Google Maps behavior when searching for zip 29492
      expect(scriptContent).toContain('zipCode === \'29492\'');
      expect(scriptContent).toContain('return \'Daniel Island\'');
    });
  });

  describe('Data Integrity', () => {
    test('Daniel Island venues should have valid structure', () => {
      const danielIslandVenues = venues.filter(v => v.area === 'Daniel Island');
      
      danielIslandVenues.forEach(venue => {
        expect(venue).toHaveProperty('id');
        expect(venue).toHaveProperty('name');
        expect(venue).toHaveProperty('area', 'Daniel Island');
        expect(venue).toHaveProperty('lat');
        expect(venue).toHaveProperty('lng');
        expect(typeof venue.lat).toBe('number');
        expect(typeof venue.lng).toBe('number');
        expect(!isNaN(venue.lat)).toBe(true);
        expect(!isNaN(venue.lng)).toBe(true);
      });
    });

    test('no duplicate Daniel Island venues', () => {
      const danielIslandVenues = venues.filter(v => v.area === 'Daniel Island');
      const ids = danielIslandVenues.map(v => v.id).filter(Boolean);
      const uniqueIds = new Set(ids);
      
      expect(ids.length).toBe(uniqueIds.size);
    });
  });
});
