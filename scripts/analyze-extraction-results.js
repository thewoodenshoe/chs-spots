/**
 * Analyze extraction results and provide conclusion
 */

const fs = require('fs');
const path = require('path');

const EXTRACTED_DIR = path.join(__dirname, '../data/extracted');

function main() {
  const files = fs.readdirSync(EXTRACTED_DIR).filter(f => f.endsWith('.json'));
  
  let stats = {
    total: files.length,
    happyHourFound: 0,
    businessHoursFound: 0,
    unclear: 0,
    withTimes: 0,
    withSpecials: 0,
    highConfidence: 0,
    lowConfidence: 0
  };
  
  const samples = {
    good: [],
    needsReview: [],
    businessHours: []
  };
  
  files.forEach(filename => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(EXTRACTED_DIR, filename), 'utf8'));
      
      if (data.happyHour.found) {
        stats.happyHourFound++;
        if (data.happyHour.times) stats.withTimes++;
        if (data.happyHour.specials && data.happyHour.specials.length > 0) stats.withSpecials++;
        if (data.confidence >= 0.8) stats.highConfidence++;
        else stats.lowConfidence++;
        
        if (data.confidence >= 0.8 && data.happyHour.times) {
          if (samples.good.length < 5) {
            samples.good.push({
              venue: data.venueName,
              times: data.happyHour.times,
              confidence: data.confidence
            });
          }
        } else {
          if (samples.needsReview.length < 5) {
            samples.needsReview.push({
              venue: data.venueName,
              times: data.happyHour.times,
              reason: data.happyHour.reason,
              confidence: data.confidence
            });
          }
        }
      } else if (data.businessHours.found) {
        stats.businessHoursFound++;
        if (samples.businessHours.length < 5) {
          samples.businessHours.push({
            venue: data.venueName,
            times: data.businessHours.times,
            reason: data.happyHour.reason
          });
        }
      } else {
        stats.unclear++;
      }
    } catch (e) {
      console.error(`Error processing ${filename}: ${e.message}`);
    }
  });
  
  console.log('📊 Extraction Analysis Results\n');
  console.log(`Total Processed: ${stats.total}`);
  console.log(`Happy Hour Found: ${stats.happyHourFound} (${(stats.happyHourFound/stats.total*100).toFixed(1)}%)`);
  console.log(`  - With Times: ${stats.withTimes}`);
  console.log(`  - With Specials: ${stats.withSpecials}`);
  console.log(`  - High Confidence (≥80%): ${stats.highConfidence}`);
  console.log(`  - Low Confidence (<80%): ${stats.lowConfidence}`);
  console.log(`Business Hours Found: ${stats.businessHoursFound}`);
  console.log(`Unclear/No Info: ${stats.unclear}`);
  
  console.log('\n✅ Good Extractions (High Confidence):');
  samples.good.forEach((s, i) => {
    console.log(`  ${i+1}. ${s.venue}: ${s.times} (${(s.confidence*100).toFixed(0)}% confidence)`);
  });
  
  console.log('\n⚠️  Needs Review (Low Confidence or Missing Data):');
  samples.needsReview.forEach((s, i) => {
    console.log(`  ${i+1}. ${s.venue}`);
    if (s.times) console.log(`     Times: ${s.times}`);
    if (s.reason) console.log(`     Reason: ${s.reason}`);
    console.log(`     Confidence: ${(s.confidence*100).toFixed(0)}%`);
  });
  
  console.log('\n📋 Business Hours Only:');
  samples.businessHours.forEach((s, i) => {
    console.log(`  ${i+1}. ${s.venue}: ${s.times}`);
    if (s.reason) console.log(`     Note: ${s.reason}`);
  });
  
  const successRate = ((stats.happyHourFound + stats.businessHoursFound) / stats.total * 100).toFixed(1);
  console.log(`\n📈 Overall Success Rate: ${successRate}%`);
  
  console.log('\n💡 Conclusion:');
  if (successRate >= 70 && stats.highConfidence >= stats.happyHourFound * 0.7) {
    console.log('   ✅ Rule-based extraction is WORKING WELL');
    console.log('   ✅ LLM is NOT NECESSARY - can save costs');
    console.log('   ✅ Can proceed with rule-based approach');
  } else if (successRate >= 50) {
    console.log('   ⚠️  Rule-based extraction is PARTIALLY WORKING');
    console.log('   ⚠️  Consider LLM for edge cases only');
    console.log('   💡 Hybrid approach: rules for clear cases, LLM for unclear');
  } else {
    console.log('   ❌ Rule-based extraction needs improvement');
    console.log('   💡 LLM may be necessary for better accuracy');
  }
}

main();
