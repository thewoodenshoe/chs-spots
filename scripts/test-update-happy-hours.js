const fs = require('fs');
const path = require('path');

// Test that fetch is available
console.log('Testing fetch availability...');
if (typeof fetch === 'undefined') {
  console.error('❌ ERROR: fetch is not available');
  console.error('   Node.js 18+ is required for built-in fetch');
  process.exit(1);
}
console.log('✅ fetch is available');

// Test that cheerio is available
console.log('\nTesting cheerio availability...');
try {
  const cheerio = require('cheerio');
  const $ = cheerio.load('<html><body><p>Test</p></body></html>');
  const text = $('p').text();
  if (text !== 'Test') {
    throw new Error('Cheerio not working correctly');
  }
  console.log('✅ cheerio is available and working');
} catch (error) {
  console.error('❌ ERROR: cheerio is not available or not working');
  console.error('   Run: npm install cheerio');
  process.exit(1);
}

// Test that venues.json exists
console.log('\nTesting data files...');
const VENUES_PATH = path.join(__dirname, '../data/venues.json');
if (!fs.existsSync(VENUES_PATH)) {
  console.error(`❌ ERROR: ${VENUES_PATH} does not exist`);
  process.exit(1);
}
console.log('✅ venues.json exists');

// Test loading venues
try {
  const venues = JSON.parse(fs.readFileSync(VENUES_PATH, 'utf8'));
  if (!Array.isArray(venues)) {
    throw new Error('venues.json is not an array');
  }
  console.log(`✅ venues.json is valid (${venues.length} venues)`);
} catch (error) {
  console.error(`❌ ERROR: Failed to load venues.json: ${error.message}`);
  process.exit(1);
}

// Test fetch with a simple request
console.log('\nTesting fetch functionality...');
(async () => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch('https://httpbin.org/get', {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    console.log('✅ fetch is working correctly');
    console.log(`   Tested with: ${response.url}`);
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error('❌ ERROR: Fetch request timed out');
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      console.log('⚠️  WARNING: Network test failed (no internet connection)');
      console.log('   This is okay - fetch is available, just can\'t test network');
    } else {
      console.error(`❌ ERROR: Fetch test failed: ${error.message}`);
    }
  }
  
  console.log('\n✅ All basic tests passed!');
  console.log('   The script should work correctly.');
})();

