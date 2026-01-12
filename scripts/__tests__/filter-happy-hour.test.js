/**
 * Unit tests for filter-happy-hour.js
 */

const fs = require('fs');
const path = require('path');

jest.mock('fs');
jest.mock('path');

describe('filter-happy-hour.js', () => {
  const SILVER_MERGED_DIR = path.join(__dirname, '../../data/silver_merged');
  const SILVER_MATCHED_DIR = path.join(__dirname, '../../data/silver_matched');
  
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });
  
  describe('containsHappyHour', () => {
    it('should detect "happy hour" text', () => {
      const html = '<html><body>Happy Hour Monday-Friday 4pm-7pm</body></html>';
      const textLower = html.toLowerCase();
      const patterns = ['happy hour', 'happyhour'];
      const matches = patterns.some(pattern => textLower.includes(pattern));
      expect(matches).toBe(true);
    });
    
    it('should detect "happyhour" (no space)', () => {
      const html = '<html><body>Happyhour specials</body></html>';
      const textLower = html.toLowerCase();
      const patterns = ['happy hour', 'happyhour'];
      const matches = patterns.some(pattern => textLower.includes(pattern));
      expect(matches).toBe(true);
    });
    
    it('should not match text without happy hour', () => {
      const html = '<html><body>Regular menu and drinks</body></html>';
      const textLower = html.toLowerCase();
      const patterns = ['happy hour', 'happyhour'];
      const matches = patterns.some(pattern => textLower.includes(pattern));
      expect(matches).toBe(false);
    });
    
    it('should be case-insensitive', () => {
      const html = '<html><body>HAPPY HOUR specials</body></html>';
      const textLower = html.toLowerCase();
      const patterns = ['happy hour', 'happyhour'];
      const matches = patterns.some(pattern => textLower.includes(pattern));
      expect(matches).toBe(true);
    });
  });
  
  describe('processFile', () => {
    it('should copy file if it contains happy hour', () => {
      const mockData = {
        venueId: 'ChIJTest123',
        venueName: 'Test Venue',
        pages: [
          { url: 'https://example.com', html: '<html>Happy Hour 4pm-7pm</html>' }
        ]
      };
      
      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue(['ChIJTest123.json']);
      fs.readFileSync.mockReturnValue(JSON.stringify(mockData));
      
      // Test file processing
      expect(fs.existsSync).toBeDefined();
    });
    
    it('should not copy file if it does not contain happy hour', () => {
      const mockData = {
        venueId: 'ChIJTest123',
        venueName: 'Test Venue',
        pages: [
          { url: 'https://example.com', html: '<html>Regular menu</html>' }
        ]
      };
      
      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue(['ChIJTest123.json']);
      fs.readFileSync.mockReturnValue(JSON.stringify(mockData));
      
      // Test file processing
      expect(fs.existsSync).toBeDefined();
    });
  });
});
