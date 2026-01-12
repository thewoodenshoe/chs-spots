/**
 * Test Rule-Based Happy Hour Extraction
 * 
 * This script tests rule-based extraction patterns on scraped data
 * to determine if LLM is necessary or if rules are sufficient
 */

const fs = require('fs');
const path = require('path');

const SCRAPED_DIR = path.join(__dirname, '../data/scraped');
const EXTRACTED_DIR = path.join(__dirname, '../data/extracted');

// Ensure extracted directory exists
if (!fs.existsSync(EXTRACTED_DIR)) {
  fs.mkdirSync(EXTRACTED_DIR, { recursive: true });
}

/**
 * Extract time patterns from text
 */
function extractTimePatterns(text) {
  const patterns = [];
  
  // Pattern 1: "4pm-7pm", "4:00pm-7:00pm", "4 PM - 7 PM"
  const timeRangeRegex = /(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)?)\s*[-–—]\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)?)/gi;
  let match;
  while ((match = timeRangeRegex.exec(text)) !== null) {
    patterns.push({
      type: 'time_range',
      value: `${match[1].trim()} - ${match[2].trim()}`,
      fullMatch: match[0],
      position: match.index
    });
  }
  
  // Pattern 2: "Monday - Friday 4pm-7pm"
  const dayTimeRegex = /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun|Daily|Weekdays|Weekends)(?:\s*[-–—]?\s*(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun))?\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)?)\s*[-–—]\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)?)/gi;
  while ((match = dayTimeRegex.exec(text)) !== null) {
    patterns.push({
      type: 'day_time_range',
      days: match[1],
      value: `${match[2].trim()} - ${match[3].trim()}`,
      fullMatch: match[0],
      position: match.index
    });
  }
  
  return patterns;
}

/**
 * Extract day patterns
 */
function extractDayPatterns(text) {
  const days = [];
  const dayRegex = /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun|Daily|Weekdays|Weekends)/gi;
  let match;
  const seen = new Set();
  while ((match = dayRegex.exec(text)) !== null) {
    const day = match[1].toLowerCase();
    if (!seen.has(day)) {
      seen.add(day);
      days.push({
        value: match[1],
        position: match.index
      });
    }
  }
  return days;
}

/**
 * Extract specials/deals from text
 */
function extractSpecials(text) {
  const specials = [];
  const textLower = text.toLowerCase();
  
  // Look for common special patterns
  const specialPatterns = [
    /\$(\d+(?:\.\d+)?)\s+off/gi,
    /\$(\d+(?:\.\d+)?)\s+(?:beer|wine|cocktail|drink|shot|appetizer|app)/gi,
    /(\d+)%\s+off/gi,
    /half\s+price/gi,
    /buy\s+one\s+get\s+one/gi,
    /bogo/gi,
    /(\d+)\s+for\s+\$(\d+)/gi
  ];
  
  specialPatterns.forEach((pattern, index) => {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      specials.push({
        type: index === 0 ? 'dollar_off' : index === 1 ? 'dollar_price' : index === 2 ? 'percent_off' : 'other',
        value: match[0],
        position: match.index
      });
    }
  });
  
  return specials;
}

/**
 * Determine if text contains business hours vs happy hour
 */
function distinguishBusinessHours(text) {
  const textLower = text.toLowerCase();
  
  // Strong indicators of business hours (not happy hour)
  const businessHourIndicators = [
    'business hours',
    'hours of operation',
    'open',
    'closed',
    'we are open',
    'restaurant hours',
    'bar hours',
    'kitchen hours'
  ];
  
  // Strong indicators of happy hour
  const happyHourIndicators = [
    'happy hour',
    'happyhour',
    'happier hour',
    'hh',
    'drink specials',
    'bar specials',
    'daily specials'
  ];
  
  const hasBusinessHours = businessHourIndicators.some(indicator => textLower.includes(indicator));
  const hasHappyHour = happyHourIndicators.some(indicator => textLower.includes(indicator));
  
  // If both present, analyze more carefully
  if (hasBusinessHours && hasHappyHour) {
    const businessIndex = textLower.indexOf('business hours');
    const happyIndex = textLower.indexOf('happy hour');
    
    // Check if times are associated with "business hours" vs "happy hour"
    const timeMatches = text.match(/\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)\s*[-–—]\s*\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)/gi);
    
    if (timeMatches) {
      // Check if times appear right after "business hours"
      const businessContext = textLower.substring(
        Math.max(0, businessIndex - 20),
        Math.min(textLower.length, businessIndex + 200)
      );
      const happyContext = textLower.substring(
        Math.max(0, happyIndex - 20),
        Math.min(textLower.length, happyIndex + 200)
      );
      
      // If times appear in business hours context but not happy hour context
      const timesInBusinessContext = businessContext.match(/\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)\s*[-–—]\s*\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)/gi);
      const timesInHappyContext = happyContext.match(/\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)\s*[-–—]\s*\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)/gi);
      
      // If times are long spans (6+ hours), likely business hours
      const hasLongSpan = timeMatches.some(t => {
        const [start, end] = t.split(/[-–—]/);
        const startMatch = start.match(/(\d{1,2})/);
        const endMatch = end.match(/(\d{1,2})/);
        if (startMatch && endMatch) {
          let startHour = parseInt(startMatch[1]);
          let endHour = parseInt(endMatch[1]);
          // Handle PM conversion
          if (start.toLowerCase().includes('pm') && startHour < 12) startHour += 12;
          if (end.toLowerCase().includes('pm') && endHour < 12) endHour += 12;
          if (start.toLowerCase().includes('am') && startHour === 12) startHour = 0;
          if (end.toLowerCase().includes('am') && endHour === 12) endHour = 0;
          return (endHour - startHour) >= 6 || (endHour - startHour) < 0; // 6+ hour span or wraps midnight
        }
        return false;
      });
      
      if (hasLongSpan && timesInBusinessContext && !timesInHappyContext) {
        return { type: 'business_hours', confidence: 0.85 };
      }
      
      // If "happy hour" is just mentioned but no times near it, likely business hours
      if (timesInBusinessContext && !timesInHappyContext) {
        return { type: 'business_hours', confidence: 0.8 };
      }
    }
    
    // If "happy hour" appears before "business hours", might be happy hour
    if (happyIndex !== -1 && businessIndex !== -1 && happyIndex < businessIndex) {
      return { type: 'happy_hour', confidence: 0.6 };
    }
  }
  
  if (hasHappyHour && !hasBusinessHours) {
    return { type: 'happy_hour', confidence: 0.9 };
  }
  
  if (hasBusinessHours && !hasHappyHour) {
    return { type: 'business_hours', confidence: 0.9 };
  }
  
  return { type: 'unknown', confidence: 0.5 };
}

/**
 * Extract structured happy hour information from scraped data
 */
function extractStructuredInfo(scrapedData) {
  const result = {
    venueId: scrapedData.venueId,
    venueName: scrapedData.venueName,
    dateAdded: new Date().toISOString().split('T')[0],
    extractedAt: new Date().toISOString(),
    happyHour: {
      found: false,
      reason: null,
      times: null,
      days: null,
      content: null,
      specials: [],
      source: null
    },
    businessHours: {
      found: false,
      times: null,
      source: null
    },
    confidence: 0,
    notes: []
  };
  
  if (!scrapedData.rawMatches || scrapedData.rawMatches.length === 0) {
    result.happyHour.reason = 'No happy hour mentions found in scraped content';
    return result;
  }
  
  // Combine all raw matches
  const allText = scrapedData.rawMatches.map(m => m.text).join(' ');
  const sources = [...new Set(scrapedData.rawMatches.map(m => m.source))];
  
  // Distinguish business hours from happy hour
  const distinction = distinguishBusinessHours(allText);
  result.notes.push(`Classification: ${distinction.type} (confidence: ${distinction.confidence})`);
  
  if (distinction.type === 'business_hours') {
    // Extract business hours
    const timePatterns = extractTimePatterns(allText);
    const dayPatterns = extractDayPatterns(allText);
    
    if (timePatterns.length > 0 || dayPatterns.length > 0) {
      result.businessHours.found = true;
      result.businessHours.times = timePatterns.map(t => t.value).join(', ') || 
                                   dayPatterns.map(d => d.value).join(', ');
      result.businessHours.source = sources[0];
      result.happyHour.reason = 'Only business hours found, no specific happy hour times';
    } else {
      result.happyHour.reason = 'Business hours mentioned but no time patterns extracted';
    }
    result.confidence = distinction.confidence;
    return result;
  }
  
  // Extract happy hour information
  if (distinction.type === 'happy_hour' || distinction.confidence >= 0.5) {
    const timePatterns = extractTimePatterns(allText);
    const dayPatterns = extractDayPatterns(allText);
    const specials = extractSpecials(allText);
    
    // Check if times are actually for happy hour (not business hours)
    // Happy hour times are typically 2-4 hour spans, often 4pm-7pm, 5pm-7pm, etc.
    const happyHourTimePatterns = timePatterns.filter(t => {
      const match = t.value.match(/(\d{1,2})(?::\d{2})?\s*(am|pm|AM|PM)?\s*[-–—]\s*(\d{1,2})(?::\d{2})?\s*(am|pm|AM|PM)?/i);
      if (match) {
        let startHour = parseInt(match[1]);
        let endHour = parseInt(match[3]);
        const startPeriod = (match[2] || '').toLowerCase();
        const endPeriod = (match[4] || '').toLowerCase();
        
        // Convert to 24-hour
        if (startPeriod === 'pm' && startHour < 12) startHour += 12;
        if (endPeriod === 'pm' && endHour < 12) endHour += 12;
        if (startPeriod === 'am' && startHour === 12) startHour = 0;
        if (endPeriod === 'am' && endHour === 12) endHour = 0;
        
        const span = endHour > startHour ? (endHour - startHour) : (24 - startHour + endHour);
        // Happy hour is typically 1-5 hours, business hours are 6+ hours
        return span >= 1 && span <= 5;
      }
      return true; // Keep if can't parse
    });
    
    if (happyHourTimePatterns.length > 0 || dayPatterns.length > 0 || specials.length > 0) {
      result.happyHour.found = true;
      
      if (happyHourTimePatterns.length > 0) {
        result.happyHour.times = happyHourTimePatterns.map(t => t.value).join(', ');
      } else if (timePatterns.length > 0) {
        // Times found but might be business hours - check context
        result.happyHour.times = timePatterns.map(t => t.value).join(', ');
        result.notes.push('Times extracted but may be business hours');
      }
      
      if (dayPatterns.length > 0) {
        result.happyHour.days = dayPatterns.map(d => d.value).join(', ');
      }
      
      if (specials.length > 0) {
        result.happyHour.specials = specials.map(s => s.value);
      }
      
      // Get content (first 200 chars of most relevant match)
      const bestMatch = scrapedData.rawMatches[0];
      result.happyHour.content = bestMatch.text.substring(0, 200);
      result.happyHour.source = bestMatch.source;
      
      result.confidence = Math.min(0.9, distinction.confidence + (happyHourTimePatterns.length > 0 ? 0.1 : 0));
    } else {
      // Happy hour mentioned but no valid times - might be business hours
      const hasBusinessHours = distinction.type === 'business_hours';
      if (hasBusinessHours && timePatterns.length > 0) {
        result.happyHour.reason = 'Happy hour mentioned but only business hours times found';
      } else {
        result.happyHour.reason = 'Happy hour mentioned but no time patterns or specials extracted';
      }
      result.confidence = 0.3;
    }
  } else {
    result.happyHour.reason = 'Unclear if happy hour or business hours';
    result.confidence = 0.4;
  }
  
  return result;
}

/**
 * Main test function
 */
function main() {
  console.log('🧪 Testing Rule-Based Happy Hour Extraction\n');
  
  const files = fs.readdirSync(SCRAPED_DIR).filter(f => f.endsWith('.json'));
  console.log(`📁 Found ${files.length} scraped files\n`);
  
  let processed = 0;
  let withMatches = 0;
  let happyHourFound = 0;
  let businessHoursFound = 0;
  let unclear = 0;
  const samples = [];
  
  // Process first 50 files with matches for testing
  for (const filename of files) {
    try {
      const filePath = path.join(SCRAPED_DIR, filename);
      const scrapedData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      
      if (!scrapedData.rawMatches || scrapedData.rawMatches.length === 0) {
        continue;
      }
      
      withMatches++;
      
      if (withMatches > 50) break; // Test on first 50 with matches
      
      const extracted = extractStructuredInfo(scrapedData);
      
      // Save extracted data
      const extractedPath = path.join(EXTRACTED_DIR, filename);
      fs.writeFileSync(extractedPath, JSON.stringify(extracted, null, 2), 'utf8');
      
      processed++;
      
      if (extracted.happyHour.found) {
        happyHourFound++;
      } else if (extracted.businessHours.found) {
        businessHoursFound++;
      } else {
        unclear++;
      }
      
      // Collect samples
      if (samples.length < 10) {
        samples.push({
          venue: extracted.venueName,
          happyHour: extracted.happyHour.found,
          businessHours: extracted.businessHours.found,
          times: extracted.happyHour.times || extracted.businessHours.times,
          reason: extracted.happyHour.reason,
          confidence: extracted.confidence
        });
      }
      
    } catch (error) {
      console.error(`Error processing ${filename}: ${error.message}`);
    }
  }
  
  // Summary
  console.log('📊 Test Results:\n');
  console.log(`   Processed: ${processed} files (with rawMatches)`);
  console.log(`   Happy Hour Found: ${happyHourFound}`);
  console.log(`   Business Hours Found: ${businessHoursFound}`);
  console.log(`   Unclear/No Info: ${unclear}`);
  console.log(`\n   Success Rate: ${((happyHourFound + businessHoursFound) / processed * 100).toFixed(1)}%`);
  
  console.log('\n📋 Sample Extractions:\n');
  samples.forEach((sample, i) => {
    console.log(`${i + 1}. ${sample.venue}`);
    console.log(`   Happy Hour: ${sample.happyHour ? '✅' : '❌'}`);
    console.log(`   Business Hours: ${sample.businessHours ? '✅' : '❌'}`);
    if (sample.times) {
      console.log(`   Times: ${sample.times}`);
    }
    if (sample.reason) {
      console.log(`   Reason: ${sample.reason}`);
    }
    console.log(`   Confidence: ${(sample.confidence * 100).toFixed(0)}%`);
    console.log('');
  });
  
  console.log(`\n💾 Extracted data saved to: ${EXTRACTED_DIR}`);
  console.log(`\n✨ Test complete!`);
}

main();
