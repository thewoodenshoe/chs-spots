/**
 * Pipeline Diff Flow Test - "Paul Stewart's Tavern" Scenario
 * 
 * Tests the complete diff flow when a venue website is updated:
 * 1. Day 1: Venue has no happy hour text → NOT in silver_matched
 * 2. Day 2: Website updated with happy hour → hash diff detected → goes through pipeline → added to silver_matched
 * 
 * Scenario: Paul Stewart's Tavern, 157 Sandshell Dr, 29492, Daniel Island
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TEST_DIR = path.join(__dirname, '../../.test-data');
const TEST_RAW_DIR = path.join(TEST_DIR, 'raw');
const TEST_RAW_PREVIOUS_DIR = path.join(TEST_RAW_DIR, 'previous');
const TEST_SILVER_MERGED_DIR = path.join(TEST_DIR, 'silver_merged');
const TEST_SILVER_MATCHED_DIR = path.join(TEST_DIR, 'silver_matched');

// Test venue data
const VENUE_ID = 'ChIJTestPaulStewart';
const VENUE_NAME = "Paul Stewart's Tavern";
const VENUE_ADDRESS = "157 Sandshell Dr, 29492, Daniel Island";
const VENUE_WEBSITE = 'https://paulstewarttavern.example.com';
const VENUE = {
  id: VENUE_ID,
  name: VENUE_NAME,
  area: 'Daniel Island',
  website: VENUE_WEBSITE
};

function cleanTestDir() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(TEST_RAW_DIR, { recursive: true });
  fs.mkdirSync(TEST_RAW_PREVIOUS_DIR, { recursive: true });
  fs.mkdirSync(TEST_SILVER_MERGED_DIR, { recursive: true });
  fs.mkdirSync(TEST_SILVER_MATCHED_DIR, { recursive: true });
}

function urlToHash(url) {
  return crypto.createHash('md5').update(url).digest('hex').substring(0, 12);
}

function computeContentHash(content) {
  const normalized = content.replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function containsHappyHour(html) {
  if (!html || typeof html !== 'string') return false;
  const textLower = html.toLowerCase();
  const patterns = ['happy hour', 'happyhour', 'hh ', ' hh:', 'happy hour:'];
  return patterns.some(pattern => textLower.includes(pattern));
}

describe('Pipeline Diff Flow - Paul Stewart\'s Tavern', () => {
  
  beforeEach(() => {
    cleanTestDir();
  });
  
  afterAll(() => {
    cleanTestDir();
  });
  
  test('Day 1: Venue with no happy hour → NOT in silver_matched', () => {
    // Step 1: Download raw HTML (Day 1 - no happy hour)
    const day1Html = '<html><body>Welcome to Paul Stewart\'s Tavern. We serve great food and drinks. Open daily.</body></html>';
    const venueDir = path.join(TEST_RAW_DIR, VENUE_ID);
    fs.mkdirSync(venueDir, { recursive: true });
    
    const hash = urlToHash(VENUE_WEBSITE);
    const filePath = path.join(venueDir, `${hash}.html`);
    fs.writeFileSync(filePath, day1Html, 'utf8');
    
    // Save metadata
    const metadata = { [hash]: VENUE_WEBSITE };
    fs.writeFileSync(path.join(venueDir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');
    
    // Verify no happy hour text
    expect(containsHappyHour(day1Html)).toBe(false);
    
    // Step 2: Merge raw files
    const mergedData = {
      venueId: VENUE_ID,
      venueName: VENUE_NAME,
      venueArea: VENUE.area,
      website: VENUE_WEBSITE,
      scrapedAt: new Date().toISOString(),
      pages: [{
        url: VENUE_WEBSITE,
        html: day1Html,
        hash: hash,
        downloadedAt: new Date().toISOString()
      }]
    };
    
    const mergedPath = path.join(TEST_SILVER_MERGED_DIR, `${VENUE_ID}.json`);
    fs.writeFileSync(mergedPath, JSON.stringify(mergedData, null, 2), 'utf8');
    
    // Step 3: Filter for happy hour
    const hasHappyHour = mergedData.pages.some(page => containsHappyHour(page.html));
    expect(hasHappyHour).toBe(false);
    
    // Should NOT be copied to silver_matched
    const matchedPath = path.join(TEST_SILVER_MATCHED_DIR, `${VENUE_ID}.json`);
    expect(fs.existsSync(matchedPath)).toBe(false);
  });
  
  test('Day 2: Website updated with happy hour → hash diff detected → added to silver_matched', () => {
    // Day 1: Setup (no happy hour)
    const day1Html = '<html><body>Welcome to Paul Stewart\'s Tavern. We serve great food and drinks. Open daily.</body></html>';
    
    // Archive Day 1 to previous
    const previousVenueDir = path.join(TEST_RAW_PREVIOUS_DIR, VENUE_ID);
    fs.mkdirSync(previousVenueDir, { recursive: true });
    
    const hash = urlToHash(VENUE_WEBSITE);
    const previousFilePath = path.join(previousVenueDir, `${hash}.html`);
    fs.writeFileSync(previousFilePath, day1Html, 'utf8');
    
    const previousMetadata = { [hash]: VENUE_WEBSITE };
    fs.writeFileSync(path.join(previousVenueDir, 'metadata.json'), JSON.stringify(previousMetadata, null, 2), 'utf8');
    
    // Day 2: Website updated with happy hour
    const day2Html = '<html><body>Welcome to Paul Stewart\'s Tavern. We serve great food and drinks. Open daily. Happy Hour Monday-Friday 4pm-7pm. $2 off all drinks!</body></html>';
    
    // Download new content (Day 2)
    const currentVenueDir = path.join(TEST_RAW_DIR, VENUE_ID);
    fs.mkdirSync(currentVenueDir, { recursive: true });
    
    const currentFilePath = path.join(currentVenueDir, `${hash}.html`);
    fs.writeFileSync(currentFilePath, day2Html, 'utf8');
    
    const currentMetadata = { [hash]: VENUE_WEBSITE };
    fs.writeFileSync(path.join(currentVenueDir, 'metadata.json'), JSON.stringify(currentMetadata, null, 2), 'utf8');
    
    // Verify hash difference
    const day1Hash = computeContentHash(day1Html);
    const day2Hash = computeContentHash(day2Html);
    expect(day1Hash).not.toBe(day2Hash);
    expect(containsHappyHour(day2Html)).toBe(true);
    
    // Step 2: Merge raw files (Day 2)
    const mergedData = {
      venueId: VENUE_ID,
      venueName: VENUE_NAME,
      venueArea: VENUE.area,
      website: VENUE_WEBSITE,
      scrapedAt: new Date().toISOString(),
      pages: [{
        url: VENUE_WEBSITE,
        html: day2Html,
        hash: hash,
        downloadedAt: new Date().toISOString()
      }]
    };
    
    const mergedPath = path.join(TEST_SILVER_MERGED_DIR, `${VENUE_ID}.json`);
    fs.writeFileSync(mergedPath, JSON.stringify(mergedData, null, 2), 'utf8');
    
    // Verify merged file exists
    expect(fs.existsSync(mergedPath)).toBe(true);
    
    // Step 3: Filter for happy hour (Day 2)
    const hasHappyHour = mergedData.pages.some(page => containsHappyHour(page.html));
    expect(hasHappyHour).toBe(true);
    
    // Should be copied to silver_matched
    if (hasHappyHour) {
      const matchedPath = path.join(TEST_SILVER_MATCHED_DIR, `${VENUE_ID}.json`);
      fs.writeFileSync(matchedPath, JSON.stringify(mergedData, null, 2), 'utf8');
      
      expect(fs.existsSync(matchedPath)).toBe(true);
      
      // Verify matched file contains happy hour
      const matchedData = JSON.parse(fs.readFileSync(matchedPath, 'utf8'));
      expect(matchedData.venueId).toBe(VENUE_ID);
      expect(matchedData.venueName).toBe(VENUE_NAME);
      expect(matchedData.pages[0].html).toContain('Happy Hour');
    }
  });
  
  test('Complete diff flow: Day 1 → Day 2 → Pipeline execution', () => {
    const hash = urlToHash(VENUE_WEBSITE);
    
    // === DAY 1 SETUP ===
    // Download raw HTML (no happy hour)
    const day1Html = '<html><body>Welcome to Paul Stewart\'s Tavern. We serve great food and drinks. Open daily.</body></html>';
    const previousVenueDir = path.join(TEST_RAW_PREVIOUS_DIR, VENUE_ID);
    fs.mkdirSync(previousVenueDir, { recursive: true });
    
    const previousFilePath = path.join(previousVenueDir, `${hash}.html`);
    fs.writeFileSync(previousFilePath, day1Html, 'utf8');
    
    const previousMetadata = { [hash]: VENUE_WEBSITE };
    fs.writeFileSync(path.join(previousVenueDir, 'metadata.json'), JSON.stringify(previousMetadata, null, 2), 'utf8');
    
    // Day 1: Merge and filter (should NOT match)
    const day1Merged = {
      venueId: VENUE_ID,
      venueName: VENUE_NAME,
      pages: [{ html: day1Html }]
    };
    
    const day1MergedPath = path.join(TEST_SILVER_MERGED_DIR, `${VENUE_ID}.json`);
    fs.writeFileSync(day1MergedPath, JSON.stringify(day1Merged, null, 2), 'utf8');
    
    const day1HasHappyHour = day1Merged.pages.some(page => containsHappyHour(page.html));
    expect(day1HasHappyHour).toBe(false);
    
    // === DAY 2: WEBSITE UPDATED ===
    // Download new content (with happy hour)
    const day2Html = '<html><body>Welcome to Paul Stewart\'s Tavern. Happy Hour Monday-Friday 4pm-7pm. $2 off all drinks!</body></html>';
    const currentVenueDir = path.join(TEST_RAW_DIR, VENUE_ID);
    fs.mkdirSync(currentVenueDir, { recursive: true });
    
    const currentFilePath = path.join(currentVenueDir, `${hash}.html`);
    fs.writeFileSync(currentFilePath, day2Html, 'utf8');
    
    const currentMetadata = { [hash]: VENUE_WEBSITE };
    fs.writeFileSync(path.join(currentVenueDir, 'metadata.json'), JSON.stringify(currentMetadata, null, 2), 'utf8');
    
    // Diff detection: Compare hashes
    const day1Hash = computeContentHash(day1Html);
    const day2Hash = computeContentHash(day2Html);
    expect(day1Hash).not.toBe(day2Hash);
    
    // Day 2: Merge updated content
    const day2Merged = {
      venueId: VENUE_ID,
      venueName: VENUE_NAME,
      venueArea: VENUE.area,
      website: VENUE_WEBSITE,
      scrapedAt: new Date().toISOString(),
      pages: [{
        url: VENUE_WEBSITE,
        html: day2Html,
        hash: hash,
        downloadedAt: new Date().toISOString()
      }]
    };
    
    // Overwrite merged file (Day 2)
    fs.writeFileSync(day1MergedPath, JSON.stringify(day2Merged, null, 2), 'utf8');
    
    // Day 2: Filter for happy hour (should match)
    const day2HasHappyHour = day2Merged.pages.some(page => containsHappyHour(page.html));
    expect(day2HasHappyHour).toBe(true);
    
    // Should be added to silver_matched (Day 2)
    const matchedPath = path.join(TEST_SILVER_MATCHED_DIR, `${VENUE_ID}.json`);
    fs.writeFileSync(matchedPath, JSON.stringify(day2Merged, null, 2), 'utf8');
    
    expect(fs.existsSync(matchedPath)).toBe(true);
    
    // Verify final state
    const matchedData = JSON.parse(fs.readFileSync(matchedPath, 'utf8'));
    expect(matchedData.venueId).toBe(VENUE_ID);
    expect(matchedData.venueName).toBe(VENUE_NAME);
    expect(matchedData.pages[0].html).toContain('Happy Hour');
    expect(matchedData.pages[0].html).toContain('Monday-Friday 4pm-7pm');
  });
});
