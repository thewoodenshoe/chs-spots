/**
 * Combine Grok UI extraction results from multiple parts
 * 
 * This script combines JSON results from part1 and part2 into a single file
 */

const fs = require('fs');
const path = require('path');

const EXTRACTED_DIR = path.join(__dirname, '../data/extracted');

function main() {
  console.log('🔗 Combining Grok UI extraction results...\n');
  
  // Look for result files
  const part1Path = path.join(EXTRACTED_DIR, 'part1-results.json');
  const part2Path = path.join(EXTRACTED_DIR, 'part2-results.json');
  
  const results = [];
  
  // Load part 1
  if (fs.existsSync(part1Path)) {
    try {
      const part1Data = JSON.parse(fs.readFileSync(part1Path, 'utf8'));
      if (Array.isArray(part1Data)) {
        results.push(...part1Data);
        console.log(`✅ Loaded ${part1Data.length} venues from part1-results.json`);
      } else {
        console.error(`❌ part1-results.json is not an array`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`❌ Error loading part1-results.json: ${error.message}`);
      process.exit(1);
    }
  } else {
    console.warn(`⚠️  part1-results.json not found at ${part1Path}`);
  }
  
  // Load part 2
  if (fs.existsSync(part2Path)) {
    try {
      const part2Data = JSON.parse(fs.readFileSync(part2Path, 'utf8'));
      if (Array.isArray(part2Data)) {
        results.push(...part2Data);
        console.log(`✅ Loaded ${part2Data.length} venues from part2-results.json`);
      } else {
        console.error(`❌ part2-results.json is not an array`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`❌ Error loading part2-results.json: ${error.message}`);
      process.exit(1);
    }
  } else {
    console.warn(`⚠️  part2-results.json not found at ${part2Path}`);
  }
  
  if (results.length === 0) {
    console.error(`❌ No results found. Please ensure part1-results.json and/or part2-results.json exist in ${EXTRACTED_DIR}`);
    process.exit(1);
  }
  
  // Remove duplicates (by venueId)
  const seen = new Set();
  const uniqueResults = results.filter(item => {
    const venueId = item.venueId;
    if (seen.has(venueId)) {
      console.warn(`⚠️  Duplicate venueId found: ${venueId} (${item.venueName || 'Unknown'})`);
      return false;
    }
    seen.add(venueId);
    return true;
  });
  
  // Save combined results
  const outputPath = path.join(EXTRACTED_DIR, 'grok-extraction-results.json');
  fs.writeFileSync(outputPath, JSON.stringify(uniqueResults, null, 2), 'utf8');
  
  // Statistics
  const withHappyHour = uniqueResults.filter(r => r.happyHour && r.happyHour.found).length;
  const withTimes = uniqueResults.filter(r => r.happyHour && r.happyHour.found && r.happyHour.times).length;
  const withDays = uniqueResults.filter(r => r.happyHour && r.happyHour.found && r.happyHour.days).length;
  const withSpecials = uniqueResults.filter(r => r.happyHour && r.happyHour.found && r.happyHour.specials && r.happyHour.specials.length > 0).length;
  
  console.log(`\n📊 Summary:`);
  console.log(`   ✅ Total venues: ${uniqueResults.length}`);
  console.log(`   🍹 Happy hour found: ${withHappyHour} (${(withHappyHour/uniqueResults.length*100).toFixed(1)}%)`);
  console.log(`   ⏰ With times: ${withTimes} (${(withTimes/withHappyHour*100).toFixed(1)}% of happy hours)`);
  console.log(`   📅 With days: ${withDays} (${(withDays/withHappyHour*100).toFixed(1)}% of happy hours)`);
  console.log(`   💰 With specials: ${withSpecials} (${(withSpecials/withHappyHour*100).toFixed(1)}% of happy hours)`);
  console.log(`\n📄 Combined results saved to: ${path.resolve(outputPath)}`);
  console.log(`\n✨ Done!`);
}

main();
