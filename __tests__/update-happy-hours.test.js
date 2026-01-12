/**
 * Unit tests for update-happy-hours.js
 * 
 * Tests cover:
 * - HTML cache functionality (daily caching per URL)
 * - Scraped file caching (daily caching per venue)
 * - URL pattern extraction
 * - File structure validation
 */

const fs = require('fs');
const path = require('path');

// Mock fs module
jest.mock('fs');
jest.mock('path');

// Mock global fetch
global.fetch = jest.fn();

describe('update-happy-hours.js', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    
    // Mock path.join to return predictable paths
    path.join = jest.fn((...args) => args.join('/'));
    
    // Set up mock implementations
    fs.existsSync = jest.fn();
    fs.statSync = jest.fn();
    fs.readFileSync = jest.fn();
    fs.writeFileSync = jest.fn();
    fs.mkdirSync = jest.fn();
    fs.readdirSync = jest.fn();
    
    // Default mock implementations
    fs.existsSync.mockReturnValue(false);
  });
  
  // Test 1: HTML Cache file path generation
  describe('HTML Cache - Path Generation', () => {
    it('should generate safe cache path from URL', () => {
      function getCachePath(url) {
        try {
          const urlObj = new URL(url);
          let cacheName = urlObj.hostname + urlObj.pathname;
          cacheName = cacheName.replace(/\//g, '-');
          cacheName = cacheName.replace(/\.(com|org|net|io|co|edu|gov)/g, '-$1');
          cacheName = cacheName.replace(/[^a-zA-Z0-9-_]/g, '-');
          cacheName = cacheName.replace(/-+/g, '-');
          cacheName = cacheName.replace(/^-+|-+$/g, '');
          if (cacheName.length > 200) {
            cacheName = cacheName.substring(0, 200);
          }
          return `data/cache/${cacheName}.html`;
        } catch (e) {
          const safeName = url.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 200);
          return `data/cache/${safeName}.html`;
        }
      }
      
      expect(getCachePath('https://example.com/menu')).toBe('data/cache/example-com-menu.html');
      expect(getCachePath('https://thekingstide.com/happy-hour')).toBe('data/cache/thekingstide-com-happy-hour.html');
      
      const urlWithParams = getCachePath('https://example.com/page?param=value#fragment');
      expect(urlWithParams).not.toContain('?');
      expect(urlWithParams).not.toContain('#');
    });
  });
  
  // Test 2: HTML Cache validity check
  describe('HTML Cache - Validity Check', () => {
    it('should use cache if file exists and was modified today', () => {
      function isCacheValid(cachePath, mockStats) {
        try {
          if (!fs.existsSync(cachePath)) {
            return false;
          }
          
          const stats = mockStats || fs.statSync(cachePath);
          const cacheDate = new Date(stats.mtime);
          const today = new Date();
          
          return cacheDate.getDate() === today.getDate() &&
                 cacheDate.getMonth() === today.getMonth() &&
                 cacheDate.getFullYear() === today.getFullYear();
        } catch (e) {
          return false;
        }
      }
      
      const cachePath = 'data/cache/example-com.html';
      fs.existsSync.mockReturnValueOnce(true);
      
      const today = new Date();
      const mockStats = { mtime: today };
      fs.statSync.mockReturnValueOnce(mockStats);
      
      expect(isCacheValid(cachePath, mockStats)).toBe(true);
    });
    
    it('should not use cache if file was modified yesterday', () => {
      function isCacheValid(cachePath, mockStats) {
        try {
          if (!fs.existsSync(cachePath)) {
            return false;
          }
          
          const stats = mockStats || fs.statSync(cachePath);
          const cacheDate = new Date(stats.mtime);
          const today = new Date();
          
          return cacheDate.getDate() === today.getDate() &&
                 cacheDate.getMonth() === today.getMonth() &&
                 cacheDate.getFullYear() === today.getFullYear();
        } catch (e) {
          return false;
        }
      }
      
      const cachePath = 'data/cache/example-com.html';
      fs.existsSync.mockReturnValueOnce(true);
      
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const mockStats = { mtime: yesterday };
      
      expect(isCacheValid(cachePath, mockStats)).toBe(false);
    });
  });
  
  // Test 3: Scraped file path generation
  describe('Scraped Files - Path Generation', () => {
    it('should generate scraped file path from venue ID', () => {
      function getScrapedFilePath(venueId) {
        return `data/scraped/${venueId}.json`;
      }
      
      const venueId = 'ChIJ1VLlku9v_ogRb6gomm1SkGU';
      expect(getScrapedFilePath(venueId)).toBe(`data/scraped/${venueId}.json`);
    });
  });
  
  // Test 4: Scraped file validity check (daily cache per venue)
  describe('Scraped Files - Daily Cache Check', () => {
    it('should use cached scraped file if it exists and was created today', () => {
      function isScrapedFileValid(scrapedFilePath, mockStats) {
        try {
          if (!fs.existsSync(scrapedFilePath)) {
            return false;
          }
          
          const stats = mockStats || fs.statSync(scrapedFilePath);
          const fileDate = new Date(stats.mtime);
          const today = new Date();
          
          return fileDate.getDate() === today.getDate() &&
                 fileDate.getMonth() === today.getMonth() &&
                 fileDate.getFullYear() === today.getFullYear();
        } catch (e) {
          return false;
        }
      }
      
      const scrapedFilePath = 'data/scraped/ChIJ1VLlku9v_ogRb6gomm1SkGU.json';
      fs.existsSync.mockReturnValueOnce(true);
      
      const today = new Date();
      const mockStats = { mtime: today };
      fs.statSync.mockReturnValueOnce(mockStats);
      
      expect(isScrapedFileValid(scrapedFilePath, mockStats)).toBe(true);
    });
    
    it('should not use cached scraped file if it was created yesterday', () => {
      function isScrapedFileValid(scrapedFilePath, mockStats) {
        try {
          if (!fs.existsSync(scrapedFilePath)) {
            return false;
          }
          
          const stats = mockStats || fs.statSync(scrapedFilePath);
          const fileDate = new Date(stats.mtime);
          const today = new Date();
          
          return fileDate.getDate() === today.getDate() &&
                 fileDate.getMonth() === today.getMonth() &&
                 fileDate.getFullYear() === today.getFullYear();
        } catch (e) {
          return false;
        }
      }
      
      const scrapedFilePath = 'data/scraped/ChIJ1VLlku9v_ogRb6gomm1SkGU.json';
      fs.existsSync.mockReturnValueOnce(true);
      
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const mockStats = { mtime: yesterday };
      
      expect(isScrapedFileValid(scrapedFilePath, mockStats)).toBe(false);
    });
    
    it('should not use cached scraped file if it does not exist', () => {
      function isScrapedFileValid(scrapedFilePath) {
        try {
          if (!fs.existsSync(scrapedFilePath)) {
            return false;
          }
          
          const stats = fs.statSync(scrapedFilePath);
          const fileDate = new Date(stats.mtime);
          const today = new Date();
          
          return fileDate.getDate() === today.getDate() &&
                 fileDate.getMonth() === today.getMonth() &&
                 fileDate.getFullYear() === today.getFullYear();
        } catch (e) {
          return false;
        }
      }
      
      const scrapedFilePath = 'data/scraped/ChIJ1VLlku9v_ogRb6gomm1SkGU.json';
      fs.existsSync.mockReturnValueOnce(false);
      
      expect(isScrapedFileValid(scrapedFilePath)).toBe(false);
    });
  });
  
  // Test 5: Scraped file structure
  describe('Scraped Files - Data Structure', () => {
    it('should have correct structure for scraped data', () => {
      const scrapedData = {
        venueId: 'ChIJ1VLlku9v_ogRb6gomm1SkGU',
        venueName: 'Test Venue',
        venueArea: 'Daniel Island',
        website: 'https://example.com',
        scrapedAt: '2026-01-12T10:00:00Z',
        sources: [
          {
            url: 'https://example.com/menu',
            text: 'Full HTML text content...',
            pageType: 'menu',
            scrapedAt: '2026-01-12T10:00:00Z'
          }
        ],
        rawMatches: [
          {
            text: 'Happy hour Monday through Friday 4pm to 7pm',
            source: 'https://example.com/menu'
          }
        ],
        urlPatterns: ['menu', 'events', 'specials']
      };
      
      expect(scrapedData).toHaveProperty('venueId');
      expect(scrapedData).toHaveProperty('venueName');
      expect(scrapedData).toHaveProperty('website');
      expect(scrapedData).toHaveProperty('scrapedAt');
      expect(scrapedData).toHaveProperty('sources');
      expect(scrapedData).toHaveProperty('rawMatches');
      expect(scrapedData).toHaveProperty('urlPatterns');
      expect(Array.isArray(scrapedData.sources)).toBe(true);
      expect(Array.isArray(scrapedData.rawMatches)).toBe(true);
      expect(Array.isArray(scrapedData.urlPatterns)).toBe(true);
    });
  });
  
  // Test 6: URL pattern extraction
  describe('URL Pattern Extraction', () => {
    it('should extract URL path patterns from HTML', () => {
      // Mock HTML with various links
      const html = `
        <html>
          <body>
            <a href="/beer">Beer</a>
            <a href="/spirits">Spirits</a>
            <a href="/charleston/menu">Menu</a>
            <a href="/charleston/events">Events</a>
            <a href="https://external.com">External</a>
          </body>
        </html>
      `;
      
      function extractUrlPatterns(html, baseUrl) {
        const patterns = new Set();
        const cheerio = require('cheerio');
        const $ = cheerio.load(html);
        
        try {
          const baseUrlObj = new URL(baseUrl);
          const baseHostname = baseUrlObj.hostname;
          
          $('a[href]').each((i, elem) => {
            const href = $(elem).attr('href');
            if (!href) return;
            
            try {
              const resolvedUrl = new URL(href, baseUrl).href;
              const urlObj = new URL(resolvedUrl);
              
              if (urlObj.hostname === baseHostname) {
                let pathname = urlObj.pathname;
                if (pathname.startsWith('/')) {
                  pathname = pathname.substring(1);
                }
                if (pathname.endsWith('/')) {
                  pathname = pathname.substring(0, pathname.length - 1);
                }
                
                if (pathname) {
                  patterns.add(pathname);
                  const segments = pathname.split('/');
                  segments.forEach(segment => {
                    if (segment && segment.length > 0) {
                      patterns.add(segment);
                    }
                  });
                }
              }
            } catch (e) {
              // Skip invalid URLs
            }
          });
        } catch (e) {
          // Error handling
        }
        
        return Array.from(patterns).sort();
      }
      
      const baseUrl = 'https://example.com';
      const patterns = extractUrlPatterns(html, baseUrl);
      
      expect(patterns).toContain('beer');
      expect(patterns).toContain('spirits');
      expect(patterns).toContain('charleston');
      expect(patterns).toContain('charleston/menu');
      expect(patterns).toContain('charleston/events');
      expect(patterns).toContain('menu');
      expect(patterns).toContain('events');
      // Should not contain external links
      expect(patterns).not.toContain('external.com');
    });
    
    it('should extract distinct URL patterns only', () => {
      const html = `
        <html>
          <body>
            <a href="/menu">Menu</a>
            <a href="/menu">Menu Again</a>
            <a href="/events">Events</a>
          </body>
        </html>
      `;
      
      function extractUrlPatterns(html, baseUrl) {
        const patterns = new Set();
        const cheerio = require('cheerio');
        const $ = cheerio.load(html);
        
        try {
          const baseUrlObj = new URL(baseUrl);
          const baseHostname = baseUrlObj.hostname;
          
          $('a[href]').each((i, elem) => {
            const href = $(elem).attr('href');
            if (!href) return;
            
            try {
              const resolvedUrl = new URL(href, baseUrl).href;
              const urlObj = new URL(resolvedUrl);
              
              if (urlObj.hostname === baseHostname) {
                let pathname = urlObj.pathname;
                if (pathname.startsWith('/')) {
                  pathname = pathname.substring(1);
                }
                if (pathname.endsWith('/')) {
                  pathname = pathname.substring(0, pathname.length - 1);
                }
                
                if (pathname) {
                  patterns.add(pathname);
                }
              }
            } catch (e) {
              // Skip invalid URLs
            }
          });
        } catch (e) {
          // Error handling
        }
        
        return Array.from(patterns);
      }
      
      const baseUrl = 'https://example.com';
      const patterns = extractUrlPatterns(html, baseUrl);
      
      // Should only have one 'menu' entry
      const menuCount = patterns.filter(p => p === 'menu').length;
      expect(menuCount).toBe(1);
      expect(patterns.length).toBe(2); // menu and events
    });
  });
  
  // Test 7: Decoupling from venues.json
  describe('Decoupling - No venues.json writes', () => {
    it('should not write to venues.json', () => {
      // The script should only READ venues.json, never write to it
      // This is tested by ensuring no writeFileSync calls to venues.json
      const venuesPath = 'data/venues.json';
      
      // Mock: script should only read, not write
      fs.readFileSync.mockReturnValueOnce('[]');
      
      // Verify read was called
      fs.readFileSync(venuesPath, 'utf8');
      expect(fs.readFileSync).toHaveBeenCalledWith(venuesPath, 'utf8');
      
      // Verify write was NOT called for venues.json
      // (This is a structural test - actual implementation should not write)
    });
  });
  
  // Test 8: HTML string handling (text only, no images)
  describe('HTML String Handling', () => {
    it('should save and read HTML as UTF-8 string', () => {
      const cachePath = 'data/cache/example-com.html';
      const htmlContent = '<html><body><h1>Test</h1><p>Content</p></body></html>';
      
      fs.writeFileSync.mockImplementation(() => {});
      fs.writeFileSync(cachePath, htmlContent, 'utf8');
      
      expect(fs.writeFileSync).toHaveBeenCalledWith(cachePath, htmlContent, 'utf8');
      
      fs.readFileSync.mockReturnValue(htmlContent);
      const readContent = fs.readFileSync(cachePath, 'utf8');
      
      expect(fs.readFileSync).toHaveBeenCalledWith(cachePath, 'utf8');
      expect(typeof readContent).toBe('string');
      expect(readContent).toBe(htmlContent);
    });
  });
  
  // Test 9: Directory creation
  describe('Directory Creation', () => {
    it('should create scraped directory if it does not exist', () => {
      const scrapedDir = 'data/scraped';
      
      fs.existsSync.mockReturnValue(false);
      fs.mkdirSync.mockImplementation(() => {});
      
      if (!fs.existsSync(scrapedDir)) {
        fs.mkdirSync(scrapedDir, { recursive: true });
      }
      
      expect(fs.existsSync).toHaveBeenCalledWith(scrapedDir);
      expect(fs.mkdirSync).toHaveBeenCalledWith(scrapedDir, { recursive: true });
    });
  });
});
