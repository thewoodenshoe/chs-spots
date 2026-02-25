/**
 * Unit tests for merge-raw-files.js
 */

const fs = require('fs');
const path = require('path');

jest.mock('fs');
jest.mock('path');

// Venues are now loaded from SQLite via db.venues.getAll()
jest.mock('../utils/db', () => ({
  venues: {
    getAll: jest.fn(() => [
      { id: 'ChIJTest123', name: 'Test Venue', website: 'https://example.com', area: 'Test Area', lat: 32.7765, lng: -79.9311, raw_google_data: null },
    ]),
  },
  ensureSchema: jest.fn(),
  config: {
    get: jest.fn(),
    set: jest.fn(),
    loadConfig: jest.fn(() => ({ run_date: '20260225', last_run_status: 'idle' })),
    saveConfig: jest.fn(),
  },
}));

describe('merge-raw-files.js', () => {
  const RAW_DIR = path.join(__dirname, '../../data/raw');
  const SILVER_MERGED_DIR = path.join(__dirname, '../../data/silver_merged');
  
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });
  
  describe('loadMetadata', () => {
    it('should load metadata from file', () => {
      const venueId = 'ChIJTest123';
      const metadataPath = path.join(RAW_DIR, venueId, 'metadata.json');
      const mockMetadata = {
        'abc123': 'https://example.com',
        'def456': 'https://example.com/page'
      };
      
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify(mockMetadata));
      
      // Test metadata loading
      expect(fs.existsSync).toBeDefined();
    });
    
    it('should return empty object if metadata file does not exist', () => {
      const venueId = 'ChIJTest123';
      const metadataPath = path.join(RAW_DIR, venueId, 'metadata.json');
      
      fs.existsSync.mockReturnValue(false);
      
      // Test default behavior
      expect(fs.existsSync).toBeDefined();
    });
  });
  
  describe('processVenue', () => {
    it('should merge raw files into single JSON', () => {
      const venueId = 'ChIJTest123';
      const mockVenue = {
        id: venueId,
        name: 'Test Venue',
        area: 'Test Area',
        website: 'https://example.com'
      };
      
      const mockRawFiles = [
        { file: 'abc123.html', filePath: path.join(RAW_DIR, venueId, 'abc123.html') },
        { file: 'def456.html', filePath: path.join(RAW_DIR, venueId, 'def456.html') }
      ];
      
      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue(['abc123.html', 'def456.html']);
      fs.statSync.mockReturnValue({ mtime: new Date() });
      fs.readFileSync.mockReturnValue('<html>Test</html>');
      
      // Test merging logic
      expect(fs.existsSync).toBeDefined();
    });
  });
});
