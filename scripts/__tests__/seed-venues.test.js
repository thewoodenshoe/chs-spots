const fs = require('fs');
const path = require('path');

describe('Venue Seeding Script Validation', () => {
  const venuesPath = path.join(__dirname, '..', '..', 'data', 'venues.json');
  let venues = [];

  beforeAll(() => {
    // Load venues.json if it exists
    if (fs.existsSync(venuesPath)) {
      const data = fs.readFileSync(venuesPath, 'utf8');
      venues = JSON.parse(data);
    }
  });

  describe('Data File Exists and is Valid', () => {
    test('venues.json file should exist', () => {
      expect(fs.existsSync(venuesPath)).toBe(true);
    });

    test('venues.json should be valid JSON', () => {
      expect(Array.isArray(venues)).toBe(true);
    });

    test('should have more than 300 venues', () => {
      expect(venues.length).toBeGreaterThan(300);
    });
  });

  describe('No Duplicates', () => {
    test('all venue IDs should be unique', () => {
      const ids = venues.map(v => v.id).filter(Boolean);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    test('should not have duplicate place IDs', () => {
      const seenIds = new Set();
      const duplicates = [];
      
      for (const venue of venues) {
        if (venue.id) {
          if (seenIds.has(venue.id)) {
            duplicates.push(venue.id);
          }
          seenIds.add(venue.id);
        }
      }
      
      expect(duplicates).toEqual([]);
    });
  });

  describe('Venues per Area', () => {
    test('Daniel Island should have approximately 10+ venues', () => {
      const danielIsland = venues.filter(v => v.area === 'Daniel Island');
      expect(danielIsland.length).toBeGreaterThanOrEqual(10);
    });

    test('Mount Pleasant should have approximately 100+ venues', () => {
      const mountPleasant = venues.filter(v => v.area === 'Mount Pleasant');
      expect(mountPleasant.length).toBeGreaterThanOrEqual(100);
    });

    test('should have venues in expected areas', () => {
      const areas = new Set(venues.map(v => v.area).filter(Boolean));
      const expectedAreas = [
        'Daniel Island',
        'Mount Pleasant',
        'James Island',
        'Downtown Charleston',
        'Sullivan\'s Island'
      ];
      
      // Check that at least some expected areas exist
      const foundAreas = expectedAreas.filter(area => areas.has(area));
      expect(foundAreas.length).toBeGreaterThan(0);
    });
  });

  describe('Location Bounds Validation', () => {
    // Charleston area bounds (approximate)
    const AREA_BOUNDS = {
      'Daniel Island': { latMin: 32.82, latMax: 32.89, lngMin: -79.96, lngMax: -79.88 },
      'Mount Pleasant': { latMin: 32.75, latMax: 32.85, lngMin: -79.95, lngMax: -79.80 },
      'James Island': { latMin: 32.70, latMax: 32.75, lngMin: -79.98, lngMax: -79.90 },
      'Downtown Charleston': { latMin: 32.76, latMax: 32.80, lngMin: -79.96, lngMax: -79.91 },
      'Sullivan\'s Island': { latMin: 32.75, latMax: 32.77, lngMin: -79.87, lngMax: -79.83 }
    };

    test('venues should have valid lat/lng coordinates', () => {
      const venuesWithCoords = venues.filter(v => 
        v.lat !== null && 
        v.lng !== null && 
        typeof v.lat === 'number' && 
        typeof v.lng === 'number' &&
        !isNaN(v.lat) && 
        !isNaN(v.lng)
      );
      
      expect(venuesWithCoords.length).toBeGreaterThan(venues.length * 0.9); // At least 90% should have coords
    });

    test('Daniel Island venues should be within reasonable bounds', () => {
      const danielIsland = venues.filter(v => v.area === 'Daniel Island' && v.lat && v.lng);
      const bounds = AREA_BOUNDS['Daniel Island'];
      
      if (danielIsland.length > 0) {
        danielIsland.forEach(venue => {
          expect(venue.lat).toBeGreaterThanOrEqual(bounds.latMin - 0.1); // Allow some margin
          expect(venue.lat).toBeLessThanOrEqual(bounds.latMax + 0.1);
          expect(venue.lng).toBeGreaterThanOrEqual(bounds.lngMin - 0.1);
          expect(venue.lng).toBeLessThanOrEqual(bounds.lngMax + 0.1);
        });
      }
    });

    test('Mount Pleasant venues should be within reasonable bounds', () => {
      const mountPleasant = venues.filter(v => v.area === 'Mount Pleasant' && v.lat && v.lng);
      const bounds = AREA_BOUNDS['Mount Pleasant'];
      
      if (mountPleasant.length > 0) {
        mountPleasant.forEach(venue => {
          expect(venue.lat).toBeGreaterThanOrEqual(bounds.latMin - 0.1);
          expect(venue.lat).toBeLessThanOrEqual(bounds.latMax + 0.1);
          expect(venue.lng).toBeGreaterThanOrEqual(bounds.lngMin - 0.1);
          expect(venue.lng).toBeLessThanOrEqual(bounds.lngMax + 0.1);
        });
      }
    });

    test('James Island venues should be within reasonable bounds', () => {
      const jamesIsland = venues.filter(v => v.area === 'James Island' && v.lat && v.lng);
      const bounds = AREA_BOUNDS['James Island'];
      
      if (jamesIsland.length > 0) {
        jamesIsland.forEach(venue => {
          expect(venue.lat).toBeGreaterThanOrEqual(bounds.latMin - 0.1);
          expect(venue.lat).toBeLessThanOrEqual(bounds.latMax + 0.1);
          expect(venue.lng).toBeGreaterThanOrEqual(bounds.lngMin - 0.1);
          expect(venue.lng).toBeLessThanOrEqual(bounds.lngMax + 0.1);
        });
      }
    });

    test('all venues should be within Charleston area (broad bounds)', () => {
      const charlestonLatMin = 32.65;
      const charlestonLatMax = 32.95;
      const charlestonLngMin = -80.05;
      const charlestonLngMax = -79.75;
      
      const venuesWithCoords = venues.filter(v => v.lat && v.lng);
      
      venuesWithCoords.forEach(venue => {
        expect(venue.lat).toBeGreaterThanOrEqual(charlestonLatMin);
        expect(venue.lat).toBeLessThanOrEqual(charlestonLatMax);
        expect(venue.lng).toBeGreaterThanOrEqual(charlestonLngMin);
        expect(venue.lng).toBeLessThanOrEqual(charlestonLngMax);
      });
    });
  });

  describe('Website Coverage', () => {
    test('at least 60% of venues should have websites', () => {
      const venuesWithWebsites = venues.filter(v => 
        v.website && 
        v.website.trim() !== '' && 
        (v.website.startsWith('http://') || v.website.startsWith('https://'))
      );
      
      const websitePercentage = venues.length > 0 
        ? (venuesWithWebsites.length / venues.length) * 100 
        : 0;
      
      expect(websitePercentage).toBeGreaterThanOrEqual(60);
    });

    test('websites should be valid URLs', () => {
      const venuesWithWebsites = venues.filter(v => v.website && v.website.trim() !== '');
      
      venuesWithWebsites.forEach(venue => {
        expect(venue.website).toMatch(/^https?:\/\//);
      });
    });
  });

  describe('Data Structure', () => {
    test('each venue should have required fields', () => {
      venues.forEach(venue => {
        expect(venue).toHaveProperty('id');
        expect(venue).toHaveProperty('name');
        expect(venue).toHaveProperty('area');
        expect(typeof venue.name).toBe('string');
        expect(venue.name.length).toBeGreaterThan(0);
      });
    });

    test('venues should have types array', () => {
      const venuesWithTypes = venues.filter(v => 
        Array.isArray(v.types) && v.types.length > 0
      );
      
      expect(venuesWithTypes.length).toBeGreaterThan(venues.length * 0.8); // At least 80% should have types
    });

    test('venues should have address', () => {
      const venuesWithAddress = venues.filter(v => 
        v.address && 
        v.address !== 'Address not available' && 
        v.address.trim() !== ''
      );
      
      expect(venuesWithAddress.length).toBeGreaterThan(venues.length * 0.8); // At least 80% should have address
    });
  });

  describe('Venue Types', () => {
    const EXPECTED_TYPES = ['bar', 'restaurant', 'brewery', 'night_club', 'wine_bar', 'cafe'];

    test('should have venues with expected alcohol-serving types', () => {
      const allTypes = new Set();
      venues.forEach(venue => {
        if (venue.types && Array.isArray(venue.types)) {
          venue.types.forEach(type => allTypes.add(type));
        }
      });
      
      // Check that at least some expected types exist
      const foundTypes = EXPECTED_TYPES.filter(type => allTypes.has(type));
      expect(foundTypes.length).toBeGreaterThan(0);
    });

    test('should have restaurant venues', () => {
      const restaurants = venues.filter(v => 
        v.types && 
        v.types.some(type => type === 'restaurant')
      );
      expect(restaurants.length).toBeGreaterThan(50);
    });

    test('should have bar venues', () => {
      const bars = venues.filter(v => 
        v.types && 
        v.types.some(type => type === 'bar')
      );
      expect(bars.length).toBeGreaterThan(10);
    });
  });
});