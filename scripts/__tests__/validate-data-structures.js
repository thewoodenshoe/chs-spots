/**
 * Data Structure Validation Script
 * 
 * Validates that actual data files conform to expected structures.
 * Can be run on real data: node scripts/__tests__/validate-data-structures.js
 */

const fs = require('fs');
const path = require('path');

const RAW_TODAY_DIR = path.join(__dirname, '../../data/raw/today');
const SILVER_MERGED_TODAY_DIR = path.join(__dirname, '../../data/silver_merged/today');

const results = {
  passed: 0,
  failed: 0,
  warnings: 0,
  issues: []
};

function test(name, fn) {
  try {
    fn();
    results.passed++;
    console.log(`✅ ${name}`);
  } catch (error) {
    results.failed++;
    results.issues.push({ name, error: error.message, type: 'error' });
    console.error(`❌ ${name}: ${error.message}`);
  }
}

function warn(name, message) {
  results.warnings++;
  results.issues.push({ name, error: message, type: 'warning' });
  console.warn(`⚠️  ${name}: ${message}`);
}

console.log('🔍 Data Structure Validation\n');

// Validate Raw Directory Structure
console.log('Step 1: Validating Raw Directory Structure\n');

// Check if data directories exist - if not, skip validation (normal for CI/initial setup)
if (!fs.existsSync(RAW_TODAY_DIR)) {
  console.log('⚠️  Raw directory does not exist - skipping validation');
  console.log('   This is normal for CI or first-time setup.');
  console.log('   Run download-raw-html.js to generate data.\n');
  console.log('📊 Validation Summary:\n');
  console.log(`   ✅ Passed: 0`);
  console.log(`   ❌ Failed: 0`);
  console.log(`   ⚠️  Warnings: 1`);
  console.log(`   📊 Total:  1\n`);
  console.log('✅ Validation skipped (no data directories found)\n');
  process.exit(0);
}

if (fs.existsSync(RAW_TODAY_DIR)) {
  const venueDirs = fs.readdirSync(RAW_TODAY_DIR).filter(item => {
    const itemPath = path.join(RAW_TODAY_DIR, item);
    return fs.statSync(itemPath).isDirectory();
  });
  
  test(`Raw/all directory exists`, () => {
    if (!fs.existsSync(RAW_TODAY_DIR)) throw new Error('Raw/all directory not found');
  });
  
  test(`Found ${venueDirs.length} venue directories in raw/all`, () => {
    if (venueDirs.length === 0) warn('No venues in raw/all directory', 'This may be normal for first run');
  });
  
  // Validate a few venue directories
  venueDirs.slice(0, 5).forEach(venueId => {
    const venueDir = path.join(RAW_TODAY_DIR, venueId);
    const files = fs.readdirSync(venueDir);
    const htmlFiles = files.filter(f => f.endsWith('.html'));
    const metadataFile = files.includes('metadata.json');
    
    test(`Venue ${venueId} has HTML files`, () => {
      if (htmlFiles.length === 0) throw new Error('No HTML files found');
    });
    
    test(`Venue ${venueId} has metadata.json`, () => {
      if (!metadataFile) throw new Error('Missing metadata.json');
    });
    
    if (metadataFile) {
      test(`Venue ${venueId} metadata.json is valid JSON`, () => {
        const metadataPath = path.join(venueDir, 'metadata.json');
        try {
          const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
          if (typeof metadata !== 'object') throw new Error('Metadata is not an object');
        } catch (e) {
          throw new Error(`Invalid JSON: ${e.message}`);
        }
      });
      
      test(`Venue ${venueId} metadata matches HTML files`, () => {
        const metadataPath = path.join(venueDir, 'metadata.json');
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        
        // Check that each HTML file has corresponding metadata entry
        htmlFiles.forEach(file => {
          const hash = file.replace('.html', '');
          if (!metadata[hash]) {
            warn(`Venue ${venueId} HTML file ${file} missing from metadata`, 
              `Hash ${hash} not found in metadata`);
          }
        });
      });
    }
  });
} else {
  warn('Raw directory does not exist', 'Run download-raw-html.js first');
}

// Validate Silver Merged Directory Structure
console.log('\nStep 2: Validating Silver Merged Directory Structure\n');

if (!fs.existsSync(SILVER_MERGED_TODAY_DIR)) {
  warn('Silver merged directory does not exist', 'Run merge-raw-files.js first');
} else if (fs.existsSync(SILVER_MERGED_TODAY_DIR)) {
  const mergedFiles = fs.readdirSync(SILVER_MERGED_TODAY_DIR).filter(f => f.endsWith('.json'));
  
  test(`Silver merged/all directory exists`, () => {
    if (!fs.existsSync(SILVER_MERGED_TODAY_DIR)) throw new Error('Silver merged/all directory not found');
  });
  
  test(`Found ${mergedFiles.length} merged files`, () => {
    if (mergedFiles.length === 0) warn('No merged files found', 'Run merge-raw-files.js first');
  });
  
  // Validate merged file structures
  mergedFiles.slice(0, 10).forEach(file => {
    const filePath = path.join(SILVER_MERGED_TODAY_DIR, file);
    
    test(`Merged file ${file} is valid JSON`, () => {
      try {
        JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (e) {
        throw new Error(`Invalid JSON: ${e.message}`);
      }
    });
    
    test(`Merged file ${file} has required fields`, () => {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      
      if (!data.venueId) throw new Error('Missing venueId');
      if (!data.venueName) throw new Error('Missing venueName');
      if (!data.scrapedAt) throw new Error('Missing scrapedAt');
      if (!data.pages) throw new Error('Missing pages array');
      if (!Array.isArray(data.pages)) throw new Error('pages must be an array');
    });
    
    test(`Merged file ${file} has valid pages array`, () => {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      
      if (data.pages.length === 0) {
        warn(`Merged file ${file} has no pages`, 'This may be normal');
      }
      
      data.pages.forEach((page, index) => {
        if (!page.url) throw new Error(`Page ${index} missing url`);
        if (!page.html) throw new Error(`Page ${index} missing html`);
        if (typeof page.html !== 'string') throw new Error(`Page ${index} html is not a string`);
        if (!page.hash) throw new Error(`Page ${index} missing hash`);
        if (!page.downloadedAt) throw new Error(`Page ${index} missing downloadedAt`);
      });
    });
    
    test(`Merged file ${file} scrapedAt is valid ISO date`, () => {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const dateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
      if (!dateRegex.test(data.scrapedAt)) {
        throw new Error('scrapedAt is not a valid ISO date string');
      }
    });
  });
} else {
  warn('Silver merged directory does not exist', 'Run merge-raw-files.js first');
}

// Note: silver_matched layer has been removed - all data flows through silver_merged/today/

// Summary
console.log('\n📊 Validation Summary:\n');
console.log(`   ✅ Passed: ${results.passed}`);
console.log(`   ❌ Failed: ${results.failed}`);
console.log(`   ⚠️  Warnings: ${results.warnings}`);
console.log(`   📊 Total:  ${results.passed + results.failed + results.warnings}\n`);

if (results.failed > 0) {
  console.log('❌ Failed Validations:\n');
  results.issues.filter(i => i.type === 'error').forEach(i => {
    console.log(`   - ${i.name}: ${i.error}`);
  });
}

if (results.warnings > 0) {
  console.log('\n⚠️  Warnings:\n');
  results.issues.filter(i => i.type === 'warning').forEach(i => {
    console.log(`   - ${i.name}: ${i.error}`);
  });
}

if (results.failed > 0) {
  process.exit(1);
} else {
  console.log('✅ All validations passed!\n');
  process.exit(0);
}
