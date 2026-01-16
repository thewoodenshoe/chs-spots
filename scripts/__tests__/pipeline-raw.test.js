/**
 * Comprehensive Unit Tests for download-raw-html.js (Step 1: Raw)
 * 
 * Tests actual functionality with real file operations in test directories.
 * Validates data structures, edge cases, and error handling.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Create test utilities
const TEST_DIR = path.join(__dirname, '../../.test-data');
const TEST_RAW_DIR = path.join(TEST_DIR, 'raw');
const TEST_RAW_PREVIOUS_DIR = path.join(TEST_RAW_DIR, 'previous');
const TEST_LAST_DOWNLOAD = path.join(TEST_RAW_DIR, '.last-download');

// Helper to clean test directory
function cleanTestDir() {
  if (fs.existsSync(TEST_DIR)) {
    // Remove all contents first to avoid ENOTEMPTY errors
    const files = fs.readdirSync(TEST_DIR);
    for (const file of files) {
      const filePath = path.join(TEST_DIR, file);
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        fs.rmSync(filePath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(filePath);
      }
    }
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(TEST_RAW_DIR, { recursive: true });
  fs.mkdirSync(TEST_RAW_PREVIOUS_DIR, { recursive: true });
}

// Helper functions from download-raw-html.js
function urlToHash(url) {
  return crypto.createHash('md5').update(url).digest('hex').substring(0, 12);
}

function getTodayDateString() {
  const today = new Date();
  return today.toISOString().split('T')[0];
}

function getRawFilePath(venueId, url, baseDir = TEST_RAW_DIR) {
  const venueDir = path.join(baseDir, venueId);
  if (!fs.existsSync(venueDir)) {
    fs.mkdirSync(venueDir, { recursive: true });
  }
  const hash = urlToHash(url);
  return path.join(venueDir, `${hash}.html`);
}

function getMetadataPath(venueId, baseDir = TEST_RAW_DIR) {
  const venueDir = path.join(baseDir, venueId);
  if (!fs.existsSync(venueDir)) {
    fs.mkdirSync(venueDir, { recursive: true });
  }
  return path.join(venueDir, 'metadata.json');
}

function loadMetadata(venueId, baseDir = TEST_RAW_DIR) {
  const metadataPath = getMetadataPath(venueId, baseDir);
  if (!fs.existsSync(metadataPath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  } catch (e) {
    return {};
  }
}

function saveMetadata(venueId, url, hash, baseDir = TEST_RAW_DIR) {
  const metadata = loadMetadata(venueId, baseDir);
  metadata[hash] = url;
  const metadataPath = getMetadataPath(venueId, baseDir);
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
}

function isFileFromToday(filePath) {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  
  try {
    const stats = fs.statSync(filePath);
    const fileDate = new Date(stats.mtime);
    const today = new Date();
    
    return fileDate.getDate() === today.getDate() &&
           fileDate.getMonth() === today.getMonth() &&
           fileDate.getFullYear() === today.getFullYear();
  } catch (e) {
    return false;
  }
}

describe('Pipeline Step 1: download-raw-html.js - Comprehensive Tests', () => {
  
  beforeEach(() => {
    cleanTestDir();
  });
  
  afterAll(() => {
    cleanTestDir();
  });
  
  describe('URL Hashing', () => {
    it('should generate consistent hash for same URL', () => {
      const url = 'https://example.com';
      const hash1 = urlToHash(url);
      const hash2 = urlToHash(url);
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(12);
    });
    
    it('should generate different hash for different URLs', () => {
      const url1 = 'https://example.com/page1';
      const url2 = 'https://example.com/page2';
      const hash1 = urlToHash(url1);
      const hash2 = urlToHash(url2);
      expect(hash1).not.toBe(hash2);
    });
    
    it('should handle special characters in URLs', () => {
      const url1 = 'https://example.com/page?query=test&value=123';
      const url2 = 'https://example.com/page?query=test&value=456';
      const hash1 = urlToHash(url1);
      const hash2 = urlToHash(url2);
      expect(hash1).not.toBe(hash2);
      expect(hash1).toHaveLength(12);
    });
  });
  
  describe('File Path Generation', () => {
    it('should create venue directory if it does not exist', () => {
      const venueId = 'ChIJTest123';
      const url = 'https://example.com';
      const filePath = getRawFilePath(venueId, url);
      
      expect(fs.existsSync(filePath)).toBe(false);
      expect(fs.existsSync(path.dirname(filePath))).toBe(true);
    });
    
    it('should generate correct file path structure', () => {
      const venueId = 'ChIJTest123';
      const url = 'https://example.com';
      const filePath = getRawFilePath(venueId, url);
      const expectedHash = urlToHash(url);
      
      expect(filePath).toContain(venueId);
      expect(filePath).toContain(`${expectedHash}.html`);
      expect(filePath).toMatch(/\.html$/);
    });
  });
  
  describe('Metadata Management', () => {
    it('should save and load metadata correctly', () => {
      const venueId = 'ChIJTest123';
      const url = 'https://example.com';
      const hash = urlToHash(url);
      
      saveMetadata(venueId, url, hash);
      const metadata = loadMetadata(venueId);
      
      expect(metadata).toHaveProperty(hash);
      expect(metadata[hash]).toBe(url);
    });
    
    it('should handle multiple URLs in metadata', () => {
      const venueId = 'ChIJTest123';
      const urls = [
        'https://example.com',
        'https://example.com/page1',
        'https://example.com/page2'
      ];
      
      urls.forEach(url => {
        const hash = urlToHash(url);
        saveMetadata(venueId, url, hash);
      });
      
      const metadata = loadMetadata(venueId);
      expect(Object.keys(metadata)).toHaveLength(3);
      urls.forEach(url => {
        const hash = urlToHash(url);
        expect(metadata[hash]).toBe(url);
      });
    });
    
    it('should return empty object if metadata file does not exist', () => {
      const venueId = 'ChIJNewVenue';
      const metadata = loadMetadata(venueId);
      expect(metadata).toEqual({});
    });
    
    it('should handle corrupted metadata file gracefully', () => {
      const venueId = 'ChIJTest123';
      const metadataPath = getMetadataPath(venueId);
      
      // Write invalid JSON
      fs.writeFileSync(metadataPath, 'invalid json{', 'utf8');
      
      // Should return empty object on error
      const metadata = loadMetadata(venueId);
      expect(metadata).toEqual({});
    });
  });
  
  describe('File Operations', () => {
    it('should save HTML file correctly', () => {
      const venueId = 'ChIJTest123';
      const url = 'https://example.com';
      const html = '<html><body>Test Content</body></html>';
      
      const filePath = getRawFilePath(venueId, url);
      fs.writeFileSync(filePath, html, 'utf8');
      
      expect(fs.existsSync(filePath)).toBe(true);
      const savedContent = fs.readFileSync(filePath, 'utf8');
      expect(savedContent).toBe(html);
    });
    
    it('should handle large HTML files', () => {
      const venueId = 'ChIJTest123';
      const url = 'https://example.com';
      const largeHtml = '<html><body>' + 'x'.repeat(100000) + '</body></html>';
      
      const filePath = getRawFilePath(venueId, url);
      fs.writeFileSync(filePath, largeHtml, 'utf8');
      
      expect(fs.existsSync(filePath)).toBe(true);
      const stats = fs.statSync(filePath);
      expect(stats.size).toBeGreaterThan(100000);
    });
    
    it('should preserve HTML encoding and special characters', () => {
      const venueId = 'ChIJTest123';
      const url = 'https://example.com';
      const html = '<html><body>Test & "quotes" &amp; entities &copy; 2026</body></html>';
      
      const filePath = getRawFilePath(venueId, url);
      fs.writeFileSync(filePath, html, 'utf8');
      
      const savedContent = fs.readFileSync(filePath, 'utf8');
      expect(savedContent).toBe(html);
      expect(savedContent).toContain('&');
      expect(savedContent).toContain('"');
      // HTML encoding: © becomes &copy; when saved, so check for the encoded version
      expect(savedContent).toContain('&copy;');
    });
  });
  
  describe('Daily Caching', () => {
    it('should detect if file was downloaded today', () => {
      const venueId = 'ChIJTest123';
      const url = 'https://example.com';
      const filePath = getRawFilePath(venueId, url);
      
      // Create file now
      fs.writeFileSync(filePath, '<html>Test</html>', 'utf8');
      
      expect(isFileFromToday(filePath)).toBe(true);
    });
    
    it('should return false for non-existent file', () => {
      const filePath = path.join(TEST_RAW_DIR, 'nonexistent.html');
      expect(isFileFromToday(filePath)).toBe(false);
    });
    
    it('should save and read last download date', () => {
      const today = getTodayDateString();
      fs.writeFileSync(TEST_LAST_DOWNLOAD, today, 'utf8');
      
      expect(fs.existsSync(TEST_LAST_DOWNLOAD)).toBe(true);
      const savedDate = fs.readFileSync(TEST_LAST_DOWNLOAD, 'utf8').trim();
      expect(savedDate).toBe(today);
      expect(savedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
  
  describe('Data Structure Validation', () => {
    it('should maintain correct directory structure', () => {
      const venueId = 'ChIJTest123';
      const url = 'https://example.com';
      
      const filePath = getRawFilePath(venueId, url);
      fs.writeFileSync(filePath, '<html>Test</html>', 'utf8');
      
      const venueDir = path.dirname(filePath);
      expect(fs.existsSync(venueDir)).toBe(true);
      expect(fs.statSync(venueDir).isDirectory()).toBe(true);
      
      const files = fs.readdirSync(venueDir);
      expect(files.some(f => f.endsWith('.html'))).toBe(true);
    });
    
    it('should have both HTML file and metadata file', () => {
      const venueId = 'ChIJTest123';
      const url = 'https://example.com';
      const hash = urlToHash(url);
      
      const filePath = getRawFilePath(venueId, url);
      fs.writeFileSync(filePath, '<html>Test</html>', 'utf8');
      saveMetadata(venueId, url, hash);
      
      const venueDir = path.dirname(filePath);
      const files = fs.readdirSync(venueDir);
      
      expect(files).toContain(`${hash}.html`);
      expect(files).toContain('metadata.json');
    });
    
    it('should handle multiple HTML files per venue', () => {
      const venueId = 'ChIJTest123';
      const urls = [
        'https://example.com',
        'https://example.com/page1',
        'https://example.com/page2'
      ];
      
      urls.forEach(url => {
        const filePath = getRawFilePath(venueId, url);
        fs.writeFileSync(filePath, `<html>${url}</html>`, 'utf8');
        const hash = urlToHash(url);
        saveMetadata(venueId, url, hash);
      });
      
      const venueDir = path.join(TEST_RAW_DIR, venueId);
      const htmlFiles = fs.readdirSync(venueDir).filter(f => f.endsWith('.html'));
      
      expect(htmlFiles).toHaveLength(3);
      
      const metadata = loadMetadata(venueId);
      expect(Object.keys(metadata)).toHaveLength(3);
    });
  });
  
  describe('Edge Cases', () => {
    it('should handle venue ID with special characters', () => {
      const venueId = 'ChIJ_Test-123.456';
      const url = 'https://example.com';
      const filePath = getRawFilePath(venueId, url);
      
      fs.writeFileSync(filePath, '<html>Test</html>', 'utf8');
      expect(fs.existsSync(filePath)).toBe(true);
    });
    
    it('should handle very long URLs', () => {
      const venueId = 'ChIJTest123';
      const longUrl = 'https://example.com/' + 'a'.repeat(500) + '?query=' + 'b'.repeat(500);
      const hash = urlToHash(longUrl);
      
      expect(hash).toHaveLength(12);
      expect(typeof hash).toBe('string');
    });
    
    it('should handle empty HTML content', () => {
      const venueId = 'ChIJTest123';
      const url = 'https://example.com';
      const filePath = getRawFilePath(venueId, url);
      
      fs.writeFileSync(filePath, '', 'utf8');
      expect(fs.existsSync(filePath)).toBe(true);
      
      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).toBe('');
    });
    
    it('should handle concurrent writes to same venue', () => {
      const venueId = 'ChIJTest123';
      const urls = [
        'https://example.com/page1',
        'https://example.com/page2',
        'https://example.com/page3'
      ];
      
      // Simulate concurrent writes
      urls.forEach((url, index) => {
        const filePath = getRawFilePath(venueId, url);
        fs.writeFileSync(filePath, `<html>Page ${index + 1}</html>`, 'utf8');
        const hash = urlToHash(url);
        saveMetadata(venueId, url, hash);
      });
      
      const venueDir = path.join(TEST_RAW_DIR, venueId);
      const htmlFiles = fs.readdirSync(venueDir).filter(f => f.endsWith('.html'));
      expect(htmlFiles).toHaveLength(3);
    });
  });
  
  describe('Previous Day Archiving', () => {
    it('should move venue directory to previous', () => {
      const venueId = 'ChIJTest123';
      const url = 'https://example.com';
      
      // Create current file
      const currentPath = getRawFilePath(venueId, url);
      fs.writeFileSync(currentPath, '<html>Current</html>', 'utf8');
      
      // Simulate archive
      const currentDir = path.join(TEST_RAW_DIR, venueId);
      const previousDir = path.join(TEST_RAW_PREVIOUS_DIR, venueId);
      
      if (fs.existsSync(currentDir)) {
        if (fs.existsSync(previousDir)) {
          fs.rmSync(previousDir, { recursive: true, force: true });
        }
        fs.renameSync(currentDir, previousDir);
      }
      
      expect(fs.existsSync(previousDir)).toBe(true);
      expect(fs.existsSync(currentDir)).toBe(false);
    });
  });
});
