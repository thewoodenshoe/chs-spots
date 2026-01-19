const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Mock the delta-trimmed-files.js script
const SILVER_TRIMMED_ALL_DIR = path.join(__dirname, '../../data/silver_trimmed/all');
const SILVER_TRIMMED_PREVIOUS_DIR = path.join(__dirname, '../../data/silver_trimmed/previous');
const SILVER_TRIMMED_INCREMENTAL_DIR = path.join(__dirname, '../../data/silver_trimmed/incremental');

function getTrimmedContentHash(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const pagesContent = (data.pages || []).map(p => p.text || '').join('\n');
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
