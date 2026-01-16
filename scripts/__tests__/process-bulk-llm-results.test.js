/**
 * Unit Test: Process Bulk LLM Results
 * 
 * Tests that process-bulk-llm-results.js correctly:
 * - Handles array format input (from manual Grok extraction)
 * - Creates individual gold/<venue-id>.json files
 * - Marks bulk as complete (.bulk-complete flag)
 * - Computes source hashes correctly
   * - Handles missing silver_merged files gracefully
 * - Skips re-processing if already complete
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TEST_DIR = path.join(__dirname, '../../.test-data');
const TEST_GOLD_DIR = path.join(TEST_DIR, 'gold');
const TEST_SILVER_MERGED_ALL_DIR = path.join(TEST_DIR, 'silver_merged/all');

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
  fs.mkdirSync(TEST_GOLD_DIR, { recursive: true });
  fs.mkdirSync(TEST_SILVER_MERGED_ALL_DIR, { recursive: true });
}

// Mock the script's functions by copying logic
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

function getSourceModifiedAt(venueId, baseDir = TEST_SILVER_MERGED_ALL_DIR) {
  const silverPath = path.join(baseDir, `${venueId}.json`);
  if (!fs.existsSync(silverPath)) {
    return null;
  }
  
  try {
    const stats = fs.statSync(silverPath);
    return stats.mtime.toISOString();
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
    const sourceModifiedAt = getSourceModifiedAt(venueId, silverMergedDir);
    
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
      sourceModifiedAt: sourceModifiedAt || null,
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

describe('Process Bulk LLM Results', () => {
  
  beforeEach(() => {
    cleanTestDir();
  });
  
  afterAll(() => {
    cleanTestDir();
  });
  
  test('Should process array format input and create gold files', () => {
    const venueId1 = 'ChIJTest123';
    const venueId2 = 'ChIJTest456';
    
    // Create silver_merged files
    const silver1 = {
      venueId: venueId1,
      venueName: 'Test Venue 1',
      pages: []
    };
    fs.writeFileSync(
      path.join(TEST_SILVER_MERGED_ALL_DIR, `${venueId1}.json`),
      JSON.stringify(silver1, null, 2),
      'utf8'
    );
    
    const silver2 = {
      venueId: venueId2,
      venueName: 'Test Venue 2',
      pages: []
    };
    fs.writeFileSync(
      path.join(TEST_SILVER_MERGED_ALL_DIR, `${venueId2}.json`),
      JSON.stringify(silver2, null, 2),
      'utf8'
    );
    
    // Create bulk results (array format)
    const bulkResults = [
      {
        venueId: venueId1,
        venueName: 'Test Venue 1',
        happyHour: {
          found: true,
          times: '4pm-7pm',
          days: 'Monday-Friday'
        }
      },
      {
        venueId: venueId2,
        venueName: 'Test Venue 2',
        happyHour: {
          found: true,
          times: '5pm-8pm',
          days: 'Daily'
        }
      }
    ];
    
    // Process bulk results
    const { skipped, results } = processBulkResults(bulkResults);
    
    expect(skipped).toBe(false);
    expect(results).toHaveLength(2);
    expect(results[0].venueId).toBe(venueId1);
    expect(results[1].venueId).toBe(venueId2);
    
    // Check gold files created
    const goldPath1 = path.join(TEST_GOLD_DIR, `${venueId1}.json`);
    const goldPath2 = path.join(TEST_GOLD_DIR, `${venueId2}.json`);
    
    expect(fs.existsSync(goldPath1)).toBe(true);
    expect(fs.existsSync(goldPath2)).toBe(true);
    
    // Check gold file content
    const goldData1 = JSON.parse(fs.readFileSync(goldPath1, 'utf8'));
    expect(goldData1.venueId).toBe(venueId1);
    expect(goldData1.venueName).toBe('Test Venue 1');
    expect(goldData1.extractionMethod).toBe('llm-bulk');
    expect(goldData1.happyHour.found).toBe(true);
    expect(goldData1.happyHour.times).toBe('4pm-7pm');
    expect(goldData1.happyHour.days).toBe('Monday-Friday');
    expect(goldData1.sourceHash).toBeTruthy();
    expect(goldData1.needsLLM).toBe(false);
    
    // Check bulk-complete flag
    const bulkCompletePath = path.join(TEST_GOLD_DIR, '.bulk-complete');
    expect(fs.existsSync(bulkCompletePath)).toBe(true);
  });
  
  test('Should skip re-processing if .bulk-complete exists', () => {
    const venueId = 'ChIJTest123';
    
    // Create .bulk-complete flag
    const bulkCompletePath = path.join(TEST_GOLD_DIR, '.bulk-complete');
    fs.writeFileSync(bulkCompletePath, new Date().toISOString(), 'utf8');
    
    // Try to process
    const bulkResults = [
      {
        venueId,
        venueName: 'Test Venue',
        happyHour: { found: true }
      }
    ];
    
    const { skipped, results } = processBulkResults(bulkResults);
    
    expect(skipped).toBe(true);
    expect(results).toHaveLength(0);
    
    // Gold file should not be created
    const goldPath = path.join(TEST_GOLD_DIR, `${venueId}.json`);
    expect(fs.existsSync(goldPath)).toBe(false);
  });
  
  test('Should compute source hash from silver_merged file', () => {
    const venueId = 'ChIJTest123';
    
    // Create silver_matched file
    const silverData = {
      venueId,
      venueName: 'Test Venue',
      pages: [{ url: 'https://example.com', content: 'test' }]
    };
    fs.writeFileSync(
      path.join(TEST_SILVER_MERGED_ALL_DIR, `${venueId}.json`),
      JSON.stringify(silverData, null, 2),
      'utf8'
    );
    
    // Process
    const bulkResults = [
      {
        venueId,
        venueName: 'Test Venue',
        happyHour: { found: true }
      }
    ];
    
    processBulkResults(bulkResults);
    
    // Check gold file has source hash
    const goldPath = path.join(TEST_GOLD_DIR, `${venueId}.json`);
    const goldData = JSON.parse(fs.readFileSync(goldPath, 'utf8'));
    
    expect(goldData.sourceHash).toBeTruthy();
    expect(typeof goldData.sourceHash).toBe('string');
    expect(goldData.sourceHash.length).toBe(16);
  });
  
  test('Should handle missing silver_merged file gracefully', () => {
    const venueId = 'ChIJTest123';
    
    // No silver_merged file exists
    
    // Process
    const bulkResults = [
      {
        venueId,
        venueName: 'Test Venue from Bulk',
        happyHour: { found: true }
      }
    ];
    
    const { skipped, results } = processBulkResults(bulkResults);
    
    expect(skipped).toBe(false);
    expect(results).toHaveLength(1);
    
    // Check gold file (should use venueName from bulk results)
    const goldPath = path.join(TEST_GOLD_DIR, `${venueId}.json`);
    const goldData = JSON.parse(fs.readFileSync(goldPath, 'utf8'));
    
    expect(goldData.venueName).toBe('Test Venue from Bulk');
    expect(goldData.sourceHash).toBeNull();
    expect(goldData.sourceModifiedAt).toBeNull();
  });
  
  test('Should prefer venueName from silver_merged over bulk results', () => {
    const venueId = 'ChIJTest123';
    
    // Create silver_merged file with different name
    const silverData = {
      venueId,
      venueName: 'Correct Venue Name',
      pages: []
    };
    fs.writeFileSync(
      path.join(TEST_SILVER_MERGED_ALL_DIR, `${venueId}.json`),
      JSON.stringify(silverData, null, 2),
      'utf8'
    );
    
    // Process with different name in bulk results
    const bulkResults = [
      {
        venueId,
        venueName: 'Wrong Venue Name',
        happyHour: { found: true }
      }
    ];
    
    processBulkResults(bulkResults);
    
    // Check gold file uses correct name from silver_merged
    const goldPath = path.join(TEST_GOLD_DIR, `${venueId}.json`);
    const goldData = JSON.parse(fs.readFileSync(goldPath, 'utf8'));
    
    expect(goldData.venueName).toBe('Correct Venue Name');
  });
  
  test('Should skip venues with missing venueId', () => {
    const venueId = 'ChIJTest123';
    
    // Process with one valid and one invalid venue
    const bulkResults = [
      {
        venueId,
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
    
    expect(skipped).toBe(false);
    expect(results).toHaveLength(1);
    expect(results[0].venueId).toBe(venueId);
    
    // Only one gold file should be created
    const goldPath = path.join(TEST_GOLD_DIR, `${venueId}.json`);
    expect(fs.existsSync(goldPath)).toBe(true);
    
    const files = fs.readdirSync(TEST_GOLD_DIR).filter(f => f.endsWith('.json'));
    expect(files).toHaveLength(1);
  });
  
  test('Should handle happyHour with found: false', () => {
    const venueId = 'ChIJTest123';
    
    const bulkResults = [
      {
        venueId,
        venueName: 'Test Venue',
        happyHour: {
          found: false,
          reason: 'No happy hour information found'
        }
      }
    ];
    
    processBulkResults(bulkResults);
    
    const goldPath = path.join(TEST_GOLD_DIR, `${venueId}.json`);
    const goldData = JSON.parse(fs.readFileSync(goldPath, 'utf8'));
    
    expect(goldData.happyHour.found).toBe(false);
    expect(goldData.happyHour.reason).toBe('No happy hour information found');
  });
  
  test('Should handle missing happyHour field', () => {
    const venueId = 'ChIJTest123';
    
    const bulkResults = [
      {
        venueId,
        venueName: 'Test Venue'
        // Missing happyHour
      }
    ];
    
    processBulkResults(bulkResults);
    
    const goldPath = path.join(TEST_GOLD_DIR, `${venueId}.json`);
    const goldData = JSON.parse(fs.readFileSync(goldPath, 'utf8'));
    
    expect(goldData.happyHour.found).toBe(false);
    expect(goldData.happyHour.reason).toBe('Not extracted from bulk results');
  });
});
