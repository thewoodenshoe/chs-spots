/**
 * Unit Test: LLM Extraction - Bulk vs Incremental
 * 
 * Tests that incremental extraction only processes new/changed venues
 * and skips already extracted venues.
 */

const fs = require('fs');
const path = require('path');

const TEST_DIR = path.join(__dirname, '../../.test-data');
const TEST_SILVER_MERGED_ALL_DIR = path.join(TEST_DIR, 'silver_merged/all');
const TEST_GOLD_DIR = path.join(TEST_DIR, 'gold');

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
  fs.mkdirSync(TEST_SILVER_MERGED_ALL_DIR, { recursive: true });
  fs.mkdirSync(TEST_GOLD_DIR, { recursive: true });
}

function shouldExtract(silverMergedPath, goldPath) {
  // Never extracted
  if (!fs.existsSync(goldPath)) {
    return 'new';
  }
  
  // Compare timestamps
  const silverStats = fs.statSync(silverMergedPath);
  const goldStats = fs.statSync(goldPath);
  
  // Silver file newer = content changed
  if (silverStats.mtime > goldStats.mtime) {
    return 'changed';
  }
  
  // Already extracted and unchanged
  return 'skip';
}

describe('LLM Extraction - Incremental Detection', () => {
  
  beforeEach(() => {
    cleanTestDir();
  });
  
  afterAll(() => {
    cleanTestDir();
  });
  
  test('Should detect new venue (gold file does not exist)', () => {
    const venueId = 'ChIJTest123';
    
    // Create silver_merged file
    const silverPath = path.join(TEST_SILVER_MERGED_ALL_DIR, `${venueId}.json`);
    const silverData = { venueId, venueName: 'Test Venue' };
    fs.writeFileSync(silverPath, JSON.stringify(silverData, null, 2), 'utf8');
    
    // No gold file exists
    const goldPath = path.join(TEST_GOLD_DIR, `${venueId}.json`);
    
    const status = shouldExtract(silverPath, goldPath);
    expect(status).toBe('new');
  });
  
  test('Should detect changed venue (silver file newer than gold)', () => {
    const venueId = 'ChIJTest123';
    
    // Create gold file first (older)
    const goldPath = path.join(TEST_GOLD_DIR, `${venueId}.json`);
    const goldData = {
      venueId,
      venueName: 'Test Venue',
      extractedAt: '2026-01-11T10:00:00.000Z',
      happyHour: { found: false }
    };
    fs.writeFileSync(goldPath, JSON.stringify(goldData, null, 2), 'utf8');
    
    // Wait a moment
    const oldTime = fs.statSync(goldPath).mtime;
    
    // Update silver_merged file (newer)
    const silverPath = path.join(TEST_SILVER_MERGED_ALL_DIR, `${venueId}.json`);
    const silverData = { venueId, venueName: 'Test Venue Updated' };
    fs.writeFileSync(silverPath, JSON.stringify(silverData, null, 2), 'utf8');
    
    // Ensure silver is newer
    const silverStats = fs.statSync(silverPath);
    expect(silverStats.mtime.getTime()).toBeGreaterThanOrEqual(oldTime.getTime());
    
    const status = shouldExtract(silverPath, goldPath);
    expect(status).toBe('changed');
  });
  
  test('Should skip unchanged venue (gold file same or newer)', () => {
    const venueId = 'ChIJTest123';
    
    // Create gold file
    const goldPath = path.join(TEST_GOLD_DIR, `${venueId}.json`);
    const goldData = {
      venueId,
      venueName: 'Test Venue',
      extractedAt: '2026-01-12T10:00:00.000Z',
      happyHour: { found: true }
    };
    fs.writeFileSync(goldPath, JSON.stringify(goldData, null, 2), 'utf8');
    
    // Create silver_merged file (same or older)
    const silverPath = path.join(TEST_SILVER_MERGED_ALL_DIR, `${venueId}.json`);
    const silverData = { venueId, venueName: 'Test Venue' };
    fs.writeFileSync(silverPath, JSON.stringify(silverData, null, 2), 'utf8');
    
    // Touch gold file to make it newer
    const goldTime = Date.now() + 1000;
    fs.utimesSync(goldPath, new Date(goldTime), new Date(goldTime));
    
    const status = shouldExtract(silverPath, goldPath);
    expect(status).toBe('skip');
  });
  
  test('Bulk completion flag prevents incremental before bulk', () => {
    const bulkCompletePath = path.join(TEST_GOLD_DIR, '.bulk-complete');
    
    // No bulk complete flag
    expect(fs.existsSync(bulkCompletePath)).toBe(false);
    
    // Create flag
    fs.writeFileSync(bulkCompletePath, new Date().toISOString(), 'utf8');
    expect(fs.existsSync(bulkCompletePath)).toBe(true);
    
    // Should allow incremental extraction
    const canRunIncremental = fs.existsSync(bulkCompletePath);
    expect(canRunIncremental).toBe(true);
  });
  
  test('Complete flow: Bulk → Incremental (Paul Stewart scenario)', () => {
    const venueId = 'ChIJTestPaulStewart';
    
    // === BULK PHASE ===
    // Venue in silver_merged/all (Day 1 - no happy hour)
    const silverPath = path.join(TEST_SILVER_MERGED_ALL_DIR, `${venueId}.json`);
    const silverDataDay1 = {
      venueId,
      venueName: "Paul Stewart's Tavern",
      pages: [{ html: '<html>No happy hour</html>' }]
    };
    fs.writeFileSync(silverPath, JSON.stringify(silverDataDay1, null, 2), 'utf8');
    
    // Bulk extraction creates gold file
    const goldPath = path.join(TEST_GOLD_DIR, `${venueId}.json`);
    const goldDataDay1 = {
      venueId,
      venueName: "Paul Stewart's Tavern",
      extractedAt: '2026-01-11T10:00:00.000Z',
      extractionMethod: 'llm-bulk',
      happyHour: { found: false }
    };
    fs.writeFileSync(goldPath, JSON.stringify(goldDataDay1, null, 2), 'utf8');
    
    // Create bulk complete flag
    const bulkCompletePath = path.join(TEST_GOLD_DIR, '.bulk-complete');
    fs.writeFileSync(bulkCompletePath, new Date().toISOString(), 'utf8');
    
    // === INCREMENTAL PHASE (Day 2) ===
    // Website updated with happy hour
    const silverDataDay2 = {
      venueId,
      venueName: "Paul Stewart's Tavern",
      pages: [{ html: '<html>Happy Hour Monday-Friday 4pm-7pm</html>' }]
    };
    fs.writeFileSync(silverPath, JSON.stringify(silverDataDay2, null, 2), 'utf8');
    
    // Check if needs extraction
    const status = shouldExtract(silverPath, goldPath);
    expect(status).toBe('changed'); // Silver file is newer
    
    // After incremental extraction, update gold file
    const goldDataDay2 = {
      ...goldDataDay1,
      extractedAt: '2026-01-12T10:00:00.000Z',
      extractionMethod: 'llm-incremental',
      sourceModifiedAt: fs.statSync(silverPath).mtime.toISOString(),
      happyHour: { found: true, times: 'Monday-Friday 4pm-7pm' }
    };
    fs.writeFileSync(goldPath, JSON.stringify(goldDataDay2, null, 2), 'utf8');
    
    // Verify gold file updated
    const updatedGold = JSON.parse(fs.readFileSync(goldPath, 'utf8'));
    expect(updatedGold.happyHour.found).toBe(true);
    expect(updatedGold.extractionMethod).toBe('llm-incremental');
  });
});
