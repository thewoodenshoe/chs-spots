const fs = require('fs');
const path = require('path');

describe('Areas Configuration Validation', () => {
  const areasFilePath = path.join(__dirname, '../../data/areas.json');
  let areasData;

  beforeAll(() => {
    // Load areas.json
    if (fs.existsSync(areasFilePath)) {
      const rawData = fs.readFileSync(areasFilePath, 'utf8');
      // Remove JSON comment if present (first line)
      const cleanedData = rawData.replace(/^\/\/.*$/m, '').trim();
      areasData = JSON.parse(cleanedData);
    } else {
      throw new Error(`areas.json not found at ${areasFilePath}`);
    }
  });

  describe('File Exists and is Valid JSON', () => {
    test('areas.json file should exist', () => {
      expect(fs.existsSync(areasFilePath)).toBe(true);
    });

    test('areas.json should be valid JSON', () => {
      expect(() => {
        const rawData = fs.readFileSync(areasFilePath, 'utf8');
        const cleanedData = rawData.replace(/^\/\/.*$/m, '').trim();
        JSON.parse(cleanedData);
      }).not.toThrow();
    });

    test('should be an array', () => {
      expect(Array.isArray(areasData)).toBe(true);
    });

    test('should have at least 7 areas', () => {
      expect(areasData.length).toBeGreaterThanOrEqual(7);
    });
  });

  describe('Area Structure Validation', () => {
    test('each area should have required fields', () => {
      areasData.forEach((area, index) => {
        expect(area).toHaveProperty('name', `Area at index ${index} missing 'name'`);
        expect(area).toHaveProperty('displayName', `Area at index ${index} missing 'displayName'`);
        expect(area).toHaveProperty('center', `Area at index ${index} missing 'center'`);
        expect(area).toHaveProperty('radiusMeters', `Area at index ${index} missing 'radiusMeters'`);
        expect(area).toHaveProperty('bounds', `Area at index ${index} missing 'bounds'`);
      });
    });

    test('each area should have valid center coordinates', () => {
      areasData.forEach((area) => {
        expect(area.center).toHaveProperty('lat');
        expect(area.center).toHaveProperty('lng');
        expect(typeof area.center.lat).toBe('number');
        expect(typeof area.center.lng).toBe('number');
        expect(area.center.lat).toBeGreaterThanOrEqual(32.0);
        expect(area.center.lat).toBeLessThanOrEqual(33.0);
        expect(area.center.lng).toBeGreaterThanOrEqual(-80.5);
        expect(area.center.lng).toBeLessThanOrEqual(-79.5);
      });
    });

    test('each area should have radiusMeters > 0', () => {
      areasData.forEach((area) => {
        expect(typeof area.radiusMeters).toBe('number');
        expect(area.radiusMeters).toBeGreaterThan(0);
        expect(area.radiusMeters).toBeLessThanOrEqual(20000); // Reasonable max
      });
    });

    test('each area should have valid bounds', () => {
      areasData.forEach((area) => {
        expect(area.bounds).toHaveProperty('south');
        expect(area.bounds).toHaveProperty('north');
        expect(area.bounds).toHaveProperty('west');
        expect(area.bounds).toHaveProperty('east');
        
        expect(typeof area.bounds.south).toBe('number');
        expect(typeof area.bounds.north).toBe('number');
        expect(typeof area.bounds.west).toBe('number');
        expect(typeof area.bounds.east).toBe('number');
        
        // Bounds validation: south < north, west < east
        expect(area.bounds.south).toBeLessThan(area.bounds.north);
        expect(area.bounds.west).toBeLessThan(area.bounds.east);
        
        // Bounds should be within Charleston area (rough bounds)
        expect(area.bounds.south).toBeGreaterThanOrEqual(32.5);
        expect(area.bounds.north).toBeLessThanOrEqual(33.0);
        expect(area.bounds.west).toBeGreaterThanOrEqual(-80.5);
        expect(area.bounds.east).toBeLessThanOrEqual(-79.5);
      });
    });

    test('center should be within bounds', () => {
      areasData.forEach((area) => {
        const center = area.center;
        const bounds = area.bounds;
        expect(center.lat).toBeGreaterThanOrEqual(bounds.south);
        expect(center.lat).toBeLessThanOrEqual(bounds.north);
        expect(center.lng).toBeGreaterThanOrEqual(bounds.west);
        expect(center.lng).toBeLessThanOrEqual(bounds.east);
      });
    });
  });

  describe('Area Names Validation', () => {
    test('all areas should have unique names', () => {
      const names = areasData.map(area => area.name);
      const uniqueNames = new Set(names);
      expect(names.length).toBe(uniqueNames.size);
    });

    test('should have expected areas', () => {
      const names = areasData.map(area => area.name);
      const expectedAreas = [
        'Daniel Island',
        'Mount Pleasant',
        'Downtown Charleston',
        "Sullivan's Island",
        'Park Circle',
        'North Charleston',
        'West Ashley'
      ];
      
      expectedAreas.forEach(expectedArea => {
        expect(names).toContain(expectedArea);
      });
    });
  });

  describe('Area Details Logging', () => {
    test('should log area names and radius for confirmation', () => {
      console.log('\n📋 Areas Configuration:');
      areasData.forEach((area) => {
        console.log(`   ${area.displayName || area.name}:`);
        console.log(`     Center: (${area.center.lat}, ${area.center.lng})`);
        console.log(`     Radius: ${area.radiusMeters}m`);
        console.log(`     Bounds: lat ${area.bounds.south} to ${area.bounds.north}, lng ${area.bounds.west} to ${area.bounds.east}`);
        if (area.description) {
          console.log(`     Description: ${area.description}`);
        }
      });
      
      // This test always passes, it's just for logging
      expect(areasData.length).toBeGreaterThan(0);
    });
  });

  describe('Specific Area Validation', () => {
    test('Daniel Island should have extended coverage (radius >= 8000m)', () => {
      const danielIsland = areasData.find(area => area.name === 'Daniel Island');
      expect(danielIsland).toBeDefined();
      expect(danielIsland.radiusMeters).toBeGreaterThanOrEqual(8000);
    });

    test('James Island should have extended coverage if present (radius >= 10000m)', () => {
      const jamesIsland = areasData.find(area => area.name === 'James Island');
      if (jamesIsland) {
        expect(jamesIsland.radiusMeters).toBeGreaterThanOrEqual(10000);
      }
    });

    test('Mount Pleasant should have broad coverage (radius >= 10000m)', () => {
      const mountPleasant = areasData.find(area => area.name === 'Mount Pleasant');
      expect(mountPleasant).toBeDefined();
      expect(mountPleasant.radiusMeters).toBeGreaterThanOrEqual(10000);
    });
  });
});
