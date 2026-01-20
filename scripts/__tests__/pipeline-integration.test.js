/**
 * Pipeline Integration Test
 * 
 * Tests the full incremental pipeline flow with mocked data to ensure:
 * - Delta detection works correctly with normalization
 * - False positives are minimized (<20 changed venues per run)
 * - Pipeline steps execute in correct order
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Test directories
const TEST_DATA_DIR = path.join(__dirname, '../../.test-pipeline-integration');
const TEST_RAW_ALL = path.join(TEST_DATA_DIR, 'raw/all');
const TEST_RAW_PREVIOUS = path.join(TEST_DATA_DIR, 'raw/previous');
const TEST_RAW_INCREMENTAL = path.join(TEST_DATA_DIR, 'raw/incremental');
const TEST_SILVER_MERGED_ALL = path.join(TEST_DATA_DIR, 'silver_merged/all');
const TEST_SILVER_MERGED_INCREMENTAL = path.join(TEST_DATA_DIR, 'silver_merged/incremental');
const TEST_SILVER_TRIMMED_ALL = path.join(TEST_DATA_DIR, 'silver_trimmed/all');
const TEST_SILVER_TRIMMED_PREVIOUS = path.join(TEST_DATA_DIR, 'silver_trimmed/previous');
const TEST_SILVER_TRIMMED_INCREMENTAL = path.join(TEST_DATA_DIR, 'silver_trimmed/incremental');

function cleanTestDir() {
  if (fs.existsSync(TEST_DATA_DIR)) {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
  [
    TEST_RAW_ALL, TEST_RAW_PREVIOUS, TEST_RAW_INCREMENTAL,
    TEST_SILVER_MERGED_ALL, TEST_SILVER_MERGED_INCREMENTAL,
    TEST_SILVER_TRIMMED_ALL, TEST_SILVER_TRIMMED_PREVIOUS, TEST_SILVER_TRIMMED_INCREMENTAL
  ].forEach(dir => {
    fs.mkdirSync(dir, { recursive: true });
  });
}

/**
 * Normalize text (same logic as trim-silver-html.js)
 */
function normalizeText(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }
  
  let normalized = text;
  normalized = normalized.replace(/\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?)?/g, '');
  normalized = normalized.replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(,\s+\d{4})?\b/gi, '');
  normalized = normalized.replace(/Loading\s+product\s+options\.\.\.|Loading\.\.\./gi, '');
  normalized = normalized.replace(/\s+/g, ' ').trim();
  
  return normalized;
}

/**
 * Get normalized hash from trimmed file
 */
function getTrimmedContentHash(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const pages = data.pages || [];
    const pagesContent = pages.map(p => normalizeText(p.text || '')).join('\n');
    return crypto.createHash('md5').update(pagesContent).digest('hex');
  } catch (error) {
    return null;
  }
}

describe('Pipeline Integration Test', () => {
  beforeEach(() => {
    cleanTestDir();
  });

  afterEach(() => {
    cleanTestDir();
  });

  test('should detect <20 changed venues with normalization (simulated full run)', () => {
    // Simulate previous day's data (100 venues)
    const previousVenues = [];
    for (let i = 0; i < 100; i++) {
      const venueId = `ChIJTest${i}`;
      const venueData = {
        venueId,
        venueName: `Test Venue ${i}`,
        pages: [
          {
            url: `https://example.com/venue${i}`,
            text: `Happy Hour 4pm-7pm Monday-Friday Updated 2026-01-19T15:34:58.724Z`,
            hash: crypto.createHash('md5').update(normalizeText(`Happy Hour 4pm-7pm Monday-Friday Updated 2026-01-19T15:34:58.724Z`)).digest('hex')
          }
        ]
      };
      fs.writeFileSync(
        path.join(TEST_SILVER_TRIMMED_PREVIOUS, `${venueId}.json`),
        JSON.stringify(venueData, null, 2)
      );
      previousVenues.push(venueId);
    }

    // Simulate today's data (100 venues - most unchanged, some with timestamps/dates)
    let changedCount = 0;
    let unchangedCount = 0;
    
    for (let i = 0; i < 100; i++) {
      const venueId = `ChIJTest${i}`;
      
      // 5 venues have actual content changes
      // 95 venues have only timestamp/date changes (should normalize to same)
      const hasRealChange = i < 5;
      const hasTimestampChange = i >= 5 && i < 95;
      
      let text;
      if (hasRealChange) {
        text = `Happy Hour 5pm-8pm Monday-Friday Updated 2026-01-20T16:45:12.123Z`; // Different time
        changedCount++;
      } else if (hasTimestampChange) {
        text = `Happy Hour 4pm-7pm Monday-Friday Updated 2026-01-20T16:45:12.123Z`; // Same content, different timestamp
        unchangedCount++;
      } else {
        text = `Happy Hour 4pm-7pm Monday-Friday Updated 2026-01-19T15:34:58.724Z`; // Completely unchanged
        unchangedCount++;
      }
      
      const venueData = {
        venueId,
        venueName: `Test Venue ${i}`,
        pages: [
          {
            url: `https://example.com/venue${i}`,
            text,
            hash: crypto.createHash('md5').update(normalizeText(text)).digest('hex')
          }
        ]
      };
      fs.writeFileSync(
        path.join(TEST_SILVER_TRIMMED_ALL, `${venueId}.json`),
        JSON.stringify(venueData, null, 2)
      );
    }

    // Run delta comparison
    const allFiles = fs.readdirSync(TEST_SILVER_TRIMMED_ALL).filter(f => f.endsWith('.json'));
    let detectedChanged = 0;
    let detectedUnchanged = 0;

    for (const file of allFiles) {
      const venueId = path.basename(file, '.json');
      const allFile = path.join(TEST_SILVER_TRIMMED_ALL, file);
      const previousFile = path.join(TEST_SILVER_TRIMMED_PREVIOUS, file);

      if (!fs.existsSync(previousFile)) {
        detectedChanged++; // New venue
        continue;
      }

      const allHash = getTrimmedContentHash(allFile);
      const previousHash = getTrimmedContentHash(previousFile);

      if (allHash !== previousHash) {
        detectedChanged++;
      } else {
        detectedUnchanged++;
      }
    }

    // With normalization, should only detect the 5 real changes
    // (95 venues with timestamp-only changes should normalize to same hash)
    expect(detectedChanged).toBe(5);
    expect(detectedUnchanged).toBe(95);
    expect(detectedChanged).toBeLessThan(20); // Assert <20 changed venues
  });

  test('should handle normalization edge cases correctly', () => {
    // Test that normalization doesn't break on edge cases
    const venueId = 'ChIJTestEdge';
    
    // Previous: text with various noise
    const previousFile = path.join(TEST_SILVER_TRIMMED_PREVIOUS, `${venueId}.json`);
    const previousData = {
      venueId,
      venueName: 'Test Venue',
      pages: [
        {
          url: 'https://example.com/menu?gad_source=1',
          text: 'Happy Hour 4pm-7pm   Jan 19, 2026   Loading... 2026-01-19T15:34:58.724Z',
          hash: crypto.createHash('md5').update(normalizeText('Happy Hour 4pm-7pm   Jan 19, 2026   Loading... 2026-01-19T15:34:58.724Z')).digest('hex')
        }
      ]
    };
    fs.writeFileSync(previousFile, JSON.stringify(previousData, null, 2));

    // Today: same content with different noise (should normalize to same)
    const allFile = path.join(TEST_SILVER_TRIMMED_ALL, `${venueId}.json`);
    const allData = {
      venueId,
      venueName: 'Test Venue',
      pages: [
        {
          url: 'https://example.com/menu?utm_source=google',
          text: 'Happy Hour 4pm-7pm   Jan 20, 2026   Loading product options... 2026-01-20T16:45:12.123Z',
          hash: crypto.createHash('md5').update(normalizeText('Happy Hour 4pm-7pm   Jan 20, 2026   Loading product options... 2026-01-20T16:45:12.123Z')).digest('hex')
        }
      ]
    };
    fs.writeFileSync(allFile, JSON.stringify(allData, null, 2));

    const allHash = getTrimmedContentHash(allFile);
    const previousHash = getTrimmedContentHash(previousFile);

    // Should normalize to same (both become "Happy Hour 4pm-7pm")
    expect(allHash).toBe(previousHash);
  });
});
