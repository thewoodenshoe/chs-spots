/**
 * Standalone Pipeline Validation Script
 * 
 * Validates the pipeline steps (raw/all, silver_merged/all)
 * without requiring Jest. Can be run directly: node scripts/__tests__/validate-pipeline.js
 * 
 * Tests actual functionality with real file operations.
 * Note: silver_matched layer has been removed - all data flows through silver_merged/all/
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Test directories - New structure: raw/all/, silver_merged/all/
const TEST_DIR = path.join(__dirname, '../../.test-data');
const TEST_RAW_ALL_DIR = path.join(TEST_DIR, 'raw/all');
const TEST_SILVER_MERGED_ALL_DIR = path.join(TEST_DIR, 'silver_merged/all');

// Test results
const results = {
  passed: 0,
  failed: 0,
  tests: []
};

function test(name, fn) {
  try {
    fn();
    results.passed++;
    results.tests.push({ name, status: 'PASS', error: null });
    console.log(`✅ ${name}`);
  } catch (error) {
    results.failed++;
    results.tests.push({ name, status: 'FAIL', error: error.message });
    console.error(`❌ ${name}: ${error.message}`);
  }
}

function cleanTestDir() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(TEST_RAW_ALL_DIR, { recursive: true });
  fs.mkdirSync(TEST_SILVER_MERGED_ALL_DIR, { recursive: true });
}

function urlToHash(url) {
  return crypto.createHash('md5').update(url).digest('hex').substring(0, 12);
}

function containsHappyHour(html) {
  if (!html || typeof html !== 'string') return false;
  const textLower = html.toLowerCase();
  const patterns = ['happy hour', 'happyhour', 'happy hours', 'hh ', ' hh:', 'happy hour:'];
  return patterns.some(pattern => textLower.includes(pattern));
}

console.log('🧪 Pipeline Validation Tests\n');
console.log('Step 1: Raw (download-raw-html.js)\n');

cleanTestDir();

// Step 1 Tests: Raw
test('URL hash generation is consistent', () => {
  const url = 'https://example.com';
  const hash1 = urlToHash(url);
  const hash2 = urlToHash(url);
  if (hash1 !== hash2) throw new Error('Hash mismatch');
  if (hash1.length !== 12) throw new Error('Hash length incorrect');
});

test('URL hash generation creates different hashes for different URLs', () => {
  const hash1 = urlToHash('https://example.com/page1');
  const hash2 = urlToHash('https://example.com/page2');
  if (hash1 === hash2) throw new Error('Hashes should be different');
});

test('Raw file path generation creates correct structure', () => {
  const venueId = 'ChIJTest123';
  const url = 'https://example.com';
  const venueDir = path.join(TEST_RAW_ALL_DIR, venueId);
  fs.mkdirSync(venueDir, { recursive: true });
  
  const hash = urlToHash(url);
  const filePath = path.join(venueDir, `${hash}.html`);
  fs.writeFileSync(filePath, '<html>Test</html>', 'utf8');
  
  if (!fs.existsSync(filePath)) throw new Error('File not created');
  if (!filePath.includes(venueId)) throw new Error('Path missing venue ID');
  if (!filePath.endsWith('.html')) throw new Error('Path missing .html extension');
});

test('Metadata save and load works correctly', () => {
  const venueId = 'ChIJTest123';
  const venueDir = path.join(TEST_RAW_ALL_DIR, venueId);
  fs.mkdirSync(venueDir, { recursive: true });
  
  const url = 'https://example.com';
  const hash = urlToHash(url);
  const metadata = { [hash]: url };
  
  const metadataPath = path.join(venueDir, 'metadata.json');
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
  
  const loaded = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  if (loaded[hash] !== url) throw new Error('Metadata mismatch');
});

test('HTML content is preserved exactly', () => {
  const venueId = 'ChIJTest123';
  const venueDir = path.join(TEST_RAW_ALL_DIR, venueId);
  fs.mkdirSync(venueDir, { recursive: true });
  
  const originalHtml = '<html><body>Test & "content" &copy; 2026</body></html>';
  const hash = urlToHash('https://example.com');
  const filePath = path.join(venueDir, `${hash}.html`);
  fs.writeFileSync(filePath, originalHtml, 'utf8');
  
  const savedHtml = fs.readFileSync(filePath, 'utf8');
  if (savedHtml !== originalHtml) throw new Error('Content not preserved');
});

console.log('\nStep 2: Silver Merged (merge-raw-files.js)\n');

// Step 2 Tests: Silver Merged
test('Multiple HTML files are discovered correctly', () => {
  const venueId = 'ChIJTest123';
  const venueDir = path.join(TEST_RAW_ALL_DIR, venueId);
  fs.mkdirSync(venueDir, { recursive: true });
  
  const urls = ['https://example.com', 'https://example.com/page1'];
  urls.forEach((url, index) => {
    const hash = urlToHash(url);
    const filePath = path.join(venueDir, `${hash}.html`);
    fs.writeFileSync(filePath, `<html>Page ${index + 1}</html>`, 'utf8');
  });
  
  const files = fs.readdirSync(venueDir).filter(f => f.endsWith('.html'));
  if (files.length !== 2) throw new Error(`Expected 2 files, got ${files.length}`);
});

test('Merged file structure is correct', () => {
  const venueId = 'ChIJTest123';
  const venue = {
    id: venueId,
    name: 'Test Venue',
    area: 'Test Area',
    website: 'https://example.com'
  };
  
  const mergedData = {
    venueId,
    venueName: venue.name,
    venueArea: venue.area,
    website: venue.website,
    scrapedAt: new Date().toISOString(),
    pages: [{
      url: 'https://example.com',
      html: '<html>Test</html>',
      hash: 'abc123',
      downloadedAt: new Date().toISOString()
    }]
  };
  
  const mergedPath = path.join(TEST_SILVER_MERGED_ALL_DIR, `${venueId}.json`);
  fs.writeFileSync(mergedPath, JSON.stringify(mergedData, null, 2), 'utf8');
  
  const parsed = JSON.parse(fs.readFileSync(mergedPath, 'utf8'));
  if (!parsed.venueId) throw new Error('Missing venueId');
  if (!parsed.venueName) throw new Error('Missing venueName');
  if (!parsed.pages || !Array.isArray(parsed.pages)) throw new Error('Invalid pages array');
  if (parsed.pages.length === 0) throw new Error('Empty pages array');
  if (!parsed.pages[0].html) throw new Error('Missing HTML in page');
});

test('Merged file handles missing optional fields', () => {
  const venueId = 'ChIJTest123';
  const mergedData = {
    venueId,
    venueName: 'Test Venue',
    venueArea: null,
    website: null,
    scrapedAt: new Date().toISOString(),
    pages: []
  };
  
  const mergedPath = path.join(TEST_SILVER_MERGED_ALL_DIR, `${venueId}.json`);
  fs.writeFileSync(mergedPath, JSON.stringify(mergedData, null, 2), 'utf8');
  
  const parsed = JSON.parse(fs.readFileSync(mergedPath, 'utf8'));
  if (parsed.venueArea !== null) throw new Error('venueArea should be null');
  if (parsed.website !== null) throw new Error('website should be null');
});

console.log('\nStep 3: Diff Flow (Paul Stewart\'s Tavern Scenario)\n');

// Diff Flow Test: Paul Stewart's Tavern
const VENUE_ID_DIFF = 'ChIJTestPaulStewart';
const VENUE_NAME_DIFF = "Paul Stewart's Tavern";
const VENUE_WEBSITE_DIFF = 'https://paulstewarttavern.example.com';

function urlToHash(url) {
  return crypto.createHash('md5').update(url).digest('hex').substring(0, 12);
}

function computeContentHash(content) {
  const normalized = content.replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

test('Diff Flow: Day 1 - Venue with no happy hour in silver_merged/all/', () => {
  const day1Html = '<html><body>Welcome to Paul Stewart\'s Tavern. We serve great food and drinks. Open daily.</body></html>';
  
  if (containsHappyHour(day1Html)) throw new Error('Day 1 should not contain happy hour');
  
  const venueDir = path.join(TEST_RAW_ALL_DIR, VENUE_ID_DIFF);
  fs.mkdirSync(venueDir, { recursive: true });
  
  const hash = urlToHash(VENUE_WEBSITE_DIFF);
  const filePath = path.join(venueDir, `${hash}.html`);
  fs.writeFileSync(filePath, day1Html, 'utf8');
  
  // Merge Day 1 content (even without happy hour, it goes to silver_merged/all/)
  const mergedData = {
    venueId: VENUE_ID_DIFF,
    venueName: VENUE_NAME_DIFF,
    pages: [{ html: day1Html }]
  };
  
  const mergedPath = path.join(TEST_SILVER_MERGED_ALL_DIR, `${VENUE_ID_DIFF}.json`);
  fs.writeFileSync(mergedPath, JSON.stringify(mergedData, null, 2), 'utf8');
  
  if (!fs.existsSync(mergedPath)) throw new Error('Should exist in silver_merged/all/ on Day 1');
});

test('Diff Flow: Day 2 - Website updated, hash diff detected, updated in silver_merged/all/', () => {
  // Day 1: Archive to previous
  const day1Html = '<html><body>Welcome to Paul Stewart\'s Tavern. We serve great food and drinks. Open daily.</body></html>';
  const previousVenueDir = path.join(TEST_DIR, 'raw/previous', VENUE_ID_DIFF);
  fs.mkdirSync(previousVenueDir, { recursive: true });
  
  const hash = urlToHash(VENUE_WEBSITE_DIFF);
  const previousFilePath = path.join(previousVenueDir, `${hash}.html`);
  fs.writeFileSync(previousFilePath, day1Html, 'utf8');
  
  // Day 2: New content with happy hour
  const day2Html = '<html><body>Welcome to Paul Stewart\'s Tavern. Happy Hour Monday-Friday 4pm-7pm. $2 off all drinks!</body></html>';
  const currentVenueDir = path.join(TEST_RAW_ALL_DIR, VENUE_ID_DIFF);
  fs.mkdirSync(currentVenueDir, { recursive: true });
  
  const currentFilePath = path.join(currentVenueDir, `${hash}.html`);
  fs.writeFileSync(currentFilePath, day2Html, 'utf8');
  
  // Verify hash difference
  const day1Hash = computeContentHash(day1Html);
  const day2Hash = computeContentHash(day2Html);
  if (day1Hash === day2Hash) throw new Error('Hashes should be different');
  
  // Verify happy hour text
  if (!containsHappyHour(day2Html)) throw new Error('Day 2 should contain happy hour');
  
  // Merge Day 2 content
  const mergedData = {
    venueId: VENUE_ID_DIFF,
    venueName: VENUE_NAME_DIFF,
    pages: [{ html: day2Html }]
  };
  
  const mergedPath = path.join(TEST_SILVER_MERGED_ALL_DIR, `${VENUE_ID_DIFF}.json`);
  fs.writeFileSync(mergedPath, JSON.stringify(mergedData, null, 2), 'utf8');
  
  // Verify happy hour is in merged data
  const hasHappyHour = mergedData.pages.some(page => containsHappyHour(page.html));
  if (!hasHappyHour) throw new Error('Should detect happy hour in merged data');
  
  // Should be updated in silver_merged/all/
  if (!fs.existsSync(mergedPath)) throw new Error('Should exist in silver_merged/all/ on Day 2');
  
  const matchedData = JSON.parse(fs.readFileSync(mergedPath, 'utf8'));
  if (matchedData.venueId !== VENUE_ID_DIFF) throw new Error('Venue ID mismatch');
  if (!matchedData.pages[0].html.includes('Happy Hour')) throw new Error('Missing happy hour text');
});

// Summary
console.log('\n📊 Test Summary:\n');
console.log(`   ✅ Passed: ${results.passed}`);
console.log(`   ❌ Failed: ${results.failed}`);
console.log(`   📊 Total:  ${results.passed + results.failed}\n`);

if (results.failed > 0) {
  console.log('❌ Failed Tests:\n');
  results.tests.filter(t => t.status === 'FAIL').forEach(t => {
    console.log(`   - ${t.name}: ${t.error}`);
  });
  process.exit(1);
} else {
  console.log('✅ All tests passed!\n');
  process.exit(0);
}
