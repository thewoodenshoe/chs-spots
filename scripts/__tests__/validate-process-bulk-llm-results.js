/**
 * Validation Test: Process Bulk LLM Results
 * 
 * Standalone validation script (not Jest) for process-bulk-llm-results.js
 * Tests the bulk processing logic with test data
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TEST_DIR = path.join(__dirname, '../../.test-data');
const TEST_GOLD_DIR = path.join(TEST_DIR, 'gold');
const TEST_SILVER_MERGED_ALL_DIR = path.join(TEST_DIR, 'silver_merged/all');

function cleanTestDir() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(TEST_GOLD_DIR, { recursive: true });
  fs.mkdirSync(TEST_SILVER_MERGED_ALL_DIR, { recursive: true });
}

function computeSourceHash(venueId, baseDir = TEST_SILVER_MERGED_ALL_DIR) {
  const silverPath = path.join(baseDir, `${venueId}.json`);
  if (!fs.existsSync(silverPath)) {
    return null;
  }
  
  try {
    const data = JSON.parse(fs.readFileSync(silverPath, 'utf8'));
    const content = JSON.stringify(data);
    const normalized = content.replace(/\s+/g, ' ').trim();
    return crypto.createHash('sha256').update(normalized).digest('hex').substring(0, 16);
  } catch (e) {
    return null;
  }
}

function processBulkResults(bulkResultsArray, goldDir = TEST_GOLD_DIR, silverMergedDir = TEST_SILVER_MERGED_ALL_DIR) {
  const results = [];
  const bulkCompletePath = path.join(goldDir, '.bulk-complete');
  
  // Ensure gold directory exists
  if (!fs.existsSync(goldDir)) {
    fs.mkdirSync(goldDir, { recursive: true });
  }
  
  // Check if already processed
  if (fs.existsSync(bulkCompletePath)) {
    return { skipped: true, results: [] };
  }
  
  for (const venueResult of bulkResultsArray) {
    const venueId = venueResult.venueId;
    if (!venueId) {
      continue;
    }
    
    // Get source metadata
    const sourceHash = computeSourceHash(venueId, silverMergedDir);
    
    // Load silver_merged data for venue name
    let venueName = venueResult.venueName || 'Unknown';
    try {
      const silverPath = path.join(silverMergedDir, `${venueId}.json`);
      if (fs.existsSync(silverPath)) {
        const silverData = JSON.parse(fs.readFileSync(silverPath, 'utf8'));
        venueName = silverData.venueName || venueName;
      }
    } catch (e) {
      // Use venueName from result
    }
    
    // Create gold file structure
    const goldData = {
      venueId,
      venueName,
      extractedAt: new Date().toISOString(),
      extractionMethod: 'llm-bulk',
      sourceHash: sourceHash || null,
      happyHour: venueResult.happyHour || {
        found: false,
        reason: 'Not extracted from bulk results'
      },
      needsLLM: false
    };
    
    // Save gold file
    const goldPath = path.join(goldDir, `${venueId}.json`);
    fs.writeFileSync(goldPath, JSON.stringify(goldData, null, 2), 'utf8');
    
    results.push({
      venueId,
      venueName,
      success: true
    });
  }
  
  // Mark bulk as complete
  fs.writeFileSync(bulkCompletePath, new Date().toISOString(), 'utf8');
  
  return { skipped: false, results };
}

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    return true;
  } catch (error) {
    console.error(`❌ ${name}`);
    console.error(`   Error: ${error.message}`);
    if (error.stack) {
      console.error(`   Stack: ${error.stack.split('\n')[1]}`);
    }
    return false;
  }
}

function main() {
  console.log('🧪 Validating Process Bulk LLM Results\n');
  
  let passed = 0;
  let failed = 0;
  
  // Test 1: Process array format input
  cleanTestDir();
  if (test('Should process array format and create gold files', () => {
    const venueId1 = 'ChIJTest123';
    const venueId2 = 'ChIJTest456';
    
    // Create silver_merged files
    const silver1 = { venueId: venueId1, venueName: 'Test Venue 1', pages: [] };
    fs.writeFileSync(
      path.join(TEST_SILVER_MERGED_ALL_DIR, `${venueId1}.json`),
      JSON.stringify(silver1, null, 2),
      'utf8'
    );
    
    const bulkResults = [
      {
        venueId: venueId1,
        venueName: 'Test Venue 1',
        happyHour: { found: true, times: '4pm-7pm' }
      },
      {
        venueId: venueId2,
        venueName: 'Test Venue 2',
        happyHour: { found: true, times: '5pm-8pm' }
      }
    ];
    
    const { skipped, results } = processBulkResults(bulkResults);
    
    if (skipped) throw new Error('Should not skip');
    if (results.length !== 2) throw new Error(`Expected 2 results, got ${results.length}`);
    
    const goldPath1 = path.join(TEST_GOLD_DIR, `${venueId1}.json`);
    const goldPath2 = path.join(TEST_GOLD_DIR, `${venueId2}.json`);
    
    if (!fs.existsSync(goldPath1)) throw new Error(`Gold file 1 not created`);
    if (!fs.existsSync(goldPath2)) throw new Error(`Gold file 2 not created`);
    
    const goldData1 = JSON.parse(fs.readFileSync(goldPath1, 'utf8'));
    if (goldData1.venueId !== venueId1) throw new Error('Wrong venueId in gold file');
    if (goldData1.extractionMethod !== 'llm-bulk') throw new Error('Wrong extractionMethod');
    if (!goldData1.happyHour.found) throw new Error('happyHour.found should be true');
    if (goldData1.sourceHash === null) throw new Error('sourceHash should be computed');
    
    const bulkCompletePath = path.join(TEST_GOLD_DIR, '.bulk-complete');
    if (!fs.existsSync(bulkCompletePath)) throw new Error('.bulk-complete flag not created');
  })) {
    passed++;
  } else {
    failed++;
  }
  
  // Test 2: Skip if already processed
  cleanTestDir();
  if (test('Should skip re-processing if .bulk-complete exists', () => {
    const bulkCompletePath = path.join(TEST_GOLD_DIR, '.bulk-complete');
    fs.writeFileSync(bulkCompletePath, new Date().toISOString(), 'utf8');
    
    const bulkResults = [
      {
        venueId: 'ChIJTest123',
        venueName: 'Test Venue',
        happyHour: { found: true }
      }
    ];
    
    const { skipped, results } = processBulkResults(bulkResults);
    
    if (!skipped) throw new Error('Should skip when .bulk-complete exists');
    if (results.length !== 0) throw new Error('Should return empty results when skipped');
    
    const goldPath = path.join(TEST_GOLD_DIR, 'ChIJTest123.json');
    if (fs.existsSync(goldPath)) throw new Error('Gold file should not be created when skipped');
  })) {
    passed++;
  } else {
    failed++;
  }
  
  // Test 3: Handle missing silver_merged gracefully
  cleanTestDir();
  if (test('Should handle missing silver_matched file gracefully', () => {
    const venueId = 'ChIJTest123';
    
    const bulkResults = [
      {
        venueId,
        venueName: 'Test Venue from Bulk',
        happyHour: { found: true }
      }
    ];
    
    const { skipped, results } = processBulkResults(bulkResults);
    
    if (skipped) throw new Error('Should not skip');
    if (results.length !== 1) throw new Error(`Expected 1 result, got ${results.length}`);
    
    const goldPath = path.join(TEST_GOLD_DIR, `${venueId}.json`);
    const goldData = JSON.parse(fs.readFileSync(goldPath, 'utf8'));
    
    if (goldData.venueName !== 'Test Venue from Bulk') throw new Error('Should use venueName from bulk');
    if (goldData.sourceHash !== null) throw new Error('sourceHash should be null when silver_merged missing');
  })) {
    passed++;
  } else {
    failed++;
  }
  
  // Test 4: Prefer venueName from silver_merged
  cleanTestDir();
  if (test('Should prefer venueName from silver_matched over bulk results', () => {
    const venueId = 'ChIJTest123';
    
    const silverData = { venueId, venueName: 'Correct Venue Name', pages: [] };
    fs.writeFileSync(
      path.join(TEST_SILVER_MERGED_ALL_DIR, `${venueId}.json`),
      JSON.stringify(silverData, null, 2),
      'utf8'
    );
    
    const bulkResults = [
      {
        venueId,
        venueName: 'Wrong Venue Name',
        happyHour: { found: true }
      }
    ];
    
    processBulkResults(bulkResults);
    
    const goldPath = path.join(TEST_GOLD_DIR, `${venueId}.json`);
    const goldData = JSON.parse(fs.readFileSync(goldPath, 'utf8'));
    
    if (goldData.venueName !== 'Correct Venue Name') {
      throw new Error(`Expected 'Correct Venue Name', got '${goldData.venueName}'`);
    }
  })) {
    passed++;
  } else {
    failed++;
  }
  
  // Test 5: Skip venues with missing venueId
  cleanTestDir();
  if (test('Should skip venues with missing venueId', () => {
    const bulkResults = [
      {
        venueId: 'ChIJTest123',
        venueName: 'Valid Venue',
        happyHour: { found: true }
      },
      {
        // Missing venueId
        venueName: 'Invalid Venue',
        happyHour: { found: true }
      }
    ];
    
    const { skipped, results } = processBulkResults(bulkResults);
    
    if (results.length !== 1) throw new Error(`Expected 1 result, got ${results.length}`);
    
    const files = fs.readdirSync(TEST_GOLD_DIR).filter(f => f.endsWith('.json') && f !== '.bulk-complete');
    if (files.length !== 1) throw new Error(`Expected 1 gold file, got ${files.length}`);
  })) {
    passed++;
  } else {
    failed++;
  }
  
  // Summary
  console.log(`\n📊 Summary: ${passed} passed, ${failed} failed\n`);
  
  if (failed === 0) {
    console.log('✅ All tests passed!');
    cleanTestDir();
    process.exit(0);
  } else {
    console.log('❌ Some tests failed');
    cleanTestDir();
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { processBulkResults, computeSourceHash };
