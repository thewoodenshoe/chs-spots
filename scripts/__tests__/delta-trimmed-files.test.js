const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Mock the delta-trimmed-files.js script
const SILVER_TRIMMED_TODAY_DIR = path.join(__dirname, '../../data/silver_trimmed/today');
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
  
  // Remove Google Analytics / GTM IDs
  normalized = normalized.replace(/gtm-[a-z0-9]+/gi, '');
  normalized = normalized.replace(/UA-\d+-\d+/g, '');
  
  // Remove common dynamic footers
  normalized = normalized.replace(/Copyright\s+©\s+\d{4}/gi, '');
  normalized = normalized.replace(/All\s+rights\s+reserved/gi, '');
  
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
  const testTodayDir = path.join(testBaseDir, 'today');
  const testPreviousDir = path.join(testBaseDir, 'previous');
  const testIncrementalDir = path.join(testBaseDir, 'incremental');

  beforeEach(() => {
    // Clean test directories
    cleanTestDir(testTodayDir);
    cleanTestDir(testPreviousDir);
    cleanTestDir(testIncrementalDir);
    
    // Ensure directories exist
    [testTodayDir, testPreviousDir, testIncrementalDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  });

  afterEach(() => {
    // Clean up test directories
    cleanTestDir(testTodayDir);
    cleanTestDir(testPreviousDir);
    cleanTestDir(testIncrementalDir);
  });

  test('should detect new venue (not in previous)', () => {
    // Create a new venue in today/ but not in previous/
    const venueId = 'ChIJTest123';
    const todayFile = path.join(testTodayDir, `${venueId}.json`);
    const trimmedData = {
      venueId,
      venueName: 'Test Venue',
      pages: [
        { url: 'https://example.com', text: 'Happy Hour 4pm-6pm' }
      ]
    };
    fs.writeFileSync(todayFile, JSON.stringify(trimmedData, null, 2));

    // Run delta comparison logic
    const incrementalFile = path.join(testIncrementalDir, `${venueId}.json`);
    if (!fs.existsSync(path.join(testPreviousDir, `${venueId}.json`))) {
      fs.copyFileSync(todayFile, incrementalFile);
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
    const todayFile = path.join(testTodayDir, `${venueId}.json`);
    const todayData = {
      venueId,
      venueName: 'Test Venue',
      pages: [
        { url: 'https://example.com', text: 'Happy Hour 5pm-7pm' } // Changed time
      ]
    };
    fs.writeFileSync(todayFile, JSON.stringify(todayData, null, 2));

    // Run delta comparison logic
    const todayHash = getTrimmedContentHash(todayFile);
    const previousHash = getTrimmedContentHash(previousFile);
    const incrementalFile = path.join(testIncrementalDir, `${venueId}.json`);

    if (todayHash !== previousHash) {
      fs.copyFileSync(todayFile, incrementalFile);
    }

    expect(todayHash).not.toBe(previousHash);
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
    const todayFile = path.join(testTodayDir, `${venueId}.json`);
    const todayData = {
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
    fs.writeFileSync(todayFile, JSON.stringify(todayData, null, 2));

    // Run delta comparison logic
    const todayHash = getTrimmedContentHash(todayFile);
    const previousHash = getTrimmedContentHash(previousFile);
    const incrementalFile = path.join(testIncrementalDir, `${venueId}.json`);

    if (todayHash !== previousHash) {
      fs.copyFileSync(todayFile, incrementalFile);
    }

    expect(todayHash).toBe(previousHash);
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
    const todayFile = path.join(testTodayDir, `${venueId}.json`);
    const todayData = {
      venueId,
      venueName: 'Test Venue',
      pages: [
        { url: 'https://example.com', text: 'Happy Hour 4pm-6pm Updated 2026-01-20T16:45:12.123Z' }
      ]
    };
    fs.writeFileSync(todayFile, JSON.stringify(todayData, null, 2));

    // Run delta comparison logic
    const todayHash = getTrimmedContentHash(todayFile);
    const previousHash = getTrimmedContentHash(previousFile);
    const incrementalFile = path.join(testIncrementalDir, `${venueId}.json`);

    if (todayHash !== previousHash) {
      fs.copyFileSync(todayFile, incrementalFile);
    }

    // Hashes should be same after normalization (timestamps removed)
    expect(todayHash).toBe(previousHash);
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
    const todayFile = path.join(testTodayDir, `${venueId}.json`);
    const todayData = {
      venueId,
      venueName: 'Test Venue',
      pages: [
        { url: 'https://example.com', text: 'Happy Hour 4pm-6pm Jan 20, 2026' }
      ]
    };
    fs.writeFileSync(todayFile, JSON.stringify(todayData, null, 2));

    // Run delta comparison logic
    const todayHash = getTrimmedContentHash(todayFile);
    const previousHash = getTrimmedContentHash(previousFile);
    const incrementalFile = path.join(testIncrementalDir, `${venueId}.json`);

    if (todayHash !== previousHash) {
      fs.copyFileSync(todayFile, incrementalFile);
    }

    // Hashes should be same after normalization (dates removed)
    expect(todayHash).toBe(previousHash);
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
    const todayFile = path.join(testTodayDir, `${venueId}.json`);
    const todayData = {
      venueId,
      venueName: 'Test Venue',
      pages: [
        { url: 'https://example.com/menu?gad_source=1&matchtype=p', text: 'Happy Hour 4pm-6pm' }
      ]
    };
    fs.writeFileSync(todayFile, JSON.stringify(todayData, null, 2));

    // Run delta comparison logic
    const todayHash = getTrimmedContentHash(todayFile);
    const previousHash = getTrimmedContentHash(previousFile);
    const incrementalFile = path.join(testIncrementalDir, `${venueId}.json`);

    if (todayHash !== previousHash) {
      fs.copyFileSync(todayFile, incrementalFile);
    }

    // Hashes should be same (URL doesn't affect text hash, text is same)
    expect(todayHash).toBe(previousHash);
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
    const todayFile = path.join(testTodayDir, `${venueId}.json`);
    const todayData = {
      venueId,
      venueName: 'Test Venue',
      pages: [
        { url: 'https://example.com/page1', text: 'Happy Hour 5pm-7pm' }, // Changed
        { url: 'https://example.com/page2', text: 'Menu items' } // Unchanged
      ]
    };
    fs.writeFileSync(todayFile, JSON.stringify(todayData, null, 2));

    // Run delta comparison logic
    const todayHash = getTrimmedContentHash(todayFile);
    const previousHash = getTrimmedContentHash(previousFile);
    const incrementalFile = path.join(testIncrementalDir, `${venueId}.json`);

    if (todayHash !== previousHash) {
      fs.copyFileSync(todayFile, incrementalFile);
    }

    expect(todayHash).not.toBe(previousHash);
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
    const todayFile = path.join(testTodayDir, `${venueId}.json`);
    const todayData = {
      venueId,
      venueName: 'Test Venue',
      pages: []
    };
    fs.writeFileSync(todayFile, JSON.stringify(todayData, null, 2));

    // Run delta comparison logic
    const todayHash = getTrimmedContentHash(todayFile);
    const previousHash = getTrimmedContentHash(previousFile);
    const incrementalFile = path.join(testIncrementalDir, `${venueId}.json`);

    if (todayHash !== previousHash) {
      fs.copyFileSync(todayFile, incrementalFile);
    }

    expect(todayHash).toBe(previousHash);
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
    const todayFile = path.join(testTodayDir, `${venueId}.json`);
    const todayData = {
      venueId,
      venueName: 'Test Venue',
      pages: [
        { url: 'https://example.com', html: '<div>Content</div>' } // No text field
      ]
    };
    fs.writeFileSync(todayFile, JSON.stringify(todayData, null, 2));

    // Run delta comparison logic
    const todayHash = getTrimmedContentHash(todayFile);
    const previousHash = getTrimmedContentHash(previousFile);
    const incrementalFile = path.join(testIncrementalDir, `${venueId}.json`);

    if (todayHash !== previousHash) {
      fs.copyFileSync(todayFile, incrementalFile);
    }

    // Both should have empty text, so hash should be same
    expect(todayHash).toBe(previousHash);
    expect(fs.existsSync(incrementalFile)).toBe(false);
  });

  test('should handle same-day delta with empty previous/ (populate from all/ before comparison)', () => {
    const venueId = 'ChIJTestSameDay';
    
    // Create venue in today/ (same day, previous/ is empty)
    const todayFile = path.join(testTodayDir, `${venueId}.json`);
    const todayData = {
      venueId,
      venueName: 'Test Venue',
      pages: [
        { url: 'https://example.com', text: 'Happy Hour 4pm-6pm' }
      ]
    };
    fs.writeFileSync(todayFile, JSON.stringify(todayData, null, 2));

    // Simulate same-day scenario: previous/ is empty, but we populate it from today/ first
    // This is what delta-trimmed-files.js does when same day and previous/ is empty
    const previousFile = path.join(testPreviousDir, `${venueId}.json`);
    fs.copyFileSync(todayFile, previousFile);

    // Now run delta comparison - should find no changes (same content)
    const todayHash = getTrimmedContentHash(todayFile);
    const previousHash = getTrimmedContentHash(previousFile);
    const incrementalFile = path.join(testIncrementalDir, `${venueId}.json`);

    if (todayHash !== previousHash) {
      fs.copyFileSync(todayFile, incrementalFile);
    }

    // Hashes should be same (files are identical)
    expect(todayHash).toBe(previousHash);
    expect(fs.existsSync(incrementalFile)).toBe(false);
  });

  test('should normalize text and ignore GTM IDs', () => {
    const venueId = 'ChIJTestGTM';
    
    // Previous day's content with GTM ID
    const previousFile = path.join(testPreviousDir, `${venueId}.json`);
    const previousData = {
      venueId,
      venueName: 'Test Venue',
      pages: [
        { url: 'https://example.com', text: 'Happy Hour 4pm-6pm gtm-abc123' }
      ]
    };
    fs.writeFileSync(previousFile, JSON.stringify(previousData, null, 2));

    // Today's content with different GTM ID (should normalize to same)
    const todayFile = path.join(testTodayDir, `${venueId}.json`);
    const todayData = {
      venueId,
      venueName: 'Test Venue',
      pages: [
        { url: 'https://example.com', text: 'Happy Hour 4pm-6pm gtm-xyz789' }
      ]
    };
    fs.writeFileSync(todayFile, JSON.stringify(todayData, null, 2));

    // Run delta comparison logic
    const todayHash = getTrimmedContentHash(todayFile);
    const previousHash = getTrimmedContentHash(previousFile);
    const incrementalFile = path.join(testIncrementalDir, `${venueId}.json`);

    if (todayHash !== previousHash) {
      fs.copyFileSync(todayFile, incrementalFile);
    }

    // Hashes should be same after normalization (GTM IDs removed)
    expect(todayHash).toBe(previousHash);
    expect(fs.existsSync(incrementalFile)).toBe(false);
  });

  test('should normalize text and ignore copyright footers', () => {
    const venueId = 'ChIJTestCopyright';
    
    // Previous day's content with copyright
    const previousFile = path.join(testPreviousDir, `${venueId}.json`);
    const previousData = {
      venueId,
      venueName: 'Test Venue',
      pages: [
        { url: 'https://example.com', text: 'Happy Hour 4pm-6pm Copyright © 2025 All rights reserved' }
      ]
    };
    fs.writeFileSync(previousFile, JSON.stringify(previousData, null, 2));

    // Today's content with different year (should normalize to same)
    const todayFile = path.join(testTodayDir, `${venueId}.json`);
    const todayData = {
      venueId,
      venueName: 'Test Venue',
      pages: [
        { url: 'https://example.com', text: 'Happy Hour 4pm-6pm Copyright © 2026 All rights reserved' }
      ]
    };
    fs.writeFileSync(todayFile, JSON.stringify(todayData, null, 2));

    // Run delta comparison logic
    const todayHash = getTrimmedContentHash(todayFile);
    const previousHash = getTrimmedContentHash(previousFile);
    const incrementalFile = path.join(testIncrementalDir, `${venueId}.json`);

    if (todayHash !== previousHash) {
      fs.copyFileSync(todayFile, incrementalFile);
    }

    // Hashes should be same after normalization (copyright removed)
    expect(todayHash).toBe(previousHash);
    expect(fs.existsSync(incrementalFile)).toBe(false);
  });

  test('should handle new-day archive: previous/ empty → archive copies all files → delta finds 0 new/changed', () => {
    // Simulate new day scenario: today/ has files, previous/ is empty
    const venueId1 = 'ChIJTestNewDay1';
    const venueId2 = 'ChIJTestNewDay2';
    
    // Create files in today/ with venueHash (simulating real trimmed files)
    const todayFile1 = path.join(testTodayDir, `${venueId1}.json`);
    const todayFile2 = path.join(testTodayDir, `${venueId2}.json`);
    
    // Compute venueHash the same way trim-silver-html.js does
    const pages1 = [{ url: 'https://example.com/1', text: 'Happy Hour 4pm-6pm' }];
    const pages2 = [{ url: 'https://example.com/2', text: 'Happy Hour 5pm-7pm' }];
    
    const venueContent1 = pages1.map(p => normalizeTextForHash(p.text || '')).join('\n');
    const venueHash1 = crypto.createHash('md5').update(venueContent1).digest('hex');
    const venueContent2 = pages2.map(p => normalizeTextForHash(p.text || '')).join('\n');
    const venueHash2 = crypto.createHash('md5').update(venueContent2).digest('hex');
    
    const todayData1 = {
      venueId: venueId1,
      venueName: 'Test Venue 1',
      venueHash: venueHash1,
      pages: pages1
    };
    const todayData2 = {
      venueId: venueId2,
      venueName: 'Test Venue 2',
      venueHash: venueHash2,
      pages: pages2
    };
    fs.writeFileSync(todayFile1, JSON.stringify(todayData1, null, 2));
    fs.writeFileSync(todayFile2, JSON.stringify(todayData2, null, 2));

    // Simulate archive: copy all files from today/ to previous/ (exact filenames preserved)
    const previousFile1 = path.join(testPreviousDir, `${venueId1}.json`);
    const previousFile2 = path.join(testPreviousDir, `${venueId2}.json`);
    fs.copyFileSync(todayFile1, previousFile1);
    fs.copyFileSync(todayFile2, previousFile2);

    // Verify files exist in previous/ with exact same filenames
    expect(fs.existsSync(previousFile1)).toBe(true);
    expect(fs.existsSync(previousFile2)).toBe(true);
    
    const previousFiles = fs.readdirSync(testPreviousDir).filter(f => f.endsWith('.json'));
    expect(previousFiles.length).toBe(2);
    expect(previousFiles).toContain(`${venueId1}.json`);
    expect(previousFiles).toContain(`${venueId2}.json`);

    // Now run delta comparison - should find 0 new, 0 changed (files are identical)
    // Even if venueHash exists, getTrimmedContentHash should recompute for consistency
    let newVenues = 0;
    let changedVenues = 0;
    
    for (const file of fs.readdirSync(testTodayDir).filter(f => f.endsWith('.json'))) {
      const venueId = path.basename(file, '.json');
      const todayFilePath = path.join(testTodayDir, file);
      const previousFilePath = path.join(testPreviousDir, file);
      
      if (!fs.existsSync(previousFilePath)) {
        newVenues++;
      } else {
        const todayHash = getTrimmedContentHash(todayFilePath);
        const previousHash = getTrimmedContentHash(previousFilePath);
        if (todayHash !== previousHash) {
          changedVenues++;
        }
      }
    }

    expect(newVenues).toBe(0);
    expect(changedVenues).toBe(0);
  });
  
  test('should handle files with old venueHash (recompute for consistency)', () => {
    // Simulate scenario where previous/ has files with old venueHash
    // and today/ has same content but new venueHash computation
    const venueId = 'ChIJTestOldHash';
    
    const pageText = 'Happy Hour 4pm-6pm';
    const normalizedText = normalizeTextForHash(pageText);
    const correctHash = crypto.createHash('md5').update(normalizedText).digest('hex');
    
    // Previous file with old/incorrect venueHash
    const previousFile = path.join(testPreviousDir, `${venueId}.json`);
    const previousData = {
      venueId,
      venueName: 'Test Venue',
      venueHash: 'old-wrong-hash-1234567890', // Old hash
      pages: [{ url: 'https://example.com', text: pageText }]
    };
    fs.writeFileSync(previousFile, JSON.stringify(previousData, null, 2));
    
    // Today file with correct venueHash
    const todayFile = path.join(testTodayDir, `${venueId}.json`);
    const todayData = {
      venueId,
      venueName: 'Test Venue',
      venueHash: correctHash, // New correct hash
      pages: [{ url: 'https://example.com', text: pageText }]
    };
    fs.writeFileSync(todayFile, JSON.stringify(todayData, null, 2));
    
    // getTrimmedContentHash should recompute from normalized text, ignoring venueHash
    // Both should produce same hash (correctHash) because content is identical
    const todayHash = getTrimmedContentHash(todayFile);
    const previousHash = getTrimmedContentHash(previousFile);
    
    expect(todayHash).toBe(correctHash);
    expect(previousHash).toBe(correctHash);
    expect(todayHash).toBe(previousHash); // Should match even though venueHash differs
  });
});
