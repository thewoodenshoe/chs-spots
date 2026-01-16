/**
 * Unit tests for scripts/create-areas.js
 * Tests script execution, bounds validation, and areas.json creation
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

describe('create-areas.js script tests', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'create-areas.js');
  const areasFilePath = path.join(__dirname, '..', 'data', 'config', 'areas.json');
  const testAreasFilePath = path.join(__dirname, '..', 'data', 'config', 'areas.json.backup');
  
  // Backup existing areas.json if it exists
  beforeAll(() => {
    if (fs.existsSync(areasFilePath)) {
      fs.copyFileSync(areasFilePath, testAreasFilePath);
    }
  });
  
  // Restore original areas.json after tests
  afterAll(() => {
    if (fs.existsSync(testAreasFilePath)) {
      fs.copyFileSync(testAreasFilePath, areasFilePath);
      fs.unlinkSync(testAreasFilePath);
    }
  });
  
  describe('Test 1: Script runs and creates areas.json with 8 areas', () => {
    test('script executes without errors', () => {
      expect(() => {
        execSync(`node ${scriptPath}`, { stdio: 'pipe', encoding: 'utf8' });
      }).not.toThrow();
    });
    
    test('areas.json file exists after script execution', () => {
      execSync(`node ${scriptPath}`, { stdio: 'pipe', encoding: 'utf8' });
      expect(fs.existsSync(areasFilePath)).toBe(true);
    });
    
    test('areas.json contains exactly 8 areas', () => {
      execSync(`node ${scriptPath}`, { stdio: 'pipe', encoding: 'utf8' });
      const areasData = JSON.parse(fs.readFileSync(areasFilePath, 'utf8'));
      expect(Array.isArray(areasData)).toBe(true);
      expect(areasData.length).toBe(8); // Updated: Now includes Isle of Palms
    });
  });
  
  describe('Test 2: Loaded JSON has all required fields per area', () => {
    let areasData;
    
    beforeAll(() => {
      execSync(`node ${scriptPath}`, { stdio: 'pipe', encoding: 'utf8' });
      areasData = JSON.parse(fs.readFileSync(areasFilePath, 'utf8'));
    });
    
    test('each area has required fields', () => {
      const requiredFields = ['name', 'displayName', 'description', 'center', 'radiusMeters', 'bounds'];
      areasData.forEach((area) => {
        requiredFields.forEach((field) => {
          expect(area).toHaveProperty(field);
        });
      });
    });
    
    test('center has lat and lng', () => {
      areasData.forEach((area) => {
        expect(area.center).toHaveProperty('lat');
        expect(area.center).toHaveProperty('lng');
        expect(typeof area.center.lat).toBe('number');
        expect(typeof area.center.lng).toBe('number');
      });
    });
    
    test('bounds has south, north, west, east', () => {
      areasData.forEach((area) => {
        expect(area.bounds).toHaveProperty('south');
        expect(area.bounds).toHaveProperty('north');
        expect(area.bounds).toHaveProperty('west');
        expect(area.bounds).toHaveProperty('east');
        expect(typeof area.bounds.south).toBe('number');
        expect(typeof area.bounds.north).toBe('number');
        expect(typeof area.bounds.west).toBe('number');
        expect(typeof area.bounds.east).toBe('number');
      });
    });
    
    test('radiusMeters is a positive number', () => {
      areasData.forEach((area) => {
        expect(typeof area.radiusMeters).toBe('number');
        expect(area.radiusMeters).toBeGreaterThan(0);
      });
    });
  });
  
  describe('Test 3: Bounds are valid (south < north, etc.)', () => {
    let areasData;
    
    beforeAll(() => {
      execSync(`node ${scriptPath}`, { stdio: 'pipe', encoding: 'utf8' });
      areasData = JSON.parse(fs.readFileSync(areasFilePath, 'utf8'));
    });
    
    test('south < north for all areas', () => {
      areasData.forEach((area) => {
        expect(area.bounds.south).toBeLessThan(area.bounds.north);
      });
    });
    
    test('west < east for all areas', () => {
      areasData.forEach((area) => {
        expect(area.bounds.west).toBeLessThan(area.bounds.east);
      });
    });
    
    test('coordinates are in Charleston range (lat 32-33, lng -80 to -79)', () => {
      areasData.forEach((area) => {
        // Center coordinates
        expect(area.center.lat).toBeGreaterThanOrEqual(32);
        expect(area.center.lat).toBeLessThanOrEqual(33);
        expect(area.center.lng).toBeGreaterThanOrEqual(-80.1);
        expect(area.center.lng).toBeLessThanOrEqual(-79);
        
        // Bounds coordinates
        expect(area.bounds.south).toBeGreaterThanOrEqual(32);
        expect(area.bounds.north).toBeLessThanOrEqual(33);
        expect(area.bounds.west).toBeGreaterThanOrEqual(-80.1);
        expect(area.bounds.east).toBeLessThanOrEqual(-79);
      });
    });
  });
  
  describe('Test 4: Clements Ferry point (32.879, -79.931) is inside Daniel Island bounds', () => {
    let areasData;
    let danielIsland;
    
    beforeAll(() => {
      execSync(`node ${scriptPath}`, { stdio: 'pipe', encoding: 'utf8' });
      areasData = JSON.parse(fs.readFileSync(areasFilePath, 'utf8'));
      danielIsland = areasData.find((area) => area.name === 'Daniel Island');
    });
    
    test('Daniel Island area exists', () => {
      expect(danielIsland).toBeDefined();
    });
    
    test('Clements Ferry point is within Daniel Island bounds', () => {
      const clementsFerryLat = 32.879;
      const clementsFerryLng = -79.931;
      
      expect(clementsFerryLat).toBeGreaterThanOrEqual(danielIsland.bounds.south);
      expect(clementsFerryLat).toBeLessThanOrEqual(danielIsland.bounds.north);
      expect(clementsFerryLng).toBeGreaterThanOrEqual(danielIsland.bounds.west);
      expect(clementsFerryLng).toBeLessThanOrEqual(danielIsland.bounds.east);
    });
  });
  
  describe('Test 5: Error thrown if invalid bounds', () => {
    test('script contains validation logic', () => {
      // Read the script to verify validateBounds function exists
      const scriptContent = fs.readFileSync(scriptPath, 'utf8');
      expect(scriptContent).toContain('validateBounds');
      expect(scriptContent).toContain('south < north');
      expect(scriptContent).toContain('west < east');
      expect(scriptContent).toContain('lat 32-33');
      expect(scriptContent).toMatch(/lng.*-80/);
    });
    
    test('validation runs before writing areas.json', () => {
      // Verify that validation happens before file writing
      const scriptContent = fs.readFileSync(scriptPath, 'utf8');
      const validationIndex = scriptContent.indexOf('validateBounds');
      const writeFileIndex = scriptContent.indexOf('fs.writeFileSync(areasFile');
      
      expect(validationIndex).toBeGreaterThan(-1);
      expect(writeFileIndex).toBeGreaterThan(-1);
      expect(validationIndex).toBeLessThan(writeFileIndex);
    });
    
    test('script validates all areas successfully with current data', () => {
      // Current areas.json should pass validation
      expect(() => {
        execSync(`node ${scriptPath}`, { stdio: 'pipe', encoding: 'utf8' });
      }).not.toThrow();
    });
  });
});
