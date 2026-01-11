const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { URL } = require('url');

// Logging setup
const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logPath = path.join(logDir, 'update-happy-hours.log');

// Overwrite log file on each run
fs.writeFileSync(logPath, '', 'utf8');

/**
 * Logger function: logs to console (with emojis) and file (without emojis, with timestamp)
 */
function log(message) {
  // Log to console (with emojis/colors)
  console.log(message);
  
  // Format timestamp as [YYYY-MM-DD HH:mm:ss]
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const timestamp = `[${year}-${month}-${day} ${hours}:${minutes}:${seconds}]`;
  
  // Strip emojis from message for file logging
  // Emoji ranges: \u{1F300}-\u{1F5FF} (Misc Symbols), \u{1F600}-\u{1F64F} (Emoticons), 
  // \u{1F680}-\u{1F6FF} (Transport), \u{2600}-\u{26FF} (Misc symbols), \u{2700}-\u{27BF} (Dingbats)
  const messageWithoutEmojis = message.replace(/[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim();
  
  // Append to log file
  fs.appendFileSync(logPath, `${timestamp} ${messageWithoutEmojis}\n`, 'utf8');
}

/**
 * Verbose logger: writes detailed information to log file only (not to console)
 * Use for --vvv level detailed logging
 */
function logVerbose(message) {
  // Format timestamp as [YYYY-MM-DD HH:mm:ss]
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const timestamp = `[${year}-${month}-${day} ${hours}:${minutes}:${seconds}]`;
  
  // Strip emojis from message
  const messageWithoutEmojis = message.replace(/[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim();
  
  // Append to log file (verbose details only in file)
  fs.appendFileSync(logPath, `${timestamp} ${messageWithoutEmojis}\n`, 'utf8');
}

// Use built-in fetch (Node 18+) - redirect: 'follow' is the default behavior
const fetch = globalThis.fetch || global.fetch;
if (typeof fetch !== 'function') {
  throw new Error('fetch is not available. Please use Node.js 18+ which includes built-in fetch.');
}

// Configuration
const RATE_LIMIT_DELAY_MIN = 1500; // Minimum delay between requests
const RATE_LIMIT_DELAY_MAX = 2500; // Maximum delay between requests
const MAX_SUBPAGES = 10; // Maximum subpages to fetch per site (increased from 8)
const MAX_LOCAL_LINKS = 3; // Maximum local page links to try

// Keywords for finding relevant subpages (case-insensitive match in href or link text)
const SUBPAGE_KEYWORDS = [
  // Menu-related
  'menu', 'menus', 'food-menu', 'drink-menu',
  // Meal times
  'dinner', 'brunch', 'lunch',
  // Drinks
  'cocktails', 'wine', 'beer', 'drinks',
  // Happy hour variations
  'happy-hour', 'happyhour', 'happier-hour',
  // Specials and deals
  'specials', 'daily-specials', 'deals', 'promotions',
  // Other relevant pages
  'event', 'events', 'bar', 'raw-bar',
  // Additional content types
  'pdf', 'overview', 'club', 'wine-club'
];

// Multi-location detection keywords
const MULTI_LOCATION_KEYWORDS = [
  'locations', 'find a location', 'choose your location', 
  'select your city', 'multiple locations', 'visit our other locations',
  'select location', 'choose location', 'pick a location'
];

const ALCOHOL_TYPES = ['bar', 'alcohol', 'liquor', 'night_club', 'cafe', 'restaurant'];

// Charleston area names to match in location selectors
const CHARLESTON_AREAS = [
  'daniel island',
  'mount pleasant',
  'james island',
  'downtown charleston',
  'sullivan\'s island',
  'sullivans island',
  'charleston'
];

// Paths
const VENUES_PATH = path.join(__dirname, '../data/venues.json');
const SPOTS_PATH = path.join(__dirname, '../data/spots.json');
const SUBMENUS_INVENTORY_PATH = path.join(__dirname, '../data/restaurants-submenus.json');

/**
 * Get random delay between min and max
 */
function getRandomDelay() {
  return Math.floor(Math.random() * (RATE_LIMIT_DELAY_MAX - RATE_LIMIT_DELAY_MIN + 1)) + RATE_LIMIT_DELAY_MIN;
}

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
 * Detect if page is a multi-location/chain site
 */
function detectMultiLocation(html, baseUrl) {
  const $ = cheerio.load(html);
  const bodyText = $('body').text().toLowerCase();
  const htmlText = html.toLowerCase();
  
  // Check for multi-location keywords in text
  const hasLocationKeywords = MULTI_LOCATION_KEYWORDS.some(keyword => 
    bodyText.includes(keyword.toLowerCase()) || htmlText.includes(keyword.toLowerCase())
  );
  
  // Check for location dropdowns or lists
  const hasLocationSelect = $('select, [class*="location"], [id*="location"], [class*="city"], [id*="city"]').length > 0;
  
  // Check for links with location-related text
  let locationLinkCount = 0;
  $('a[href]').each((i, elem) => {
    const linkText = $(elem).text().toLowerCase();
    const href = $(elem).attr('href') || '';
    if (linkText.includes('location') || linkText.includes('city') || 
        href.includes('location') || href.includes('city')) {
      locationLinkCount++;
    }
  });
  
  return hasLocationKeywords || hasLocationSelect || locationLinkCount >= 3;
}

/**
 * Generate area name variations including close matches
 */
function generateAreaVariations(areaName) {
  if (!areaName) return [];
  
  const areaLower = areaName.toLowerCase().trim();
  const variations = new Set();
  
  // Add exact match first (highest priority)
  variations.add(areaLower);
  
  // Standard variations
  variations.add(areaLower.replace(/\s+/g, '-'));
  variations.add(areaLower.replace(/\s+/g, ''));
  variations.add(areaLower.replace(/'/g, ''));
  
  // Close matches for common patterns
  // "north charleston" -> "n charleston", "n. charleston", "nc", "n charleston"
  if (areaLower.includes('north charleston')) {
    variations.add('north charleston');
    variations.add('n charleston');
    variations.add('n. charleston');
    variations.add('nc');
    variations.add('northcharleston');
    variations.add('n-charleston');
  }
  // "mount pleasant" -> "mt pleasant", "mt. pleasant", "mountpleasant"
  if (areaLower.includes('mount pleasant')) {
    variations.add('mount pleasant');
    variations.add('mt pleasant');
    variations.add('mt. pleasant');
    variations.add('mountpleasant');
    variations.add('mt-pleasant');
  }
  // "daniel island" -> "daniel island", "danielisland"
  if (areaLower.includes('daniel island')) {
    variations.add('daniel island');
    variations.add('danielisland');
    variations.add('daniel-island');
  }
  
  return Array.from(variations);
}

/**
 * Find local page links for multi-location sites
 * Prioritizes exact venue.area matches over other areas
 */
function findLocalPageLinks(html, baseUrl, venueArea) {
  const $ = cheerio.load(html);
  const areaLower = (venueArea || '').toLowerCase().trim();
  const links = [];
  
  // Generate variations for the venue's specific area (highest priority)
  const primaryAreaVariations = generateAreaVariations(venueArea);
  
  // Generate variations for other Charleston areas (lower priority)
  const otherAreaVariations = [];
  CHARLESTON_AREAS.forEach(area => {
    if (area.toLowerCase() !== areaLower) {
      otherAreaVariations.push(...generateAreaVariations(area));
    }
  });
  
  $('a[href]').each((i, elem) => {
    const href = $(elem).attr('href');
    const linkText = $(elem).text().toLowerCase();
    if (!href || !isInternalUrl(href, baseUrl)) return;
    
    const hrefLower = href.toLowerCase();
    let score = 0;
    let matchedArea = null;
    let isExactMatch = false;
    
    // First check primary area (venue.area) - highest priority
    primaryAreaVariations.forEach((variation, index) => {
      // Exact match in link text (highest score)
      if (linkText.includes(variation)) {
        const newScore = 1000 - index; // Much higher score for primary area
        const isExact = linkText === variation || 
                       linkText.includes(' ' + variation + ' ') || 
                       linkText.startsWith(variation + ' ') || 
                       linkText.endsWith(' ' + variation) ||
                       linkText.startsWith(variation + '-') ||
                       linkText.endsWith('-' + variation);
        if (newScore > score) {
          score = newScore;
          matchedArea = venueArea;
          isExactMatch = isExact || isExactMatch;
        }
      }
      // Match in URL
      if (hrefLower.includes(variation)) {
        const newScore = 500 - index; // Higher score for primary area URL matches
        if (newScore > score) {
          score = newScore;
          matchedArea = venueArea;
        }
      }
    });
    
    // Then check other Charleston areas (lower priority, but still valid)
    if (score === 0) {
      otherAreaVariations.forEach((variation, index) => {
        if (linkText.includes(variation)) {
          const newScore = 100 - index; // Lower score for other areas
          if (newScore > score) {
            score = newScore;
            matchedArea = variation;
          }
        }
        if (hrefLower.includes(variation)) {
          const newScore = 50 - index;
          if (newScore > score) {
            score = newScore;
            matchedArea = variation;
          }
        }
      });
    }
    
    if (score > 0) {
      const resolvedUrl = resolveUrl(href, baseUrl);
      if (resolvedUrl) {
        links.push({ 
          url: resolvedUrl, 
          score, 
          text: linkText,
          matchedArea: matchedArea || 'unknown',
          isExactMatch
        });
      }
    }
  });
  
  // Sort by score (highest first) and limit
  links.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // If scores are equal, prefer exact matches
    if (a.isExactMatch !== b.isExactMatch) return b.isExactMatch - a.isExactMatch;
    return 0;
  });
  
  return links.slice(0, MAX_LOCAL_LINKS);
}

/**
 * Find internal links matching keywords
 */
function findRelevantSubpageLinks(html, baseUrl) {
  const $ = cheerio.load(html);
  const links = [];
  const seen = new Set();
  
  $('a[href]').each((i, elem) => {
    const href = $(elem).attr('href');
    if (!href) return;
    
    const hrefLower = href.toLowerCase();
    const linkText = $(elem).text().toLowerCase();
    
    // Check if link contains keywords
    const matchesKeyword = SUBPAGE_KEYWORDS.some(keyword => 
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
  
  // Return up to MAX_SUBPAGES most relevant links
  return links.slice(0, MAX_SUBPAGES);
}

/**
 * Fetch URL with error handling and redirect following
 */
async function fetchUrl(url, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        redirect: 'follow',
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
 * Google search fallback for finding local pages
 * Uses Google Custom Search API (requires GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_ENGINE_ID)
 * Falls back gracefully if API keys are not available
 */
async function googleSearchFallback(venueName, venueArea) {
  const GOOGLE_SEARCH_API_KEY = process.env.GOOGLE_SEARCH_API_KEY;
  const GOOGLE_SEARCH_ENGINE_ID = process.env.GOOGLE_SEARCH_ENGINE_ID;
  
  if (!GOOGLE_SEARCH_API_KEY || !GOOGLE_SEARCH_ENGINE_ID) {
    // API keys not configured - skip search
    return null;
  }
  
  try {
    const query = `${venueName} ${venueArea} happy hour site`;
    const encodedQuery = encodeURIComponent(query);
    const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_SEARCH_API_KEY}&cx=${GOOGLE_SEARCH_ENGINE_ID}&q=${encodedQuery}&num=3`;
    
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json();
    
    if (data.items && data.items.length > 0) {
      // Filter results to menu/specials/happy hour pages
      for (const item of data.items) {
        const link = item.link;
        const title = (item.title || '').toLowerCase();
        const snippet = (item.snippet || '').toLowerCase();
        const linkLower = link.toLowerCase();
        
        // Check if result looks like a menu/specials page
        const isMenuPage = linkLower.includes('menu') || 
                          linkLower.includes('specials') || 
                          linkLower.includes('happy-hour') ||
                          linkLower.includes('happyhour') ||
                          title.includes('menu') ||
                          title.includes('specials') ||
                          title.includes('happy hour') ||
                          snippet.includes('happy hour') ||
                          snippet.includes('menu') ||
                          snippet.includes('specials');
        
        if (isMenuPage) {
          log(`  🔍 Google search fallback found potential page: ${link}`);
          return link;
        }
      }
      
      // If no menu page found, return first result anyway
      log(`  🔍 Google search fallback found page (not menu-specific): ${data.items[0].link}`);
      return data.items[0].link;
    }
    
    return null;
  } catch (error) {
    log(`  ⚠️  Google search fallback failed: ${error.message}`);
    return null;
  }
}

/**
 * Extract happy hour information from text
 */
function extractHappyHourInfo(text, sourceUrl) {
  const snippets = [];
  const textLower = text.toLowerCase();
  
  // Find all "happy hour" mentions
  const happyHourRegex = /happy\s+hour[^.]{0,200}/gi;
  let match;
  const seenSnippets = new Set();
  
  while ((match = happyHourRegex.exec(text)) !== null) {
    const snippet = match[0].trim().replace(/\s+/g, ' ');
    if (snippet.length > 10 && !seenSnippets.has(snippet.toLowerCase())) {
      seenSnippets.add(snippet.toLowerCase());
      snippets.push({
        text: snippet,
        source: sourceUrl
      });
    }
  }
  
  // Also look for time patterns that might indicate happy hour
  const timePatterns = [
    /([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)\s*(?:to|-|until|–)\s*([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)/gi,
    /(?:mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)[\s\w,]*?([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)\s*(?:to|-|until|–)\s*([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)/gi
  ];
  
  // If we found time patterns near "happy hour" context, add them
  const happyHourIndex = textLower.indexOf('happy hour');
  if (happyHourIndex !== -1) {
    const contextStart = Math.max(0, happyHourIndex - 50);
    const contextEnd = Math.min(text.length, happyHourIndex + 250);
    const context = text.substring(contextStart, contextEnd);
    
    timePatterns.forEach(pattern => {
      const timeMatch = pattern.exec(context);
      if (timeMatch) {
        const snippet = context.trim().replace(/\s+/g, ' ');
        if (!seenSnippets.has(snippet.toLowerCase())) {
          seenSnippets.add(snippet.toLowerCase());
          snippets.push({
            text: snippet,
            source: sourceUrl
          });
        }
      }
    });
  }
  
  return snippets;
}

/**
 * Process a single venue
 */
async function processVenue(venue, submenusInventory) {
  // Verbose: Log venue processing start
  logVerbose(`Processing venue: ${venue.name} | Website: ${venue.website || 'N/A'} | Area: ${venue.area || 'N/A'} | Location: (${venue.lat || 'N/A'}, ${venue.lng || 'N/A'}) | Address: ${venue.address || 'N/A'}`);
  
  if (!venue.website) {
    logVerbose(`  -> Skipped: No website available`);
    return { venue: venue.name, matches: [], subpages: [], skipped: 'no website' };
  }
  
  if (!isAlcoholVenue(venue)) {
    logVerbose(`  -> Skipped: Not an alcohol venue | Types: ${venue.types?.join(', ') || 'N/A'}`);
    return { venue: venue.name, matches: [], subpages: [], skipped: 'not alcohol venue' };
  }
  
  const venueSubmenus = [];
  
  try {
    // Fetch homepage
    logVerbose(`  -> Fetching homepage: ${venue.website}`);
    const homepageHtml = await fetchUrl(venue.website);
    logVerbose(`  -> Homepage fetched successfully | Size: ${homepageHtml.length} bytes`);
    const isMultiLocation = detectMultiLocation(homepageHtml, venue.website);
    
    let contentHtml = homepageHtml;
    let contentUrl = venue.website;
    let localPageUsed = false;
    
    // If multi-location detected, try to find local page
    if (isMultiLocation) {
      log(`  🔍 Chain detection: Multi-location site detected for ${venue.name}`);
      if (venue.area) {
        log(`  📍 Searching for local page matching area: ${venue.area}`);
      }
      
      const localPageLinks = findLocalPageLinks(homepageHtml, venue.website, venue.area);
      
      if (localPageLinks.length > 0) {
        log(`  📍 Found ${localPageLinks.length} potential local page(s):`);
        localPageLinks.forEach((link, index) => {
          log(`    ${index + 1}. ${link.url} (score: ${link.score}, area: ${link.matchedArea}, exact: ${link.isExactMatch})`);
        });
        
        // Try each local page link until one succeeds
        for (const linkInfo of localPageLinks) {
          const localPageUrl = linkInfo.url;
          try {
            const localHtml = await fetchUrl(localPageUrl);
            contentHtml = localHtml;
            contentUrl = localPageUrl;
            localPageUsed = true;
            log(`  ✅ Matched local page: ${localPageUrl} for area ${linkInfo.matchedArea}`);
            break;
          } catch (error) {
            log(`  ⚠️  Failed to fetch local page ${localPageUrl}: ${error.message}`);
            // Continue to next link
          }
        }
        
        // If none of the local pages worked, try Google search fallback
        if (!localPageUsed) {
          log(`  ⚠️  All local page links failed, trying Google search fallback...`);
          const searchResult = await googleSearchFallback(venue.name, venue.area);
          if (searchResult) {
            try {
              const searchHtml = await fetchUrl(searchResult);
              contentHtml = searchHtml;
              contentUrl = searchResult;
              localPageUsed = true;
              log(`  ✅ Using Google search result: ${searchResult}`);
            } catch (error) {
              log(`  ⚠️  Failed to fetch Google search result: ${error.message}`);
            }
          }
        }
      } else {
        // No local page links found - try Google search fallback
        log(`  ⚠️  No local page for ${venue.area || 'venue area'} on chain site ${venue.name}`);
        log(`  🔍 Trying Google search fallback...`);
        logVerbose(`  -> No local page links found | Venue: ${venue.name} | Area: ${venue.area || 'N/A'} | Website: ${venue.website} | Attempting Google search fallback`);
        const searchResult = await googleSearchFallback(venue.name, venue.area);
        if (searchResult) {
          logVerbose(`  -> Google search fallback successful | Result URL: ${searchResult} | Venue: ${venue.name} | Area: ${venue.area || 'N/A'}`);
          try {
            const searchHtml = await fetchUrl(searchResult);
            contentHtml = searchHtml;
            contentUrl = searchResult;
            localPageUsed = true;
            log(`  ✅ Using Google search result: ${searchResult}`);
          } catch (error) {
            log(`  ⚠️  Failed to fetch Google search result: ${error.message}`);
            log(`  ℹ️  Falling back to homepage`);
          }
        } else {
          log(`  ℹ️  Google search fallback unavailable or no results, using homepage`);
        }
      }
    }
    
    // Extract subpage links from the content page (homepage or local page)
    const subpageUrls = findRelevantSubpageLinks(contentHtml, contentUrl);
    log(`  🔗 Discovered ${subpageUrls.length} submenu(s)`);
    
    // Add to inventory
    if (subpageUrls.length > 0) {
      venueSubmenus.push(...subpageUrls);
      submenusInventory.push({
        restaurantName: venue.name,
        website: venue.website,
        submenus: subpageUrls
      });
    }
    
    // Fetch subpages
    const subpageTexts = [];
    for (const subpageUrl of subpageUrls) {
      try {
        const subpageHtml = await fetchUrl(subpageUrl);
        const subpageText = extractText(subpageHtml);
        subpageTexts.push({ text: subpageText, url: subpageUrl });
        
        // Rate limiting between subpages
        await new Promise(resolve => setTimeout(resolve, getRandomDelay()));
      } catch (error) {
        log(`  ❌ Failed to fetch subpage ${subpageUrl}: ${error.message}`);
      }
    }
    
    // Extract text from content page
    const contentText = extractText(contentHtml);
    
    // Combine all text for happy hour extraction
    const allTexts = [
      { text: contentText, url: contentUrl },
      ...subpageTexts
    ];
    
    // Extract happy hour info from all pages
    const allMatches = [];
    allTexts.forEach(({ text, url }) => {
      const matches = extractHappyHourInfo(text, url);
      allMatches.push(...matches);
    });
    
    // Deduplicate by text content
    const uniqueMatches = [];
    const seenTexts = new Set();
    allMatches.forEach(match => {
      const textKey = match.text.toLowerCase().trim();
      if (!seenTexts.has(textKey)) {
        seenTexts.add(textKey);
        uniqueMatches.push(match);
      }
    });
    
    // Terminal: Simple message
    log(`  🍹 Found ${uniqueMatches.length} happy hour snippet(s)`);
    // File: Detailed message
    if (uniqueMatches.length > 0) {
      logVerbose(`  -> Happy hour matches found: ${uniqueMatches.length} unique snippet(s)`);
      uniqueMatches.forEach((match, index) => {
        logVerbose(`    Match ${index + 1}: Source="${match.source}" | Text="${match.text.substring(0, 200)}${match.text.length > 200 ? '...' : ''}"`);
      });
    } else {
      logVerbose(`  -> No happy hour matches found | Content URL: ${contentUrl} | Subpages processed: ${subpageTexts.length} | Total text sources: ${allTexts.length}`);
    }
    
    return {
      venue: venue.name,
      matches: uniqueMatches,
      subpages: subpageUrls,
      success: true,
      localPageUsed
    };
  } catch (error) {
    log(`  ❌ Error processing ${venue.name}: ${error.message}`);
    return { venue: venue.name, matches: [], subpages: [], error: error.message };
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
    return `• ${match.text} — source: ${match.source}`;
  });
  
  return bullets.join('\n');
}

/**
 * Main function
 */
async function main() {
  log('🍺 Starting Happy Hour Update Agent...\n');
  
  // Log paths
  log(`📁 Project root: ${path.resolve(__dirname, '..')}`);
  log(`📁 Data directory: ${path.resolve(path.dirname(VENUES_PATH))}`);
  log(`📄 Venues file: ${path.resolve(VENUES_PATH)}`);
  log(`📄 Spots file: ${path.resolve(SPOTS_PATH)}`);
  log(`📄 Submenus inventory: ${path.resolve(SUBMENUS_INVENTORY_PATH)}\n`);
  
  // Load venues
  const venues = JSON.parse(fs.readFileSync(VENUES_PATH, 'utf8'));
  log(`📖 Loaded ${venues.length} venues from ${path.resolve(VENUES_PATH)}`);
  
  // Load existing spots or create empty array
  let spots = [];
  if (fs.existsSync(SPOTS_PATH)) {
    spots = JSON.parse(fs.readFileSync(SPOTS_PATH, 'utf8'));
    log(`📖 Loaded ${spots.length} existing spots`);
  }
  
  // Filter venues with websites and alcohol types
  const venuesToProcess = venues.filter(v => v.website && isAlcoholVenue(v));
  log(`🌐 Found ${venuesToProcess.length} venues with websites\n`);
  
  // Submenus inventory (one-time collection)
  const submenusInventory = [];
  
  let processed = 0;
  let found = 0;
  let multiLocationCount = 0;
  let localPageCount = 0;
  let totalSubmenus = 0;
  
  for (const venue of venuesToProcess) {
    // Terminal: Simple message
    log(`\n[${processed + 1}/${venuesToProcess.length}] Processing: ${venue.name}`);
    log(`  🌐 ${venue.website}`);
    if (venue.area) {
      log(`  📍 Area: ${venue.area}`);
    }
    // File: Detailed message
    logVerbose(`Processing venue [${processed + 1}/${venuesToProcess.length}]: ${venue.name} | Website: ${venue.website} | Area: ${venue.area || 'N/A'} | Location: (${venue.lat || 'N/A'}, ${venue.lng || 'N/A'}) | Address: ${venue.address || 'N/A'}`);
    
    const result = await processVenue(venue, submenusInventory);
    
    if (result.skipped) {
      log(`  ⏭️  Skipped: ${result.skipped}`);
    } else if (result.error) {
      log(`  ❌ Error: ${result.error}`);
    } else {
      const matchCount = result.matches.length;
      const subpageCount = result.subpages.length;
      
      if (result.localPageUsed) {
        localPageCount++;
        multiLocationCount++;
      } else if (result.localPageUsed === false && result.matches.length > 0) {
        // Check if it was detected as multi-location but no local page found
        multiLocationCount++;
      }
      
      totalSubmenus += subpageCount;
      
      log(`  ✅ Scanned: ${matchCount} happy hour snippet(s) from ${subpageCount} subpage(s)`);
      
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
          log(`  ✨ Created new spot`);
        } else {
          // Update existing spot - append new sources
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
          log(`  🔄 Updated existing spot`);
        }
      }
    }
    
    processed++;
    
    // Rate limiting
    if (processed < venuesToProcess.length) {
      const delay = getRandomDelay();
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  // Save spots
  log(`\n\n💾 Saving ${spots.length} spots to ${path.resolve(SPOTS_PATH)}...`);
  fs.writeFileSync(SPOTS_PATH, JSON.stringify(spots, null, 2), 'utf8');
  log(`✅ Spots saved`);
  
  // Save submenus inventory (one-time)
  log(`\n💾 Writing submenus inventory to ${path.resolve(SUBMENUS_INVENTORY_PATH)}...`);
  fs.writeFileSync(SUBMENUS_INVENTORY_PATH, JSON.stringify(submenusInventory, null, 2), 'utf8');
  log(`✅ Submenus inventory saved (${submenusInventory.length} restaurants, ${totalSubmenus} total submenus)`);
  
  // Summary
  log(`\n📊 Summary:`);
  log(`   ✅ Processed: ${processed} venues`);
  log(`   🍹 Found happy hour info: ${found} venues`);
  log(`   🏢 Multi-location sites detected: ${multiLocationCount}`);
  log(`   📍 Local pages used: ${localPageCount}`);
  log(`   🔗 Total submenus discovered: ${totalSubmenus}`);
  log(`   📄 Total spots in file: ${spots.length}`);
  log(`\n✨ Done!`);
  log(`Done! Log saved to logs/update-happy-hours.log`);
}

// Run main function
main().catch(error => {
  log(`❌ Fatal error: ${error.message || error}`);
  process.exit(1);
});