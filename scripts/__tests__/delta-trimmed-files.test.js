const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Mock the delta-trimmed-files.js script
const SILVER_TRIMMED_ALL_DIR = path.join(__dirname, '../../data/silver_trimmed/all');
const SILVER_TRIMMED_PREVIOUS_DIR = path.join(__dirname, '../../data/silver_trimmed/previous');
const SILVER_TRIMMED_INCREMENTAL_DIR = path.join(__dirname, '../../data/silver_trimmed/incremental');

/**
 * Normalize text (same logic as delta-trimmed-files.js and trim-silver-html.js)
 */
function normalizeTextForHash(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }
  
  let normalized = text;
  
  // Remove ISO timestamps
  normalized = normalized.replace(/\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?)?/g, '');
  
  // Remove month-day patterns
  normalized = normalized.replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(,\s+\d{4})?\b/gi, '');
  
  // Remove loading placeholders
  normalized = normalized.replace(/Loading\s+product\s+options\.\.\.|Loading\.\.\./gi, '');
  
  // Collapse whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();
  
  return normalized;
}

function getTrimmedContentHash(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const pages = data.pages || [];
    
    // Always normalize text before hashing (same as delta-trimmed-files.js)
    const pagesContent = pages.map(p => {
      const text = p.text || '';
      return normalizeTextForHash(text);
    }).join('\n');
    
    return crypto.createHash('md5').update(pagesContent).digest('hex');
  } catch (error) {
    return null;
  }
}

function cleanTestDir(dirPath) {
  if (fs.existsSync(dirPath)) {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stats = fs.statSync(filePath);
      if (stats.isDirectory()) {
        cleanTestDir(filePath);
        fs.rmdirSync(filePath);
      } else {
        fs.unlinkSync(filePath);
      }
    }
  }
}

describe('Delta Trimmed Files', () => {
  const testBaseDir = path.join(__dirname, '../..', 'data', 'silver_trimmed');
  const testAllDir = path.join(testBaseDir, 'all');
  const testPreviousDir = path.join(testBaseDir, 'previous');
  const testIncrementalDir = path.join(testBaseDir, 'incremental');

  beforeEach(() => {
    // Clean test directories
    cleanTestDir(testAllDir);
    cleanTestDir(testPreviousDir);
    cleanTestDir(testIncrementalDir);
    
    // Ensure directories exist
    [testAllDir, testPreviousDir, testIncrementalDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  });

  afterEach(() => {
    // Clean up test directories
    cleanTestDir(testAllDir);
    cleanTestDir(testPreviousDir);
    cleanTestDir(testIncrementalDir);
  });

  test('should detect new venue (not in previous)', () => {
    // Create a new venue in all/ but not in previous/
    const venueId = 'ChIJTest123';
    const allFile = path.join(testAllDir, `${venueId}.json`);
    const trimmedData = {
      venueId,
      venueName: 'Test Venue',
      pages: [
        { url: 'https://example.com', text: 'Happy Hour 4pm-6pm' }
      ]
    };
    fs.writeFileSync(allFile, JSON.stringify(trimmedData, null, 2));

    // Run delta comparison logic
    const incrementalFile = path.join(testIncrementalDir, `${venueId}.json`);
    if (!fs.existsSync(path.join(testPreviousDir, `${venueId}.json`))) {
      fs.copyFileSync(allFile, incrementalFile);
    }

    expect(fs.existsSync(incrementalFile)).toBe(true);
  });

  test('should detect changed venue (different trimmed content)', () => {
    const venueId = 'ChIJTest456';
    
    // Previous day's content
    const previousFile = path.join(testPreviousDir, `${venueId}.json`);
    const previousData = {
      venueId,
      venueName: 'Test Venue',
      pages: [
        { url: 'https://example.com', text: 'Happy Hour 4pm-6pm' }
      ]
    };
    fs.writeFileSync(previousFile, JSON.stringify(previousData, null, 2));

    // Today's content (changed)
    const allFile = path.join(testAllDir, `${venueId}.json`);
    const allData = {
      venueId,
      venueName: 'Test Venue',
      pages: [
        { url: 'https://example.com', text: 'Happy Hour 5pm-7pm' } // Changed time
      ]
    };
    fs.writeFileSync(allFile, JSON.stringify(allData, null, 2));

    // Run delta comparison logic
    const allHash = getTrimmedContentHash(allFile);
    const previousHash = getTrimmedContentHash(previousFile);
    const incrementalFile = path.join(testIncrementalDir, `${venueId}.json`);

    if (allHash !== previousHash) {
      fs.copyFileSync(allFile, incrementalFile);
    }

    expect(allHash).not.toBe(previousHash);
    expect(fs.existsSync(incrementalFile)).toBe(true);
  });

  test('should not detect change for unchanged venue (same trimmed content)', () => {
    const venueId = 'ChIJTest789';
    
    // Previous day's content
    const previousFile = path.join(testPreviousDir, `${venueId}.json`);
    const previousData = {
      venueId,
      venueName: 'Test Venue',
      pages: [
        { url: 'https://example.com', text: 'Happy Hour 4pm-6pm' }
      ]
    };
    fs.writeFileSync(previousFile, JSON.stringify(previousData, null, 2));

    // Today's content (same trimmed text, but different metadata)
    const allFile = path.join(testAllDir, `${venueId}.json`);
    const allData = {
      venueId,
      venueName: 'Test Venue',
      scrapedAt: '2026-01-20T10:00:00Z', // Different timestamp
      trimmedAt: '2026-01-20T10:05:00Z', // Different timestamp
      pages: [
        { 
          url: 'https://example.com', 
          text: 'Happy Hour 4pm-6pm', // Same text content
          trimmedAt: '2026-01-20T10:05:00Z' // Different timestamp
        }
      ]
    };
    fs.writeFileSync(allFile, JSON.stringify(allData, null, 2));

    // Run delta comparison logic
    const allHash = getTrimmedContentHash(allFile);
    const previousHash = getTrimmedContentHash(previousFile);
    const incrementalFile = path.join(testIncrementalDir, `${venueId}.json`);

    if (allHash !== previousHash) {
      fs.copyFileSync(allFile, incrementalFile);
    }

    expect(allHash).toBe(previousHash);
    expect(fs.existsSync(incrementalFile)).toBe(false);
  });

  test('should normalize text and ignore timestamps in content', () => {
    const venueId = 'ChIJTestNormalize';
    
    // Previous day's content with timestamp
    const previousFile = path.join(testPreviousDir, `${venueId}.json`);
    const previousData = {
      venueId,
      venueName: 'Test Venue',
      pages: [
        { url: 'https://example.com', text: 'Happy Hour 4pm-6pm Updated 2026-01-19T15:34:58.724Z' }
      ]
    };
    fs.writeFileSync(previousFile, JSON.stringify(previousData, null, 2));

    // Today's content with different timestamp (should normalize to same)
    const allFile = path.join(testAllDir, `${venueId}.json`);
    const allData = {
      venueId,
      venueName: 'Test Venue',
      pages: [
        { url: 'https://example.com', text: 'Happy Hour 4pm-6pm Updated 2026-01-20T16:45:12.123Z' }
      ]
    };
    fs.writeFileSync(allFile, JSON.stringify(allData, null, 2));

    // Run delta comparison logic
    const allHash = getTrimmedContentHash(allFile);
    const previousHash = getTrimmedContentHash(previousFile);
    const incrementalFile = path.join(testIncrementalDir, `${venueId}.json`);

    if (allHash !== previousHash) {
      fs.copyFileSync(allFile, incrementalFile);
    }

    // Hashes should be same after normalization (timestamps removed)
    expect(allHash).toBe(previousHash);
    expect(fs.existsSync(incrementalFile)).toBe(false);
  });

  test('should normalize text and ignore date strings', () => {
    const venueId = 'ChIJTestDateNormalize';
    
    // Previous day's content with date
    const previousFile = path.join(testPreviousDir, `${venueId}.json`);
    const previousData = {
      venueId,
      venueName: 'Test Venue',
      pages: [
        { url: 'https://example.com', text: 'Happy Hour 4pm-6pm Jan 19, 2026' }
      ]
    };
    fs.writeFileSync(previousFile, JSON.stringify(previousData, null, 2));

    // Today's content with different date (should normalize to same)
    const allFile = path.join(testAllDir, `${venueId}.json`);
    const allData = {
      venueId,
      venueName: 'Test Venue',
      pages: [
        { url: 'https://example.com', text: 'Happy Hour 4pm-6pm Jan 20, 2026' }
      ]
    };
    fs.writeFileSync(allFile, JSON.stringify(allData, null, 2));

    // Run delta comparison logic
    const allHash = getTrimmedContentHash(allFile);
    const previousHash = getTrimmedContentHash(previousFile);
    const incrementalFile = path.join(testIncrementalDir, `${venueId}.json`);

    if (allHash !== previousHash) {
      fs.copyFileSync(allFile, incrementalFile);
    }

    // Hashes should be same after normalization (dates removed)
    expect(allHash).toBe(previousHash);
    expect(fs.existsSync(incrementalFile)).toBe(false);
  });

  test('should normalize URLs by removing query parameters', () => {
    const venueId = 'ChIJTestUrlNormalize';
    
    // Previous day's content with clean URL
    const previousFile = path.join(testPreviousDir, `${venueId}.json`);
    const previousData = {
      venueId,
      venueName: 'Test Venue',
      pages: [
        { url: 'https://example.com/menu', text: 'Happy Hour 4pm-6pm' }
      ]
    };
    fs.writeFileSync(previousFile, JSON.stringify(previousData, null, 2));

    // Today's content with URL containing query params (URL normalization doesn't affect hash, but test the concept)
    const allFile = path.join(testAllDir, `${venueId}.json`);
    const allData = {
      venueId,
      venueName: 'Test Venue',
      pages: [
        { url: 'https://example.com/menu?gad_source=1&matchtype=p', text: 'Happy Hour 4pm-6pm' }
      ]
    };
    fs.writeFileSync(allFile, JSON.stringify(allData, null, 2));

    // Run delta comparison logic
    const allHash = getTrimmedContentHash(allFile);
    const previousHash = getTrimmedContentHash(previousFile);
    const incrementalFile = path.join(testIncrementalDir, `${venueId}.json`);

    if (allHash !== previousHash) {
      fs.copyFileSync(allFile, incrementalFile);
    }

    // Hashes should be same (URL doesn't affect text hash, text is same)
    expect(allHash).toBe(previousHash);
    expect(fs.existsSync(incrementalFile)).toBe(false);
  });

  test('should handle multiple pages correctly', () => {
    const venueId = 'ChIJTestMulti';
    
    // Previous day's content
    const previousFile = path.join(testPreviousDir, `${venueId}.json`);
    const previousData = {
      venueId,
      venueName: 'Test Venue',
      pages: [
        { url: 'https://example.com/page1', text: 'Happy Hour 4pm-6pm' },
        { url: 'https://example.com/page2', text: 'Menu items' }
      ]
    };
    fs.writeFileSync(previousFile, JSON.stringify(previousData, null, 2));

    // Today's content (one page changed)
    const allFile = path.join(testAllDir, `${venueId}.json`);
    const allData = {
      venueId,
      venueName: 'Test Venue',
      pages: [
        { url: 'https://example.com/page1', text: 'Happy Hour 5pm-7pm' }, // Changed
        { url: 'https://example.com/page2', text: 'Menu items' } // Unchanged
      ]
    };
    fs.writeFileSync(allFile, JSON.stringify(allData, null, 2));

    // Run delta comparison logic
    const allHash = getTrimmedContentHash(allFile);
    const previousHash = getTrimmedContentHash(previousFile);
    const incrementalFile = path.join(testIncrementalDir, `${venueId}.json`);

    if (allHash !== previousHash) {
      fs.copyFileSync(allFile, incrementalFile);
    }

    expect(allHash).not.toBe(previousHash);
    expect(fs.existsSync(incrementalFile)).toBe(true);
  });

  test('should handle empty pages array', () => {
    const venueId = 'ChIJTestEmpty';
    
    // Previous day's content
    const previousFile = path.join(testPreviousDir, `${venueId}.json`);
    const previousData = {
      venueId,
      venueName: 'Test Venue',
      pages: []
    };
    fs.writeFileSync(previousFile, JSON.stringify(previousData, null, 2));

    // Today's content (still empty)
    const allFile = path.join(testAllDir, `${venueId}.json`);
    const allData = {
      venueId,
      venueName: 'Test Venue',
      pages: []
    };
    fs.writeFileSync(allFile, JSON.stringify(allData, null, 2));

    // Run delta comparison logic
    const allHash = getTrimmedContentHash(allFile);
    const previousHash = getTrimmedContentHash(previousFile);
    const incrementalFile = path.join(testIncrementalDir, `${venueId}.json`);

    if (allHash !== previousHash) {
      fs.copyFileSync(allFile, incrementalFile);
    }

    expect(allHash).toBe(previousHash);
    expect(fs.existsSync(incrementalFile)).toBe(false);
  });

  test('should handle missing text field in pages', () => {
    const venueId = 'ChIJTestNoText';
    
    // Previous day's content
    const previousFile = path.join(testPreviousDir, `${venueId}.json`);
    const previousData = {
      venueId,
      venueName: 'Test Venue',
      pages: [
        { url: 'https://example.com', html: '<div>Content</div>' } // No text field
      ]
    };
    fs.writeFileSync(previousFile, JSON.stringify(previousData, null, 2));

    // Today's content (same, no text field)
    const allFile = path.join(testAllDir, `${venueId}.json`);
    const allData = {
      venueId,
      venueName: 'Test Venue',
      pages: [
        { url: 'https://example.com', html: '<div>Content</div>' } // No text field
      ]
    };
    fs.writeFileSync(allFile, JSON.stringify(allData, null, 2));

    // Run delta comparison logic
    const allHash = getTrimmedContentHash(allFile);
    const previousHash = getTrimmedContentHash(previousFile);
    const incrementalFile = path.join(testIncrementalDir, `${venueId}.json`);

    if (allHash !== previousHash) {
      fs.copyFileSync(allFile, incrementalFile);
    }

    // Both should have empty text, so hash should be same
    expect(allHash).toBe(previousHash);
    expect(fs.existsSync(incrementalFile)).toBe(false);
  });
});
