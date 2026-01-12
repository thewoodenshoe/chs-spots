/**
 * Prepare bulk happy hour data for manual Grok UI processing
 * 
 * This script formats venues with "happy hour" patterns into a format
 * that's easy to copy-paste into Grok UI for manual extraction.
 * 
 * Output: A text file with all venue data formatted for Grok prompt
 */

const fs = require('fs');
const path = require('path');

// Paths
const SCRAPED_DIR = path.join(__dirname, '../data/scraped');
const EXTRACTED_DIR = path.join(__dirname, '../data/extracted');
const PATTERN_MATCHES_PATH = path.join(EXTRACTED_DIR, 'happy-hour-pattern-matches.json');

// Happy hour pattern variations (same as scan script)
const HAPPY_HOUR_PATTERNS = [
  /happy\s+hour/gi,
  /happyhour/gi,
  /happy\s+hours/gi,
  /happyhours/gi,
  /happier\s+hour/gi,
  /happierhour/gi,
  /hh\s*:/gi,
  /happy\s+hour\s*:/gi,
  /happy\s+hour\s*menu/gi,
  /happy\s+hour\s*specials/gi
];

function hasHappyHourPattern(text) {
  if (!text || typeof text !== 'string') return false;
  for (const pattern of HAPPY_HOUR_PATTERNS) {
    if (pattern.test(text)) return true;
  }
  return false;
}

function extractRelevantText(scrapedData) {
  // Combine all sources
  const allText = (scrapedData.sources || [])
    .map(s => (s.text || '').trim())
    .join('\n\n---\n\n')
    .trim();
  
  // Check if this is a menu page (likely to have structured happy hour content)
  const isMenuPage = scrapedData.sources.some(s => 
    s.url && (s.url.toLowerCase().includes('/menu') || s.pageType === 'subpage')
  );
  
  // If it's a menu page and has happy hour pattern, extract larger context
  if (isMenuPage && hasHappyHourPattern(allText)) {
    // Find all "happy hour" mentions
    const hhMatches = [];
    const textLower = allText.toLowerCase();
    let searchIndex = 0;
    
    while (true) {
      const match = textLower.indexOf('happy hour', searchIndex);
      if (match === -1) break;
      hhMatches.push(match);
      searchIndex = match + 1;
    }
    
    // Also look for time/day patterns that might be near happy hour content
    const timePatterns = [
      /monday\s*-\s*friday/gi,
      /mon\s*-\s*fri/gi,
      /\d{1,2}\s*[-–—]\s*\d{1,2}\s*(pm|am)/gi,
      /\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2}/gi
    ];
    
    const timeMatches = [];
    timePatterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(allText)) !== null) {
        timeMatches.push(match.index);
      }
    });
    
    // Combine all match positions
    const allMatches = [...hhMatches, ...timeMatches].sort((a, b) => a - b);
    
    if (allMatches.length > 0) {
      // Extract from first match to last match, with padding
      const firstMatch = allMatches[0];
      const lastMatch = allMatches[allMatches.length - 1];
      const padding = 2000; // Larger context window
      
      const start = Math.max(0, firstMatch - padding);
      const end = Math.min(allText.length, lastMatch + 5000); // Extended after last match
      
      return allText.substring(start, end);
    }
  }
  
  // Fallback: Find sections with happy hour mentions (original logic)
  const lines = allText.split('\n');
  const relevantLines = [];
  const contextWindow = 50; // Increased from 10 to 50
  
  for (let i = 0; i < lines.length; i++) {
    if (hasHappyHourPattern(lines[i])) {
      // Include context around the match
      const start = Math.max(0, i - contextWindow);
      const end = Math.min(lines.length, i + contextWindow);
      relevantLines.push(...lines.slice(start, end));
      relevantLines.push('---'); // Separator
    }
  }
  
  // If we found specific sections, return those; otherwise return first 15000 chars
  if (relevantLines.length > 0) {
    return relevantLines.join('\n').substring(0, 15000);
  }
  
  return allText.substring(0, 15000);
}

function main() {
  console.log('📋 Preparing bulk data for Grok UI...\n');
  
  // Load pattern matches
  if (!fs.existsSync(PATTERN_MATCHES_PATH)) {
    console.error('❌ Pattern matches file not found. Run scan-happy-hour-patterns.js first.');
    process.exit(1);
  }
  
  const matchesData = JSON.parse(fs.readFileSync(PATTERN_MATCHES_PATH, 'utf8'));
  const matches = matchesData.matches || [];
  
  console.log(`📊 Found ${matches.length} venues with "happy hour" patterns\n`);
  
  // Prepare data for each venue
  const venuesData = [];
  
  for (const match of matches) {
    const scrapedPath = path.join(SCRAPED_DIR, `${match.venueId}.json`);
    
    if (!fs.existsSync(scrapedPath)) {
      console.warn(`⚠️  Scraped file not found: ${match.venueId}`);
      continue;
    }
    
    const scrapedData = JSON.parse(fs.readFileSync(scrapedPath, 'utf8'));
    const relevantText = extractRelevantText(scrapedData);
    
    venuesData.push({
      venueId: match.venueId,
      venueName: match.venueName,
      venueArea: match.venueArea,
      website: match.website,
      text: relevantText
    });
  }
  
  // Split into two files (roughly equal)
  const midPoint = Math.ceil(venuesData.length / 2);
  const firstHalf = venuesData.slice(0, midPoint);
  const secondHalf = venuesData.slice(midPoint);
  
  // Format and save first half
  const grokPrompt1 = formatGrokPrompt(firstHalf, 1, 2);
  const outputPath1 = path.join(EXTRACTED_DIR, 'bulk-grok-prompt-part1.txt');
  fs.writeFileSync(outputPath1, grokPrompt1, 'utf8');
  
  // Format and save second half
  const grokPrompt2 = formatGrokPrompt(secondHalf, 2, 2);
  const outputPath2 = path.join(EXTRACTED_DIR, 'bulk-grok-prompt-part2.txt');
  fs.writeFileSync(outputPath2, grokPrompt2, 'utf8');
  
  // Also save as JSON for reference
  const jsonPath = path.join(EXTRACTED_DIR, 'bulk-venues-data.json');
  fs.writeFileSync(jsonPath, JSON.stringify(venuesData, null, 2), 'utf8');
  
  console.log(`✅ Prepared ${venuesData.length} venues for Grok UI`);
  console.log(`📄 Part 1: ${firstHalf.length} venues - ${path.resolve(outputPath1)}`);
  console.log(`📄 Part 2: ${secondHalf.length} venues - ${path.resolve(outputPath2)}`);
  console.log(`📄 Data file: ${path.resolve(jsonPath)}`);
  console.log(`\n💡 Instructions:`);
  console.log(`   1. Open bulk-grok-prompt-part1.txt`);
  console.log(`   2. Copy the entire content`);
  console.log(`   3. Paste into Grok UI`);
  console.log(`   4. Ask: "Extract happy hour information from each venue and return as JSON array"`);
  console.log(`   5. Save the JSON response as part1-results.json`);
  console.log(`   6. Repeat steps 1-5 for bulk-grok-prompt-part2.txt`);
  console.log(`   7. Combine both JSON files into one final result`);
}

function formatGrokPrompt(venuesData, partNumber, totalParts) {
  let prompt = `Extract happy hour information from the following ${venuesData.length} restaurant/bar venues.\n\n`;
  prompt += `(This is PART ${partNumber} of ${totalParts} - process all venues in this part)\n\n`;
  prompt += `For each venue, extract:\n`;
  prompt += `- Days (e.g., "Monday-Friday", "Daily", "Weekdays")\n`;
  prompt += `- Times (e.g., "4pm-7pm", "5:00 PM - 7:00 PM")\n`;
  prompt += `- Specials/Deals (e.g., "$5 beers", "Half-price appetizers")\n`;
  prompt += `- Source URL where the info was found\n\n`;
  prompt += `Return as a JSON array with this structure:\n`;
  prompt += `[\n`;
  prompt += `  {\n`;
  prompt += `    "venueId": "...",\n`;
  prompt += `    "venueName": "...",\n`;
  prompt += `    "happyHour": {\n`;
  prompt += `      "found": true/false,\n`;
  prompt += `      "days": "Monday-Friday",\n`;
  prompt += `      "times": "4pm-7pm",\n`;
  prompt += `      "specials": ["$5 beers", "Half-price apps"],\n`;
  prompt += `      "source": "http://..."\n`;
  prompt += `    }\n`;
  prompt += `  },\n`;
  prompt += `  ...\n`;
  prompt += `]\n\n`;
  prompt += `If a venue has no happy hour information, set "found": false.\n\n`;
  prompt += `=== VENUE DATA ===\n\n`;
  
  // Add each venue
  venuesData.forEach((venue, index) => {
    prompt += `\n--- VENUE ${index + 1} of ${venuesData.length} (Part ${partNumber}) ---\n`;
    prompt += `ID: ${venue.venueId}\n`;
    prompt += `Name: ${venue.venueName}\n`;
    prompt += `Area: ${venue.venueArea}\n`;
    prompt += `Website: ${venue.website}\n`;
    prompt += `\nScraped Content:\n${venue.text}\n`;
    prompt += `\n---\n\n`;
  });
  
  return prompt;
}

main();
