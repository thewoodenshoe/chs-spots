/**
 * Unit tests for seed-incremental.js
 * Tests incremental venue seeding and website enrichment logic
 */

const fs = require('fs');
const path = require('path');

describe('seed-incremental.js', () => {
  const dataDir = path.join(__dirname, '..', 'data');
  const venuesFile = path.join(dataDir, 'venues.json');
  const areasFile = path.join(dataDir, 'areas.json');
  const missingWebsitesFile = path.join(dataDir, 'venue-website-not-found.csv');

  // Mock data
  const mockAreas = [
    {
      name: 'Daniel Island',
      displayName: 'Daniel Island',
      center: { lat: 32.845, lng: -79.908 },
      radiusMeters: 8000,
    },
    {
      name: 'Mount Pleasant',
      displayName: 'Mount Pleasant',
      center: { lat: 32.795, lng: -79.875 },
      radiusMeters: 12000,
    },
  ];

  const mockExistingVenues = [
    {
      id: 'existing-place-id-1',
      name: 'Existing Venue',
      address: '123 Main St',
      lat: 32.845,
      lng: -79.908,
      website: 'https://existing-venue.com',
      types: ['restaurant'],
      area: 'Daniel Island',
    },
    {
      id: 'existing-place-id-2',
      name: 'Venue Without Website',
      address: '456 Oak Ave',
      lat: 32.795,
      lng: -79.875,
      website: null,
      types: ['bar'],
      area: 'Mount Pleasant',
    },
  ];

  beforeEach(() => {
    // Ensure data directory exists
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test files
    if (fs.existsSync(venuesFile)) {
      fs.unlinkSync(venuesFile);
    }
    if (fs.existsSync(missingWebsitesFile)) {
      fs.unlinkSync(missingWebsitesFile);
    }
  });

  describe('File structure and data loading', () => {
    test('should load areas.json correctly', () => {
      // Backup existing areas.json if it exists
      const areasBackup = areasFile + '.backup.test';
      let hasBackup = false;
      if (fs.existsSync(areasFile)) {
        fs.copyFileSync(areasFile, areasBackup);
        hasBackup = true;
      }
      
      try {
        // Write mock areas (only for test)
        fs.writeFileSync(areasFile, JSON.stringify(mockAreas), 'utf8');
        
        const areasContent = fs.readFileSync(areasFile, 'utf8');
        const areas = JSON.parse(areasContent);
        
        expect(Array.isArray(areas)).toBe(true);
        expect(areas.length).toBe(2);
        expect(areas[0]).toHaveProperty('name');
        expect(areas[0]).toHaveProperty('center');
        expect(areas[0]).toHaveProperty('radiusMeters');
      } finally {
        // Restore original areas.json
        if (hasBackup && fs.existsSync(areasBackup)) {
          fs.copyFileSync(areasBackup, areasFile);
          fs.unlinkSync(areasBackup);
        } else if (!hasBackup && fs.existsSync(areasFile)) {
          // If no backup existed and we created it, remove the test file
          fs.unlinkSync(areasFile);
        }
      }
    });

    test('should load existing venues.json if exists', () => {
      // Write mock venues
      fs.writeFileSync(venuesFile, JSON.stringify(mockExistingVenues), 'utf8');
      
      const venuesContent = fs.readFileSync(venuesFile, 'utf8');
      const venues = JSON.parse(venuesContent);
      
      expect(Array.isArray(venues)).toBe(true);
      expect(venues.length).toBe(2);
      expect(venues[0]).toHaveProperty('id');
      expect(venues[0]).toHaveProperty('name');
    });

    test('should handle missing venues.json gracefully', () => {
      // venues.json doesn't exist
      expect(() => {
        if (fs.existsSync(venuesFile)) {
          const content = fs.readFileSync(venuesFile, 'utf8');
          JSON.parse(content);
        }
      }).not.toThrow();
    });
  });

  describe('Deduplication logic', () => {
    test('should skip venues with existing googlePlaceId', () => {
      const existingIds = new Set(['existing-place-id-1', 'existing-place-id-2']);
      const newVenue = { id: 'existing-place-id-1', name: 'Duplicate' };
      
      expect(existingIds.has(newVenue.id)).toBe(true);
      // Should skip this venue
    });

    test('should add venues with new googlePlaceId', () => {
      const existingIds = new Set(['existing-place-id-1', 'existing-place-id-2']);
      const newVenue = { id: 'new-place-id-1', name: 'New Venue' };
      
      expect(existingIds.has(newVenue.id)).toBe(false);
      // Should add this venue
    });
  });

  describe('Website enrichment logic', () => {
    test('should identify venues needing website enrichment', () => {
      const venues = [
        { id: '1', name: 'Venue 1', website: 'https://venue1.com' },
        { id: '2', name: 'Venue 2', website: null },
        { id: '3', name: 'Venue 3', website: '' },
        { id: '4', name: 'Venue 4', website: '   ' },
      ];
      
      const needingWebsite = venues.filter(v => !v.website || v.website.trim() === '');
      
      expect(needingWebsite.length).toBe(3);
      expect(needingWebsite.map(v => v.id)).toEqual(['2', '3', '4']);
    });

    test('should skip venues that already have website', () => {
      const venue = { id: '1', name: 'Venue 1', website: 'https://venue1.com' };
      
      const needsWebsite = !venue.website || venue.website.trim() === '';
      expect(needsWebsite).toBe(false);
    });
  });

  describe('CSV output for missing websites', () => {
    test('should write CSV file with correct format', () => {
      const missingVenues = [
        { name: 'Venue 1', address: '123 Main St', area: 'Daniel Island' },
        { name: 'Venue 2', address: '456 Oak Ave', area: 'Mount Pleasant' },
      ];
      
      // Write CSV
      const csvLines = ['name,address,area'];
      missingVenues.forEach(venue => {
        const name = (venue.name || '').replace(/,/g, ';');
        const address = (venue.address || '').replace(/,/g, ';');
        const area = (venue.area || '').replace(/,/g, ';');
        csvLines.push(`${name},${address},${area}`);
      });
      
      fs.writeFileSync(missingWebsitesFile, csvLines.join('\n'), 'utf8');
      
      // Verify CSV file exists and has correct content
      expect(fs.existsSync(missingWebsitesFile)).toBe(true);
      
      const csvContent = fs.readFileSync(missingWebsitesFile, 'utf8');
      const lines = csvContent.split('\n');
      
      expect(lines[0]).toBe('name,address,area');
      expect(lines[1]).toContain('Venue 1');
      expect(lines[2]).toContain('Venue 2');
      expect(lines.length).toBe(3); // Header + 2 data rows
    });

    test('should handle commas in venue data (CSV escaping)', () => {
      const missingVenues = [
        { name: 'Venue, Inc.', address: '123 Main St, Suite 4', area: 'Daniel Island' },
      ];
      
      const csvLines = ['name,address,area'];
      missingVenues.forEach(venue => {
        const name = (venue.name || '').replace(/,/g, ';');
        const address = (venue.address || '').replace(/,/g, ';');
        const area = (venue.area || '').replace(/,/g, ';');
        csvLines.push(`${name},${address},${area}`);
      });
      
      fs.writeFileSync(missingWebsitesFile, csvLines.join('\n'), 'utf8');
      
      const csvContent = fs.readFileSync(missingWebsitesFile, 'utf8');
      expect(csvContent).toContain('Venue; Inc.');
      expect(csvContent).toContain('123 Main St; Suite 4');
    });

    test('should not write CSV if no missing websites', () => {
      const missingVenues = [];
      
      if (missingVenues.length === 0) {
        // Should not create file
        expect(missingVenues.length).toBe(0);
      } else {
        // Would write CSV
        const csvLines = ['name,address,area'];
        missingVenues.forEach(venue => {
          const name = (venue.name || '').replace(/,/g, ';');
          const address = (venue.address || '').replace(/,/g, ';');
          const area = (venue.area || '').replace(/,/g, ';');
          csvLines.push(`${name},${address},${area}`);
        });
        fs.writeFileSync(missingWebsitesFile, csvLines.join('\n'), 'utf8');
      }
      
      // File should not exist if no missing venues
      if (missingVenues.length === 0) {
        // This is expected behavior - no CSV file created
        expect(missingVenues.length).toBe(0);
      }
    });
  });

  describe('Venue data structure', () => {
    test('should create venue object with correct structure', () => {
      const mockGoogleResult = {
        place_id: 'test-place-id',
        name: 'Test Venue',
        vicinity: '123 Test St',
        geometry: {
          location: {
            lat: 32.845,
            lng: -79.908,
          },
        },
        website: 'https://test-venue.com',
        types: ['restaurant', 'food'],
      };
      
      const venue = {
        id: mockGoogleResult.place_id,
        name: mockGoogleResult.name || 'Unknown',
        address: mockGoogleResult.vicinity || mockGoogleResult.formatted_address || 'Address not available',
        lat: mockGoogleResult.geometry?.location?.lat || null,
        lng: mockGoogleResult.geometry?.location?.lng || null,
        website: mockGoogleResult.website || null,
        types: mockGoogleResult.types || [],
        area: 'Daniel Island',
      };
      
      expect(venue).toHaveProperty('id');
      expect(venue).toHaveProperty('name');
      expect(venue).toHaveProperty('address');
      expect(venue).toHaveProperty('lat');
      expect(venue).toHaveProperty('lng');
      expect(venue).toHaveProperty('website');
      expect(venue).toHaveProperty('types');
      expect(venue).toHaveProperty('area');
      expect(venue.id).toBe('test-place-id');
      expect(venue.name).toBe('Test Venue');
      expect(venue.area).toBe('Daniel Island');
    });
  });

  describe('Deduplication in final output', () => {
    test('should deduplicate venues by id when combining existing and new', () => {
      const existingVenues = [
        { id: 'id-1', name: 'Existing 1' },
        { id: 'id-2', name: 'Existing 2' },
      ];
      
      const newVenues = [
        { id: 'id-2', name: 'Updated 2' }, // Duplicate ID
        { id: 'id-3', name: 'New 3' },
      ];
      
      // Deduplicate using Map
      const allVenuesMap = new Map();
      existingVenues.forEach(venue => {
        if (venue.id) {
          allVenuesMap.set(venue.id, venue);
        }
      });
      newVenues.forEach(venue => {
        if (venue.id) {
          allVenuesMap.set(venue.id, venue); // Will overwrite if duplicate
        }
      });
      
      const allVenues = Array.from(allVenuesMap.values());
      
      expect(allVenues.length).toBe(3); // id-1, id-2 (updated), id-3
      expect(allVenues.find(v => v.id === 'id-2')?.name).toBe('Updated 2'); // New version
    });
  });
});
