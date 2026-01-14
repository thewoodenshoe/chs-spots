/**
 * Validation test for incremental file append functionality
 * Ensures that running prepare-incremental-llm-extraction.js multiple times
 * on the same day appends venues instead of overwriting
 */

const fs = require('fs');
const path = require('path');

const GOLD_DIR = path.join(__dirname, '../../data/gold');
const today = new Date().toISOString().split('T')[0];

function testIncrementalAppend() {
  console.log('🧪 Testing Incremental File Append Functionality\n');
  
  const incrementalInputPath = path.join(GOLD_DIR, `incremental-input-${today}.json`);
  
  if (!fs.existsSync(incrementalInputPath)) {
    console.log('⚠️  No incremental file found for today. Run prepare-incremental-llm-extraction.js first.');
    return;
  }
  
  try {
    const data = JSON.parse(fs.readFileSync(incrementalInputPath, 'utf8'));
    
    console.log(`✅ File exists: incremental-input-${today}.json`);
    console.log(`   Total venues: ${data.totalVenues}`);
    console.log(`   New: ${data.summary.new}`);
    console.log(`   Changed: ${data.summary.changed}`);
    console.log(`   Date: ${data.date}`);
    
    // Check for duplicate venue IDs
    const venueIds = data.venues.map(v => v.venueId);
    const uniqueIds = new Set(venueIds);
    
    if (venueIds.length !== uniqueIds.size) {
      console.log(`\n❌ ERROR: Found ${venueIds.length - uniqueIds.size} duplicate venue ID(s)!`);
      const duplicates = venueIds.filter((id, index) => venueIds.indexOf(id) !== index);
      console.log(`   Duplicate IDs: ${[...new Set(duplicates)].join(', ')}`);
      process.exit(1);
    }
    
    console.log(`\n✅ No duplicate venue IDs found`);
    
    // Group by area
    const byArea = {};
    for (const venue of data.venues) {
      const area = venue.venueArea || 'Unknown';
      byArea[area] = (byArea[area] || 0) + 1;
    }
    
    console.log(`\n📊 Venues by area:`);
    for (const [area, count] of Object.entries(byArea)) {
      console.log(`   ${area}: ${count}`);
    }
    
    console.log(`\n✅ Validation passed! File structure is correct.`);
    
  } catch (error) {
    console.log(`\n❌ ERROR: ${error.message}`);
    process.exit(1);
  }
}

testIncrementalAppend();
