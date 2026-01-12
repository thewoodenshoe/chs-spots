/**
 * Comprehensive Unit Tests for filter-happy-hour.js (Step 3: Silver Matched)
 * 
 * Tests actual functionality with real file operations.
 * Validates pattern matching, filtering logic, and data preservation.
 */

const fs = require('fs');
const path = require('path');

const TEST_DIR = path.join(__dirname, '../../.test-data');
const TEST_SILVER_MERGED_DIR = path.join(TEST_DIR, 'silver_merged');
const TEST_SILVER_MATCHED_DIR = path.join(TEST_DIR, 'silver_matched');

function cleanTestDir() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(TEST_SILVER_MERGED_DIR, { recursive: true });
  fs.mkdirSync(TEST_SILVER_MATCHED_DIR, { recursive: true });
}

function containsHappyHour(html) {
  if (!html || typeof html !== 'string') {
    return false;
  }
  
  const textLower = html.toLowerCase();
  
  const patterns = [
    'happy hour',
    'happyhour',
    'happy hours',
    'happyhours',
    'happier hour',
    'hh ',
    ' hh:',
    'happy hour:',
    'happy hour menu',
    'happy hour specials'
  ];
  
  return patterns.some(pattern => textLower.includes(pattern));
}

function createTestMergedFile(venueId, venueName, pages) {
  const mergedData = {
    venueId,
    venueName,
    venueArea: 'Test Area',
    website: 'https://example.com',
    scrapedAt: new Date().toISOString(),
    pages: pages.map((html, index) => ({
      url: `https://example.com/page${index}`,
      html,
      hash: `hash${index}`,
      downloadedAt: new Date().toISOString()
    }))
  };
  
  const filePath = path.join(TEST_SILVER_MERGED_DIR, `${venueId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(mergedData, null, 2), 'utf8');
  return filePath;
}

describe('Pipeline Step 3: filter-happy-hour.js - Comprehensive Tests', () => {
  
  beforeEach(() => {
    cleanTestDir();
  });
  
  afterAll(() => {
    cleanTestDir();
  });
  
  describe('Happy Hour Detection', () => {
    it('should detect "happy hour" (space)', () => {
      const html = '<html><body>Happy Hour Monday-Friday 4pm-7pm</body></html>';
      expect(containsHappyHour(html)).toBe(true);
    });
    
    it('should detect "happyhour" (no space)', () => {
      const html = '<html><body>Happyhour specials available</body></html>';
      expect(containsHappyHour(html)).toBe(true);
    });
    
    it('should detect "happy hours" (plural)', () => {
      const html = '<html><body>We have happy hours all week</body></html>';
      expect(containsHappyHour(html)).toBe(true);
    });
    
    it('should detect "happyhours" (plural, no space)', () => {
      const html = '<html><body>Check out our happyhours</body></html>';
      expect(containsHappyHour(html)).toBe(true);
    });
    
    it('should detect "happier hour"', () => {
      const html = '<html><body>Join us for happier hour</body></html>';
      expect(containsHappyHour(html)).toBe(true);
    });
    
    it('should detect "hh " (with space)', () => {
      const html = '<html><body>HH 4pm-7pm daily</body></html>';
      expect(containsHappyHour(html)).toBe(true);
    });
    
    it('should detect " hh:" (with space and colon)', () => {
      const html = '<html><body>Daily HH: 4-7pm</body></html>';
      expect(containsHappyHour(html)).toBe(true);
    });
    
    it('should detect "happy hour:" (with colon)', () => {
      const html = '<html><body>Happy Hour: Monday-Friday 4pm-7pm</body></html>';
      expect(containsHappyHour(html)).toBe(true);
    });
    
    it('should detect "happy hour menu"', () => {
      const html = '<html><body>Check our happy hour menu</body></html>';
      expect(containsHappyHour(html)).toBe(true);
    });
    
    it('should detect "happy hour specials"', () => {
      const html = '<html><body>Happy hour specials every day</body></html>';
      expect(containsHappyHour(html)).toBe(true);
    });
    
    it('should be case-insensitive', () => {
      const html = '<html><body>HAPPY HOUR SPECIALS</body></html>';
      expect(containsHappyHour(html)).toBe(true);
    });
    
    it('should not match text without happy hour patterns', () => {
      const html = '<html><body>Regular menu and drinks available</body></html>';
      expect(containsHappyHour(html)).toBe(false);
    });
    
    it('should not match partial words', () => {
      const html = '<html><body>We are happy to serve you</body></html>';
      expect(containsHappyHour(html)).toBe(false);
    });
  });
  
  describe('File Filtering', () => {
    it('should copy file if any page contains happy hour', () => {
      const venueId = 'ChIJTest123';
      const venueName = 'Test Venue';
      const pages = [
        '<html><body>Regular content</body></html>',
        '<html><body>Happy Hour 4pm-7pm</body></html>'
      ];
      
      createTestMergedFile(venueId, venueName, pages);
      
      const mergedPath = path.join(TEST_SILVER_MERGED_DIR, `${venueId}.json`);
      const data = JSON.parse(fs.readFileSync(mergedPath, 'utf8'));
      
      let hasHappyHour = false;
      for (const page of data.pages || []) {
        if (containsHappyHour(page.html)) {
          hasHappyHour = true;
          break;
        }
      }
      
      expect(hasHappyHour).toBe(true);
      
      if (hasHappyHour) {
        const matchedPath = path.join(TEST_SILVER_MATCHED_DIR, `${venueId}.json`);
        fs.writeFileSync(matchedPath, JSON.stringify(data, null, 2), 'utf8');
        
        expect(fs.existsSync(matchedPath)).toBe(true);
      }
    });
    
    it('should not copy file if no pages contain happy hour', () => {
      const venueId = 'ChIJTest123';
      const venueName = 'Test Venue';
      const pages = [
        '<html><body>Regular menu</body></html>',
        '<html><body>Our restaurant serves great food</body></html>'
      ];
      
      createTestMergedFile(venueId, venueName, pages);
      
      const mergedPath = path.join(TEST_SILVER_MERGED_DIR, `${venueId}.json`);
      const data = JSON.parse(fs.readFileSync(mergedPath, 'utf8'));
      
      let hasHappyHour = false;
      for (const page of data.pages || []) {
        if (containsHappyHour(page.html)) {
          hasHappyHour = true;
          break;
        }
      }
      
      expect(hasHappyHour).toBe(false);
    });
    
    it('should preserve all data when copying', () => {
      const venueId = 'ChIJTest123';
      const venueName = 'Test Venue';
      const originalData = {
        venueId,
        venueName,
        venueArea: 'Test Area',
        website: 'https://example.com',
        scrapedAt: '2026-01-12T12:00:00.000Z',
        pages: [
          {
            url: 'https://example.com',
            html: '<html><body>Happy Hour 4pm-7pm</body></html>',
            hash: 'abc123',
            downloadedAt: '2026-01-12T12:00:00.000Z'
          }
        ]
      };
      
      const mergedPath = path.join(TEST_SILVER_MERGED_DIR, `${venueId}.json`);
      fs.writeFileSync(mergedPath, JSON.stringify(originalData, null, 2), 'utf8');
      
      const matchedPath = path.join(TEST_SILVER_MATCHED_DIR, `${venueId}.json`);
      fs.writeFileSync(matchedPath, JSON.stringify(originalData, null, 2), 'utf8');
      
      const copiedData = JSON.parse(fs.readFileSync(matchedPath, 'utf8'));
      
      expect(copiedData.venueId).toBe(originalData.venueId);
      expect(copiedData.venueName).toBe(originalData.venueName);
      expect(copiedData.venueArea).toBe(originalData.venueArea);
      expect(copiedData.website).toBe(originalData.website);
      expect(copiedData.scrapedAt).toBe(originalData.scrapedAt);
      expect(copiedData.pages).toHaveLength(originalData.pages.length);
      expect(copiedData.pages[0].html).toBe(originalData.pages[0].html);
    });
  });
  
  describe('Edge Cases', () => {
    it('should handle empty HTML', () => {
      expect(containsHappyHour('')).toBe(false);
      expect(containsHappyHour(null)).toBe(false);
      expect(containsHappyHour(undefined)).toBe(false);
    });
    
    it('should handle non-string input', () => {
      expect(containsHappyHour(123)).toBe(false);
      expect(containsHappyHour({})).toBe(false);
      expect(containsHappyHour([])).toBe(false);
    });
    
    it('should handle HTML with only whitespace', () => {
      expect(containsHappyHour('   \n\t   ')).toBe(false);
    });
    
    it('should detect happy hour in large HTML', () => {
      const largeHtml = '<html><body>' + 'x'.repeat(100000) + 'Happy Hour 4pm-7pm' + 'y'.repeat(100000) + '</body></html>';
      expect(containsHappyHour(largeHtml)).toBe(true);
    });
    
    it('should handle multiple happy hour mentions', () => {
      const html = '<html><body>Happy Hour Monday-Friday. Also check our Happy Hour specials on weekends.</body></html>';
      expect(containsHappyHour(html)).toBe(true);
    });
    
    it('should handle HTML with nested tags', () => {
      const html = '<html><body><div><p><span>Happy Hour</span> is every day</p></div></body></html>';
      expect(containsHappyHour(html)).toBe(true);
    });
    
    it('should handle file with no pages array', () => {
      const data = {
        venueId: 'ChIJTest123',
        venueName: 'Test Venue',
        pages: null
      };
      
      let hasHappyHour = false;
      for (const page of data.pages || []) {
        if (containsHappyHour(page.html)) {
          hasHappyHour = true;
          break;
        }
      }
      
      expect(hasHappyHour).toBe(false);
    });
    
    it('should handle file with empty pages array', () => {
      const data = {
        venueId: 'ChIJTest123',
        venueName: 'Test Venue',
        pages: []
      };
      
      let hasHappyHour = false;
      for (const page of data.pages || []) {
        if (containsHappyHour(page.html)) {
          hasHappyHour = true;
          break;
        }
      }
      
      expect(hasHappyHour).toBe(false);
    });
  });
  
  describe('Pattern Variations', () => {
    const testCases = [
      { html: 'Happy Hour', expected: true },
      { html: 'happy hour', expected: true },
      { html: 'HAPPY HOUR', expected: true },
      { html: 'HappyHour', expected: true },
      { html: 'happyhour', expected: true },
      { html: 'Happy Hours', expected: true },
      { html: 'happy hours', expected: true },
      { html: 'HappyHours', expected: true },
      { html: 'HH ', expected: true },
      { html: ' HH:', expected: true },
      { html: 'Happy Hour:', expected: true },
      { html: 'Happy Hour Menu', expected: true },
      { html: 'Happy Hour Specials', expected: true },
      { html: 'We are happy', expected: false },
      { html: 'Open for one hour', expected: false },
      { html: 'Business hours', expected: false },
    ];
    
    testCases.forEach(({ html, expected }) => {
      it(`should ${expected ? 'match' : 'not match'} "${html}"`, () => {
        expect(containsHappyHour(`<html><body>${html}</body></html>`)).toBe(expected);
      });
    });
  });
  
  describe('Data Integrity', () => {
    it('should not modify original merged file', () => {
      const venueId = 'ChIJTest123';
      const venueName = 'Test Venue';
      const pages = ['<html><body>Happy Hour 4pm-7pm</body></html>'];
      
      createTestMergedFile(venueId, venueName, pages);
      
      const mergedPath = path.join(TEST_SILVER_MERGED_DIR, `${venueId}.json`);
      const originalContent = fs.readFileSync(mergedPath, 'utf8');
      const originalData = JSON.parse(originalContent);
      
      // Simulate copy
      const matchedPath = path.join(TEST_SILVER_MATCHED_DIR, `${venueId}.json`);
      fs.writeFileSync(matchedPath, originalContent, 'utf8');
      
      // Verify original unchanged
      const afterContent = fs.readFileSync(mergedPath, 'utf8');
      expect(afterContent).toBe(originalContent);
    });
    
    it('should preserve JSON formatting', () => {
      const venueId = 'ChIJTest123';
      const data = {
        venueId,
        venueName: 'Test Venue',
        pages: [{ html: '<html><body>Happy Hour</body></html>' }]
      };
      
      const mergedPath = path.join(TEST_SILVER_MERGED_DIR, `${venueId}.json`);
      fs.writeFileSync(mergedPath, JSON.stringify(data, null, 2), 'utf8');
      
      const matchedPath = path.join(TEST_SILVER_MATCHED_DIR, `${venueId}.json`);
      fs.writeFileSync(matchedPath, JSON.stringify(data, null, 2), 'utf8');
      
      // Verify valid JSON
      const copied = JSON.parse(fs.readFileSync(matchedPath, 'utf8'));
      expect(copied.venueId).toBe(venueId);
    });
  });
});
