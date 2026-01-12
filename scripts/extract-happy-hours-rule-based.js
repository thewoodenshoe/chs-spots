/**
 * Extract Happy Hours - Rule-Based Extraction
 * 
 * This script extracts structured happy hour information from scraped data
 * using rule-based patterns. Only extracts when explicit "happy hour" text is found.
 * 
 * Rules:
 * - Must have explicit "happy hour" text (not just times)
 * - If times but no happy hour text = business hours
 * - High confidence requirement
 * - Saves to data/extracted/ for later LLM processing if needed
 */

const fs = require('fs');
const path = require('path');

// Logging setup
const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logPath = path.join(logDir, 'extract-happy-hours-rule-based.log');

// Overwrite log file on each run
fs.writeFileSync(logPath, '', 'utf8');

function log(message) {
  const ts = new Date().toISOString();
  console.log(message);
  fs.appendFileSync(logPath, `[${ts}] ${message}\n`);
}

// Paths
const SCRAPED_DIR = path.join(__dirname, '../data/scraped');
const EXTRACTED_DIR = path.join(__dirname, '../data/extracted');
const VENUES_PATH = path.join(__dirname, '../data/venues.json');

// Ensure extracted directory exists
if (!fs.existsSync(EXTRACTED_DIR)) {
  fs.mkdirSync(EXTRACTED_DIR, { recursive: true });
}

/**
 * Check if text contains explicit happy hour indicators
 */
function hasExplicitHappyHourText(text) {
  const textLower = text.toLowerCase();
  const happyHourIndicators = [
    'happy hour',
    'happyhour',
    'happier hour',
    'hh ',
    ' hh:',
    'drink specials',
    'bar specials',
    'daily specials',
    'happy hour specials',
    'happy hour menu',
    'happy hour times',
    'happy hour deals'
  ];
  
  return happyHourIndicators.some(indicator => textLower.includes(indicator));
}

/**
 * Extract time patterns from text
 */
function extractTimePatterns(text) {
  const patterns = [];
  
  // Pattern: "4pm-7pm", "4:00pm-7:00pm", "4 PM - 7 PM", "4-7pm", "4 - 7pm"
  // More flexible regex to handle various formats
  const timeRangeRegex = /(\d{1,2}(?::\d{2})?)\s*(am|pm|AM|PM)?\s*[-–—]\s*(\d{1,2}(?::\d{2})?)\s*(am|pm|AM|PM)/gi;
  let match;
  while ((match = timeRangeRegex.exec(text)) !== null) {
    // Normalize the format
    const startTime = match[1] + (match[2] || '');
    const endTime = match[3] + (match[4] || match[2] || ''); // Use start period if end doesn't have one
    patterns.push({
      type: 'time_range',
      value: `${startTime} - ${endTime}`,
      fullMatch: match[0],
      position: match.index,
      startRaw: match[1],
      startPeriod: match[2] || '',
      endRaw: match[3],
      endPeriod: match[4] || match[2] || ''
    });
  }
  
  return patterns;
}

/**
 * Calculate time span in hours
 */
function calculateTimeSpan(timePattern) {
  // Use the raw values from extraction if available
  if (timePattern.startRaw && timePattern.endRaw) {
    let startHour = parseInt(timePattern.startRaw);
    let endHour = parseInt(timePattern.endRaw);
    let startPeriod = (timePattern.startPeriod || '').toLowerCase();
    let endPeriod = (timePattern.endPeriod || '').toLowerCase();
    
    // If start has no period but end does, infer start period
    // If end is PM and start is 1-11, assume start is also PM
    if (!startPeriod && endPeriod) {
      if (endPeriod === 'pm' && startHour >= 1 && startHour <= 11) {
        startPeriod = 'pm';
      } else if (endPeriod === 'am' && startHour >= 1 && startHour <= 11) {
        startPeriod = 'am';
      }
    }
    
    // Convert to 24-hour
    if (startPeriod === 'pm' && startHour < 12) startHour += 12;
    if (endPeriod === 'pm' && endHour < 12) endHour += 12;
    if (startPeriod === 'am' && startHour === 12) startHour = 0;
    if (endPeriod === 'am' && endHour === 12) endHour = 0;
    
    // Handle wrap-around
    if (endHour < startHour) {
      return (24 - startHour) + endHour;
    }
    
    return endHour - startHour;
  }
  
  // Fallback: try to parse from value string
  const match = timePattern.value.match(/(\d{1,2})(?::\d{2})?\s*(am|pm|AM|PM)?\s*[-–—]\s*(\d{1,2})(?::\d{2})?\s*(am|pm|AM|PM)?/i);
  if (!match) {
    return null;
  }
  
  let startHour = parseInt(match[1]);
  let endHour = parseInt(match[3]);
  const startPeriod = (match[2] || '').toLowerCase();
  const endPeriod = (match[4] || '').toLowerCase();
  
  // Convert to 24-hour
  if (startPeriod === 'pm' && startHour < 12) startHour += 12;
  if (endPeriod === 'pm' && endHour < 12) endHour += 12;
  if (startPeriod === 'am' && startHour === 12) startHour = 0;
  if (endPeriod === 'am' && endHour === 12) endHour = 0;
  
  // Handle wrap-around
  if (endHour < startHour) {
    return (24 - startHour) + endHour;
  }
  
  return endHour - startHour;
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
    notes: [],
    needsLLM: false
  };
  
  if (!scrapedData.rawMatches || scrapedData.rawMatches.length === 0) {
    result.happyHour.reason = 'No happy hour mentions found in scraped content';
    result.needsLLM = true; // Could be in sources but not rawMatches
    return result;
  }
  
  // Combine all raw matches
  const allText = scrapedData.rawMatches.map(m => m.text).join(' ');
  const sources = [...new Set(scrapedData.rawMatches.map(m => m.source))];
  const textLower = allText.toLowerCase();
  
  // Check for explicit happy hour text
  const hasHappyHourText = hasExplicitHappyHourText(allText);
  
  // Extract time patterns
  const timePatterns = extractTimePatterns(allText);
  const dayPatterns = extractDayPatterns(allText);
  const specials = extractSpecials(allText);
  
  // Filter time patterns by span (happy hour is typically 1-5 hours)
  const happyHourTimePatterns = [];
  const businessHoursTimePatterns = [];
  
  timePatterns.forEach(t => {
    const span = calculateTimeSpan(t);
    if (span !== null) {
      if (span >= 1 && span <= 5) {
        happyHourTimePatterns.push(t);
      } else if (span >= 6) {
        businessHoursTimePatterns.push(t);
      }
    }
  });
  
  // Check if business hours text exists
  const hasBusinessHoursText = textLower.includes('business hours') || 
                                textLower.includes('hours of operation') ||
                                textLower.includes('open') && textLower.includes('closed');
  
  // Rule 1: If both happy hour and business hours text exist, check time spans
  if (hasHappyHourText && hasBusinessHoursText && timePatterns.length > 0) {
    // Check if times are long spans (6+ hours) = business hours
    const longSpanTimes = timePatterns.filter(t => {
      const span = calculateTimeSpan(t);
      return span !== null && span >= 6;
    });
    
    if (longSpanTimes.length > 0) {
      // Times are business hours (6+ hours)
      result.businessHours.found = true;
      result.businessHours.times = longSpanTimes.map(t => t.value).join(', ');
      result.businessHours.source = sources[0];
      result.happyHour.reason = 'Happy hour mentioned but only business hours times found (6+ hour spans)';
      result.confidence = 0.9;
      result.notes.push('Both happy hour and business hours text found, but times are business hours');
      return result;
    }
    
    // Check if times are short spans (1-5 hours) = happy hour
    if (happyHourTimePatterns.length > 0) {
      result.happyHour.found = true;
      result.happyHour.times = happyHourTimePatterns.map(t => t.value).join(', ');
      if (dayPatterns.length > 0) {
        result.happyHour.days = dayPatterns.map(d => d.value).join(', ');
      }
      if (specials.length > 0) {
        result.happyHour.specials = specials.map(s => s.value);
      }
      result.happyHour.content = scrapedData.rawMatches[0].text.substring(0, 200);
      result.happyHour.source = scrapedData.rawMatches[0].source;
      result.confidence = 0.9;
      result.notes.push('Both texts found, but times are happy hour (1-5 hour spans)');
      return result;
    }
  }
  
  // Rule 2: If explicit happy hour text AND valid time patterns -> Happy Hour
  if (hasHappyHourText && happyHourTimePatterns.length > 0) {
    result.happyHour.found = true;
    result.happyHour.times = happyHourTimePatterns.map(t => t.value).join(', ');
    if (dayPatterns.length > 0) {
      result.happyHour.days = dayPatterns.map(d => d.value).join(', ');
    }
    if (specials.length > 0) {
      result.happyHour.specials = specials.map(s => s.value);
    }
    result.happyHour.content = scrapedData.rawMatches[0].text.substring(0, 200);
    result.happyHour.source = scrapedData.rawMatches[0].source;
    result.confidence = 0.95; // High confidence - explicit text + valid times
    result.notes.push('Explicit happy hour text found with valid time patterns');
    return result;
  }
  
  // Rule 3: If explicit happy hour text but only long time spans -> Business Hours
  if (hasHappyHourText && businessHoursTimePatterns.length > 0 && happyHourTimePatterns.length === 0) {
    result.businessHours.found = true;
    result.businessHours.times = businessHoursTimePatterns.map(t => t.value).join(', ');
    result.businessHours.source = sources[0];
    result.happyHour.reason = 'Happy hour mentioned but only business hours times found (6+ hour spans)';
    result.confidence = 0.9;
    result.notes.push('Happy hour text but times are business hours');
    return result;
  }
  
  // Rule 4: If explicit happy hour text but no valid times -> Low confidence, needs review
  if (hasHappyHourText && timePatterns.length === 0) {
    result.happyHour.found = false;
    result.happyHour.reason = 'Happy hour text found but no valid time patterns extracted';
    result.confidence = 0.3;
    result.needsLLM = true;
    result.notes.push('Happy hour mentioned but times unclear - may need LLM');
    return result;
  }
  
  // Rule 5: If times but NO explicit happy hour text -> Business Hours
  if (!hasHappyHourText && timePatterns.length > 0) {
    result.businessHours.found = true;
    result.businessHours.times = timePatterns.map(t => t.value).join(', ') || 
                                 dayPatterns.map(d => d.value).join(', ');
    result.businessHours.source = sources[0];
    result.happyHour.reason = 'Times found but no explicit happy hour text - classified as business hours';
    result.confidence = 0.85;
    result.notes.push('Times without happy hour text = business hours');
    return result;
  }
  
  // Rule 5: No happy hour text and no times -> No info
  result.happyHour.reason = 'No happy hour text and no time patterns found';
  result.confidence = 0.1;
  result.needsLLM = true;
  result.notes.push('No clear indicators - may need LLM to check sources');
  return result;
}

/**
 * Main function
 */
async function main() {
  log('🍹 Starting Rule-Based Happy Hour Extraction\n');
  log('   Rules:');
  log('   - Must have explicit "happy hour" text');
  log('   - Times without happy hour text = business hours');
  log('   - High confidence requirement (≥0.8)\n');
  
  // Load venues for metadata
  let venues = [];
  try {
    const venuesContent = fs.readFileSync(VENUES_PATH, 'utf8');
    venues = JSON.parse(venuesContent);
    log(`📖 Loaded ${venues.length} venues for metadata lookup\n`);
  } catch (error) {
    log(`⚠️  Warning: Could not load venues.json: ${error.message}\n`);
  }
  
  // Create venue lookup map
  const venuesMap = new Map();
  venues.forEach(v => {
    if (v.id) {
      venuesMap.set(v.id, v);
    }
  });
  
  // Find all scraped files
  const scrapedFiles = fs.readdirSync(SCRAPED_DIR).filter(f => f.endsWith('.json'));
  log(`📁 Found ${scrapedFiles.length} scraped file(s)\n`);
  
  if (scrapedFiles.length === 0) {
    log(`❌ No scraped files found. Run update-happy-hours.js first.`);
    process.exit(1);
  }
  
  // Check for changed venues list (delta system)
  const today = new Date().toISOString().split('T')[0];
  const changedVenuesPath = path.join(EXTRACTED_DIR, `changed-venues-${today}.json`);
  let changedVenueIds = null;
  
  if (fs.existsSync(changedVenuesPath)) {
    try {
      const changedVenuesData = JSON.parse(fs.readFileSync(changedVenuesPath, 'utf8'));
      changedVenueIds = new Set(changedVenuesData.venueIds || []);
      log(`🔄 Delta System: Found ${changedVenueIds.size} changed/new venue(s) to process`);
      log(`   📄 Changed venues list: ${path.resolve(changedVenuesPath)}\n`);
    } catch (error) {
      log(`⚠️  Could not load changed venues list: ${error.message}`);
      log(`   Processing all venues (backward compatible mode)\n`);
    }
  } else {
    log(`ℹ️  No changed venues list found. Processing all venues (backward compatible mode)\n`);
  }
  
  // Filter scraped files to only process changed venues (if delta system is active)
  const filesToProcess = changedVenueIds 
    ? scrapedFiles.filter(filename => {
        const venueId = filename.replace('.json', '');
        return changedVenueIds.has(venueId);
      })
    : scrapedFiles;
  
  if (filesToProcess.length === 0) {
    log(`✅ No changed venues to process. All venues are up to date!`);
    process.exit(0);
  }
  
  log(`📊 Processing ${filesToProcess.length} venue(s) (${changedVenueIds ? 'delta mode' : 'full mode'})\n`);
  
  let processed = 0;
  let happyHourFound = 0;
  let businessHoursFound = 0;
  let needsLLM = 0;
  let noInfo = 0;
  let highConfidence = 0;
  let skipped = 0;
  
  for (const filename of filesToProcess) {
    const filePath = path.join(SCRAPED_DIR, filename);
    const venueId = filename.replace('.json', '');
    
    // Skip if not in changed list (when delta system is active)
    if (changedVenueIds && !changedVenueIds.has(venueId)) {
      skipped++;
      continue;
    }
    
    try {
      const scrapedContent = fs.readFileSync(filePath, 'utf8');
      const scrapedData = JSON.parse(scrapedContent);
      
      // Get venue metadata
      const venue = venuesMap.get(venueId) || {
        id: venueId,
        name: scrapedData.venueName || 'Unknown',
        lat: null,
        lng: null
      };
      
      if (processed % 100 === 0 && processed > 0) {
        log(`\n[${processed}/${filesToProcess.length}] Processing: ${venue.name}...`);
      }
      
      const extracted = extractStructuredInfo(scrapedData);
      
      // Save extracted data
      const extractedPath = path.join(EXTRACTED_DIR, filename);
      fs.writeFileSync(extractedPath, JSON.stringify(extracted, null, 2), 'utf8');
      
      processed++;
      
      if (extracted.happyHour.found) {
        happyHourFound++;
        if (extracted.confidence >= 0.8) highConfidence++;
      } else if (extracted.businessHours.found) {
        businessHoursFound++;
      } else if (extracted.needsLLM) {
        needsLLM++;
      } else {
        noInfo++;
      }
      
    } catch (error) {
      log(`  ❌ Error processing ${filename}: ${error.message}`);
    }
  }
  
  // Summary
  log(`\n\n📊 Summary:`);
  log(`   ✅ Processed: ${processed} venue(s)`);
  if (skipped > 0) {
    log(`   ⏭️  Skipped (unchanged): ${skipped} venue(s)`);
  }
  if (processed > 0) {
    log(`   🍹 Happy Hour Found: ${happyHourFound} (${(happyHourFound/processed*100).toFixed(1)}%)`);
    log(`   📅 Business Hours Found: ${businessHoursFound} (${(businessHoursFound/processed*100).toFixed(1)}%)`);
    log(`   🤖 Needs LLM: ${needsLLM} (${(needsLLM/processed*100).toFixed(1)}%)`);
    log(`   ⬜ No Info: ${noInfo} (${(noInfo/processed*100).toFixed(1)}%)`);
    if (happyHourFound > 0) {
      log(`   ⭐ High Confidence (≥0.8): ${highConfidence} (${(highConfidence/happyHourFound*100).toFixed(1)}% of happy hours)`);
    }
  }
  log(`\n   📁 Extracted data saved to: ${path.resolve(EXTRACTED_DIR)}`);
  log(`\n✨ Done!`);
  if (changedVenueIds) {
    log(`   💡 Delta System: Only processed changed/new venues (${processed} of ${scrapedFiles.length} total)`);
  }
  log(`   Next: Review needsLLM cases and apply LLM if needed`);
}

// Run main function
main().catch(error => {
  log(`❌ Fatal error: ${error.message || error}`);
  process.exit(1);
});
