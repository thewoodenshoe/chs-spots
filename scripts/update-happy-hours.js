const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { URL } = require('url');

// Use built-in fetch (Node 18+) - redirect: 'follow' is the default behavior
// Ensure fetch is available (Node 18+ has it globally)
const fetch = globalThis.fetch || global.fetch;
if (typeof fetch !== 'function') {
  throw new Error('fetch is not available. Please use Node.js 18+ which includes built-in fetch.');
}

// Configuration
const RATE_LIMIT_DELAY = 2000; // 2 seconds between sites
const MAX_SUBPAGES = 10; // Maximum subpages to fetch per site
const KEYWORDS = ['menu', 'menus', 'happy-hour', 'happyhour', 'specials', 'bar', 'drinks'];
const ALCOHOL_TYPES = ['bar', 'alcohol', 'liquor', 'night_club', 'cafe', 'restaurant'];

// Known chain location patterns (domain → path mapping)
const KNOWN_CHAIN_PATTERNS = {
  'agavescantina': '/daniel-island'
};

// Charleston area names to match in location selectors
const CHARLESTON_AREAS = [
  'daniel island',
  'mount pleasant',
  'james island',
  'downtown charleston',
  'sullivan\'s island',
  'sullivans island'
];

// Paths
const VENUES_PATH = path.join(__dirname, '../data/venues.json');
const SPOTS_PATH = path.join(__dirname, '../data/spots.json');

/**
 * Check if venue is alcohol-related
 */
function isAlcoholVenue(venue) {
  if (!venue.types || !Array.isArray(venue.types)) {
    return false;
  }
  return venue.types.some(type => 
    ALCOHOL_TYPES.some(alcoholType => 
      type.toLowerCase().includes(alcoholType.toLowerCase())
    )
  );
}

/**
 * Check if URL is internal/relative
 */
function isInternalUrl(url, baseUrl) {
  try {
    if (!url) return false;
    
    // Relative URLs are internal
    if (url.startsWith('/') || url.startsWith('./') || url.startsWith('../')) {
      return true;
    }
    
    // Check if same domain
    const base = new URL(baseUrl);
    const target = new URL(url, baseUrl);
    return target.hostname === base.hostname;
  } catch (e) {
    return false;
  }
}

/**
 * Resolve relative URL to absolute
 */
function resolveUrl(url, baseUrl) {
  try {
    return new URL(url, baseUrl).href;
  } catch (e) {
    return null;
  }
}

/**
 * Extract text content from HTML
 */
function extractText(html) {
  const $ = cheerio.load(html);
  // Remove script and style tags
  $('script, style, noscript').remove();
  return $('body').text() || '';
}

/**
 * Find internal links matching keywords
 */
function findRelevantLinks(html, baseUrl) {
  const $ = cheerio.load(html);
  const links = [];
  const seen = new Set();
  
  $('a[href]').each((i, elem) => {
    const href = $(elem).attr('href');
    if (!href) return;
    
    const hrefLower = href.toLowerCase();
    const linkText = $(elem).text().toLowerCase();
    
    // Check if link contains keywords
    const matchesKeyword = KEYWORDS.some(keyword => 
      hrefLower.includes(keyword) || linkText.includes(keyword)
    );
    
    if (matchesKeyword && isInternalUrl(href, baseUrl)) {
      const resolvedUrl = resolveUrl(href, baseUrl);
      if (resolvedUrl && !seen.has(resolvedUrl)) {
        seen.add(resolvedUrl);
        links.push(resolvedUrl);
      }
    }
  });
  
  return links.slice(0, MAX_SUBPAGES);
}

/**
 * Fetch URL with error handling and redirect following
 */
async function fetchUrl(url, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      // Use AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        redirect: 'follow', // Explicitly follow redirects
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      return await response.text();
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      if (i === retries) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
}

/**
 * Detect location selector and extract local page link
 */
function findLocalPageLink(html, baseUrl) {
  const $ = cheerio.load(html);
  const bodyText = $('body').text().toLowerCase();
  
  // Check for location selector indicators in text
  const locationIndicators = [
    'location',
    'choose location',
    'select your',
    'select a location'
  ];
  
  const hasLocationSelector = locationIndicators.some(indicator => 
    bodyText.includes(indicator)
  );
  
  if (!hasLocationSelector) {
    return null;
  }
  
  // Try known chain patterns first
  try {
    const baseUrlObj = new URL(baseUrl);
    const domain = baseUrlObj.hostname.toLowerCase();
    
    for (const [pattern, path] of Object.entries(KNOWN_CHAIN_PATTERNS)) {
      if (domain.includes(pattern)) {
        const localUrl = new URL(path, baseUrl).href;
        return localUrl;
      }
    }
  } catch (e) {
    // Continue to link search
  }
  
  // Search for links containing Charleston area names
  let bestMatch = null;
  let bestMatchScore = 0;
  
  $('a[href]').each((i, elem) => {
    const href = $(elem).attr('href');
    const linkText = $(elem).text().toLowerCase();
    const linkLower = href.toLowerCase();
    
    if (!href) return;
    
    // Check if link is internal
    if (!isInternalUrl(href, baseUrl)) return;
    
    // Score matches (exact area name match gets higher score)
    CHARLESTON_AREAS.forEach((area, index) => {
      const areaLower = area.toLowerCase();
      const areaSlug = areaLower.replace(/\s+/g, '-').replace(/'/g, '');
      
      // Exact area match in link text (highest priority)
      if (linkText.includes(areaLower)) {
        const score = 100 + index;
        if (score > bestMatchScore) {
          bestMatch = resolveUrl(href, baseUrl);
          bestMatchScore = score;
        }
      }
      // Area slug in URL
      else if (linkLower.includes(areaSlug) || linkLower.includes(areaLower.replace(/\s+/g, ''))) {
        const score = 50 + index;
        if (score > bestMatchScore) {
          bestMatch = resolveUrl(href, baseUrl);
          bestMatchScore = score;
        }
      }
    });
  });
  
  return bestMatch;
}

/**
 * Extract happy hour information from text
 */
function extractHappyHourInfo(text, sourceUrl) {
  const matches = [];
  const textLower = text.toLowerCase();
  
  // Patterns to match happy hour information
  const patterns = [
    // "Happy Hour [time] to [time]"
    /happy\s+hour[:\s]+([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)\s*(?:to|-|until)\s*([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)/gi,
    // "Happy Hour [days] [time]"
    /happy\s+hour[:\s]+(?:mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)[\s\w,]*?([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)\s*(?:to|-|until)\s*([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)/gi,
    // "Specials from [time] to [time]"
    /specials?\s+(?:from|from\s+)?([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)\s*(?:to|-|until)\s*([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)/gi,
    // "Daily [time] to [time]"
    /daily[:\s]+([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)\s*(?:to|-|until)\s*([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)/gi,
    // Simple "Happy Hour" mentions with nearby context
    /happy\s+hour[^.]{0,200}/gi
  ];
  
  // Extract context around matches
  const happyHourIndex = textLower.indexOf('happy hour');
  if (happyHourIndex !== -1) {
    const start = Math.max(0, happyHourIndex - 100);
    const end = Math.min(text.length, happyHourIndex + 300);
    const context = text.substring(start, end).trim();
    
    // Try to extract time information from context
    const timePattern = /([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)\s*(?:to|-|until|–)\s*([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)/gi;
    const timeMatch = timePattern.exec(context);
    
    if (timeMatch) {
      matches.push({
        text: context.replace(/\s+/g, ' ').trim(),
        time: `${timeMatch[1]} - ${timeMatch[2]}`,
        source: sourceUrl
      });
    } else {
      // Just the context if no time found
      matches.push({
        text: context.replace(/\s+/g, ' ').trim(),
        time: null,
        source: sourceUrl
      });
    }
  }
  
  // Apply regex patterns
  patterns.forEach(pattern => {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (match[1] && match[2]) {
        matches.push({
          text: match[0].replace(/\s+/g, ' ').trim(),
          time: `${match[1]} - ${match[2]}`,
          source: sourceUrl
        });
      } else if (match[0]) {
        matches.push({
          text: match[0].replace(/\s+/g, ' ').trim(),
          time: null,
          source: sourceUrl
        });
      }
    }
  });
  
  return matches;
}

/**
 * Process a single venue
 */
async function processVenue(venue) {
  if (!venue.website) {
    return { venue: venue.name, matches: 0, subpages: 0, skipped: 'no website' };
  }
  
  if (!isAlcoholVenue(venue)) {
    return { venue: venue.name, matches: 0, subpages: 0, skipped: 'not alcohol venue' };
  }
  
  try {
    // Fetch homepage (following redirects)
    const homepageHtml = await fetchUrl(venue.website);
    
    // Check for location selector and get local page
    const localPageUrl = findLocalPageLink(homepageHtml, venue.website);
    let contentHtml = homepageHtml;
    let contentUrl = venue.website;
    let localPageUsed = false;
    
    if (localPageUrl) {
      try {
        contentHtml = await fetchUrl(localPageUrl);
        contentUrl = localPageUrl;
        localPageUsed = true;
        console.log(`  Used local page for ${venue.name}`);
      } catch (error) {
        console.error(`  Failed to fetch local page ${localPageUrl}: ${error.message}`);
        // Fall back to homepage (contentHtml/contentUrl already set to homepage)
      }
    }
    
    if (!localPageUsed) {
      console.log(`  No local page found for ${venue.name}`);
    }
    
    const contentText = extractText(contentHtml);
    
    // Find relevant subpages from the content page (local page or homepage)
    const subpageUrls = findRelevantLinks(contentHtml, contentUrl);
    
    // Fetch subpages
    const subpageTexts = [];
    for (const subpageUrl of subpageUrls) {
      try {
        const subpageHtml = await fetchUrl(subpageUrl);
        const subpageText = extractText(subpageHtml);
        subpageTexts.push({ text: subpageText, url: subpageUrl });
      } catch (error) {
        console.error(`  Failed to fetch subpage ${subpageUrl}: ${error.message}`);
      }
    }
    
    // Combine all text
    const allText = [contentText, ...subpageTexts.map(s => s.text)].join('\n\n');
    
    // Extract happy hour info from content page (local page or homepage)
    const contentMatches = extractHappyHourInfo(contentText, contentUrl);
    
    // Extract happy hour info from subpages
    const subpageMatches = [];
    subpageTexts.forEach(({ text, url }) => {
      const matches = extractHappyHourInfo(text, url);
      subpageMatches.push(...matches);
    });
    
    const allMatches = [...contentMatches, ...subpageMatches];
    
    // Deduplicate matches (same source URL)
    const uniqueMatches = [];
    const seenSources = new Set();
    allMatches.forEach(match => {
      if (!seenSources.has(match.source)) {
        seenSources.add(match.source);
        uniqueMatches.push(match);
      }
    });
    
    return {
      venue: venue.name,
      matches: uniqueMatches,
      subpages: subpageUrls.length,
      success: true
    };
  } catch (error) {
    console.error(`  Error processing ${venue.name}: ${error.message}`);
    return { venue: venue.name, matches: 0, subpages: 0, error: error.message };
  }
}

/**
 * Format description from matches
 */
function formatDescription(matches) {
  if (!matches || matches.length === 0) {
    return null;
  }
  
  const bullets = matches.map(match => {
    const timeInfo = match.time ? ` (${match.time})` : '';
    return `• ${match.text}${timeInfo} — source: ${match.source}`;
  });
  
  return bullets.join('\n');
}

/**
 * Main function
 */
async function main() {
  console.log('Loading venues...');
  const venues = JSON.parse(fs.readFileSync(VENUES_PATH, 'utf8'));
  console.log(`Loaded ${venues.length} venues`);
  
  // Load existing spots or create empty array
  let spots = [];
  if (fs.existsSync(SPOTS_PATH)) {
    spots = JSON.parse(fs.readFileSync(SPOTS_PATH, 'utf8'));
  }
  
  // Filter venues with websites and alcohol types
  const venuesToProcess = venues.filter(v => v.website && isAlcoholVenue(v));
  console.log(`Processing ${venuesToProcess.length} venues with websites and alcohol types`);
  
  let processed = 0;
  let found = 0;
  
  for (const venue of venuesToProcess) {
    console.log(`\nProcessing: ${venue.name} (${venue.website})`);
    
    const result = await processVenue(venue);
    
    if (result.skipped) {
      console.log(`  Skipped: ${result.skipped}`);
    } else if (result.error) {
      console.log(`  Error: ${result.error}`);
    } else {
      const matchCount = result.matches.length;
      console.log(`  Scanned ${venue.name}: Found ${matchCount} matches from ${result.subpages} subpages`);
      
      if (matchCount > 0) {
        // Find existing spot or create new one
        let spotIndex = spots.findIndex(s => s.title === venue.name);
        
        const description = formatDescription(result.matches);
        
        if (spotIndex === -1) {
          // Create new spot
          spots.push({
            title: venue.name,
            lat: venue.lat,
            lng: venue.lng,
            description: description,
            activity: 'Happy Hour'
          });
          found++;
        } else {
          // Update existing spot - append if description exists
          const existing = spots[spotIndex];
          if (existing.description && existing.description !== description) {
            spots[spotIndex].description = `${existing.description}\n\n${description}`;
          } else {
            spots[spotIndex].description = description;
          }
          spots[spotIndex].activity = 'Happy Hour';
          // Update lat/lng if not set
          if (!spots[spotIndex].lat) spots[spotIndex].lat = venue.lat;
          if (!spots[spotIndex].lng) spots[spotIndex].lng = venue.lng;
          found++;
        }
      }
    }
    
    processed++;
    
    // Rate limiting
    if (processed < venuesToProcess.length) {
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
    }
  }
  
  // Save spots
  console.log(`\n\nSaving ${spots.length} spots to ${SPOTS_PATH}...`);
  fs.writeFileSync(SPOTS_PATH, JSON.stringify(spots, null, 2), 'utf8');
  
  console.log(`\nDone! Processed ${processed} venues, found happy hour info for ${found} venues`);
}

// Run main function
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

