/**
 * Update Happy Hours - Scraping Script
 * 
 * This script scrapes venue websites and saves raw data to data/scraped/<venue-id>.json
 * It is completely decoupled from venues.json and spots.json
 * 
 * Features:
 * - Daily caching per venue (checks if scraped file exists for today)
 * - Extracts all URL path patterns for learning
 * - Saves raw scraped content (HTML text) for later extraction
 * 
 * Run with: node scripts/update-happy-hours.js [area-filter]
 */

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
 * Shared logger function: logs to console and file with ISO timestamp
 */
function logToFileAndConsole(message, logPath) {
  const ts = new Date().toISOString();
  console.log(message);
  fs.appendFileSync(logPath, `[${ts}] ${message}\n`);
}

/**
 * File-only logger: logs verbose details only to file, not console
 */
function logToFileOnly(message, logPath) {
  const ts = new Date().toISOString();
  fs.appendFileSync(logPath, `[${ts}] ${message}\n`);
}

// Alias for backward compatibility - console output + file
const log = (message) => logToFileAndConsole(message, logPath);

// Verbose logging - file only (for detailed diagnostics)
const logVerbose = (message) => logToFileOnly(message, logPath);

// Use built-in fetch (Node 18+) - redirect: 'follow' is the default behavior
const fetch = globalThis.fetch || global.fetch;
if (typeof fetch !== 'function') {
  throw new Error('fetch is not available. Please use Node.js 18+ which includes built-in fetch.');
}

// Configuration
const RATE_LIMIT_DELAY_MIN = 1500; // Minimum delay between requests
const RATE_LIMIT_DELAY_MAX = 2500; // Maximum delay between requests
const MAX_SUBPAGES = 10; // Maximum subpages to fetch per site
const MAX_LOCAL_LINKS = 3; // Maximum local page links to try
const PARALLEL_WORKERS = 8; // Number of parallel workers for venue processing

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
  "sullivan's island",
  'sullivans island',
  'isle of palms',
  'iop',
  'west ashley',
  'north charleston',
  'charleston'
];

// Paths
const VENUES_PATH = path.join(__dirname, '../data/venues.json');
const SCRAPED_DIR = path.join(__dirname, '../data/scraped');
const URL_PATTERNS_PATH = path.join(__dirname, '../data/url-patterns.json');
const SUBMENUS_PATH = path.join(__dirname, '../data/restaurants-submenus.json');
const CACHE_DIR = path.join(__dirname, '../data/cache');

/**
 * Get random delay between min and max
 */
function getRandomDelay() {
  return Math.floor(Math.random() * (RATE_LIMIT_DELAY_MAX - RATE_LIMIT_DELAY_MIN + 1) + RATE_LIMIT_DELAY_MIN);
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
 * Extract all URL path patterns from HTML (for learning)
 * Returns array of distinct path segments (without domain)
 */
function extractUrlPatterns(html, baseUrl) {
  const $ = cheerio.load(html);
  const patterns = new Set();
  
  try {
    const baseUrlObj = new URL(baseUrl);
    const baseHostname = baseUrlObj.hostname;
    
    $('a[href]').each((i, elem) => {
      const href = $(elem).attr('href');
      if (!href) return;
      
      try {
        const resolvedUrl = resolveUrl(href, baseUrl);
        if (!resolvedUrl) return;
        
        const urlObj = new URL(resolvedUrl);
        
        // Only include links from the same domain
        if (urlObj.hostname === baseHostname) {
          // Extract pathname (remove leading slash, trailing slash)
          let pathname = urlObj.pathname;
          if (pathname.startsWith('/')) {
            pathname = pathname.substring(1);
          }
          if (pathname.endsWith('/')) {
            pathname = pathname.substring(0, pathname.length - 1);
          }
          
          // Split into segments and add each segment
          if (pathname) {
            // Add full path
            patterns.add(pathname);
            
            // Add individual segments
            const segments = pathname.split('/');
            segments.forEach(segment => {
              if (segment && segment.length > 0) {
                patterns.add(segment);
              }
            });
          }
        }
      } catch (e) {
        // Skip invalid URLs
      }
    });
  } catch (e) {
    logVerbose(`  ⚠️  Error extracting URL patterns: ${e.message}`);
  }
  
  return Array.from(patterns).sort();
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
  if (areaLower.includes('north charleston')) {
    variations.add('north charleston');
    variations.add('n charleston');
    variations.add('n. charleston');
    variations.add('nc');
    variations.add('northcharleston');
    variations.add('n-charleston');
  }
  if (areaLower.includes('mount pleasant')) {
    variations.add('mount pleasant');
    variations.add('mt pleasant');
    variations.add('mt. pleasant');
    variations.add('mountpleasant');
    variations.add('mt-pleasant');
  }
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
        const newScore = 1000 - index;
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
        const newScore = 500 - index;
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
          const newScore = 100 - index;
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
 * Generate safe cache file path from URL
 */
function getCachePath(url) {
  try {
    const urlObj = new URL(url);
    let cacheName = urlObj.hostname + urlObj.pathname;
    cacheName = cacheName.replace(/\//g, '-');
    cacheName = cacheName.replace(/\.(com|org|net|io|co|edu|gov)/g, '-$1');
    cacheName = cacheName.replace(/[^a-zA-Z0-9-_]/g, '-');
    cacheName = cacheName.replace(/-+/g, '-');
    cacheName = cacheName.replace(/^-+|-+$/g, '');
    if (cacheName.length > 200) {
      cacheName = cacheName.substring(0, 200);
    }
    return path.join(CACHE_DIR, `${cacheName}.html`);
  } catch (e) {
    const safeName = url.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 200);
    return path.join(CACHE_DIR, `${safeName}.html`);
  }
}

/**
 * Check if cache file exists and was modified today
 */
function isCacheValid(cachePath) {
  try {
    if (!fs.existsSync(cachePath)) {
      return false;
    }
    
    const stats = fs.statSync(cachePath);
    const cacheDate = new Date(stats.mtime);
    const today = new Date();
    
    return cacheDate.getDate() === today.getDate() &&
           cacheDate.getMonth() === today.getMonth() &&
           cacheDate.getFullYear() === today.getFullYear();
  } catch (e) {
    return false;
  }
}

/**
 * Read HTML from cache file
 */
function readCache(cachePath) {
  try {
    return fs.readFileSync(cachePath, 'utf8');
  } catch (e) {
    throw new Error(`Failed to read cache: ${e.message}`);
  }
}

/**
 * Save HTML to cache file
 */
function saveCache(cachePath, html) {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(cachePath, html, 'utf8');
  } catch (e) {
    log(`  ⚠️  Cache write failed for ${cachePath}: ${e.message}`);
  }
}

/**
 * Fetch URL with error handling, redirect following, and daily caching
 * Returns { html, fromCache } - fromCache indicates if cache was used
 */
async function fetchUrl(url, retries = 2, useCache = true) {
  // Check cache first if enabled
  if (useCache) {
    const cachePath = getCachePath(url);
    const cacheExists = fs.existsSync(cachePath);
    if (cacheExists) {
      if (isCacheValid(cachePath)) {
        try {
          const cachedHtml = readCache(cachePath);
          logVerbose(`  💾 Using cache for ${url}`);
          return { html: cachedHtml, fromCache: true };
        } catch (e) {
          logVerbose(`  ⚠️  Cache read failed, fetching fresh: ${e.message}`);
        }
      } else {
        logVerbose(`  🔄 Cache expired (not from today), fetching fresh for ${url}`);
      }
    } else {
      logVerbose(`  🔄 No cache found, fetching fresh for ${url}`);
    }
  }
  
  // Fetch fresh content
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
      
      const html = await response.text();
      
      // Save to cache if enabled
      if (useCache) {
        const cachePath = getCachePath(url);
        saveCache(cachePath, html);
        logVerbose(`  🔄 Fetched fresh for ${url}`);
      }
      
      return { html, fromCache: false };
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
 */
async function googleSearchFallback(venueName, venueArea) {
  const GOOGLE_SEARCH_API_KEY = process.env.GOOGLE_SEARCH_API_KEY;
  const GOOGLE_SEARCH_ENGINE_ID = process.env.GOOGLE_SEARCH_ENGINE_ID;
  
  if (!GOOGLE_SEARCH_API_KEY || !GOOGLE_SEARCH_ENGINE_ID) {
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
      for (const item of data.items) {
        const link = item.link;
        const title = (item.title || '').toLowerCase();
        const snippet = (item.snippet || '').toLowerCase();
        const linkLower = link.toLowerCase();
        
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
 * Get scraped file path for a venue
 */
function getScrapedFilePath(venueId) {
  return path.join(SCRAPED_DIR, `${venueId}.json`);
}

/**
 * Check if scraped file exists and was created today
 */
function isScrapedFileValid(scrapedFilePath) {
  try {
    if (!fs.existsSync(scrapedFilePath)) {
      return false;
    }
    
    const stats = fs.statSync(scrapedFilePath);
    const fileDate = new Date(stats.mtime);
    const today = new Date();
    
    return fileDate.getDate() === today.getDate() &&
           fileDate.getMonth() === today.getMonth() &&
           fileDate.getFullYear() === today.getFullYear();
  } catch (e) {
    return false;
  }
}

/**
 * Load existing scraped data for a venue
 */
function loadScrapedData(scrapedFilePath) {
  try {
    const content = fs.readFileSync(scrapedFilePath, 'utf8');
    return JSON.parse(content);
  } catch (e) {
    return null;
  }
}

/**
 * Save scraped data for a venue
 */
function saveScrapedData(scrapedFilePath, data) {
  try {
    if (!fs.existsSync(SCRAPED_DIR)) {
      fs.mkdirSync(SCRAPED_DIR, { recursive: true });
    }
    fs.writeFileSync(scrapedFilePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    log(`  ⚠️  Failed to save scraped data: ${e.message}`);
  }
}

/**
 * Load or initialize URL patterns file
 */
function loadUrlPatterns() {
  try {
    if (fs.existsSync(URL_PATTERNS_PATH)) {
      const content = fs.readFileSync(URL_PATTERNS_PATH, 'utf8');
      return JSON.parse(content);
    }
  } catch (e) {
    logVerbose(`  ⚠️  Error loading URL patterns: ${e.message}`);
  }
  return [];
}

/**
 * Save URL patterns (append new patterns, keep distinct)
 */
function saveUrlPatterns(patterns) {
  try {
    const existing = loadUrlPatterns();
    const allPatterns = new Set(existing);
    
    // Add new patterns
    patterns.forEach(pattern => allPatterns.add(pattern));
    
    const sortedPatterns = Array.from(allPatterns).sort();
    fs.writeFileSync(URL_PATTERNS_PATH, JSON.stringify(sortedPatterns, null, 2), 'utf8');
  } catch (e) {
    log(`  ⚠️  Failed to save URL patterns: ${e.message}`);
  }
}

/**
 * Process a single venue
 */
async function processVenue(venue) {
  logVerbose(`Processing venue: ${venue.name} | Website: ${venue.website || 'N/A'} | Area: ${venue.area || 'N/A'} | Location: (${venue.lat || 'N/A'}, ${venue.lng || 'N/A'}) | Address: ${venue.address || 'N/A'}`);
  
  if (!venue.website) {
    logVerbose(`  -> Skipped: No website available`);
    return { venue: venue.name, skipped: 'no website' };
  }
  
  if (!isAlcoholVenue(venue)) {
    logVerbose(`  -> Skipped: Not an alcohol venue | Types: ${venue.types?.join(', ') || 'N/A'}`);
    return { venue: venue.name, skipped: 'not alcohol venue' };
  }
  
  // Check if scraped file exists for today
  const scrapedFilePath = getScrapedFilePath(venue.id);
  if (isScrapedFileValid(scrapedFilePath)) {
    log(`  💾 Using cached scraped data (from today)`);
    const cachedData = loadScrapedData(scrapedFilePath);
    if (cachedData) {
      return {
        venue: venue.name,
        success: true,
        fromCache: true,
        urlPatterns: cachedData.urlPatterns || [],
        matches: (cachedData.rawMatches || []).length,
        subpages: (cachedData.sources || []).filter(s => s.pageType === 'subpage').length
      };
    }
  }
  
  const scrapedData = {
    venueId: venue.id,
    venueName: venue.name,
    venueArea: venue.area || null,
    website: venue.website,
    scrapedAt: new Date().toISOString(),
    sources: [],
    rawMatches: [],
    urlPatterns: []
  };
  
  try {
    // Fetch homepage
    logVerbose(`  -> Fetching homepage: ${venue.website}`);
    const homepageResult = await fetchUrl(venue.website);
    const homepageHtml = homepageResult.html;
    logVerbose(`  -> Homepage fetched successfully | Size: ${homepageHtml.length} bytes`);
    
    // Extract URL patterns from homepage
    const homepagePatterns = extractUrlPatterns(homepageHtml, venue.website);
    scrapedData.urlPatterns.push(...homepagePatterns);
    
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
        logVerbose(`  📍 Found ${localPageLinks.length} potential local page(s):`);
        localPageLinks.forEach((link, index) => {
          logVerbose(`    ${index + 1}. ${link.url} (score: ${link.score}, area: ${link.matchedArea}, exact: ${link.isExactMatch})`);
        });
        
        // Try each local page link until one succeeds
        for (const linkInfo of localPageLinks) {
          const localPageUrl = linkInfo.url;
          try {
            const localResult = await fetchUrl(localPageUrl);
            contentHtml = localResult.html;
            contentUrl = localPageUrl;
            localPageUsed = true;
            logVerbose(`  ✅ Matched local page: ${localPageUrl} for area ${linkInfo.matchedArea}`);
            
            // Extract URL patterns from local page
            const localPatterns = extractUrlPatterns(localResult.html, localPageUrl);
            scrapedData.urlPatterns.push(...localPatterns);
            
            break;
          } catch (error) {
            log(`  ⚠️  Failed to fetch local page ${localPageUrl}: ${error.message}`);
          }
        }
        
        // If none of the local pages worked, try Google search fallback
        if (!localPageUsed) {
          log(`  ⚠️  All local page links failed, trying Google search fallback...`);
          const searchResult = await googleSearchFallback(venue.name, venue.area);
          if (searchResult) {
            try {
              const searchResult_fetch = await fetchUrl(searchResult);
              contentHtml = searchResult_fetch.html;
              contentUrl = searchResult;
              localPageUsed = true;
              log(`  ✅ Using Google search result: ${searchResult}`);
              
              // Extract URL patterns from search result
              const searchPatterns = extractUrlPatterns(searchResult_fetch.html, searchResult);
              scrapedData.urlPatterns.push(...searchPatterns);
            } catch (error) {
              log(`  ⚠️  Failed to fetch Google search result: ${error.message}`);
            }
          }
        }
      } else {
        // No local page links found - try Google search fallback
        log(`  ⚠️  No local page for ${venue.area || 'venue area'} on chain site ${venue.name}`);
        log(`  🔍 Trying Google search fallback...`);
        const searchResult = await googleSearchFallback(venue.name, venue.area);
        if (searchResult) {
          logVerbose(`  -> Google search fallback successful | Result URL: ${searchResult}`);
          try {
            const searchResult_fetch = await fetchUrl(searchResult);
            contentHtml = searchResult_fetch.html;
            contentUrl = searchResult;
            localPageUsed = true;
            log(`  ✅ Using Google search result: ${searchResult}`);
            
            // Extract URL patterns from search result
            const searchPatterns = extractUrlPatterns(searchResult_fetch.html, searchResult);
            scrapedData.urlPatterns.push(...searchPatterns);
          } catch (error) {
            log(`  ⚠️  Failed to fetch Google search result: ${error.message}`);
            log(`  ℹ️  Falling back to homepage`);
          }
        } else {
          log(`  ℹ️  Google search fallback unavailable or no results, using homepage`);
        }
      }
    }
    
    // Extract text from content page
    const contentText = extractText(contentHtml);
    
    // Save homepage/local page as source
    scrapedData.sources.push({
      url: contentUrl,
      text: contentText,
      pageType: localPageUsed ? 'location-page' : 'homepage',
      scrapedAt: new Date().toISOString()
    });
    
    // Extract subpage links from the content page
    const subpageUrls = findRelevantSubpageLinks(contentHtml, contentUrl);
    log(`  🔗 Discovered ${subpageUrls.length} submenu(s)`);
    
    // Fetch subpages
    const subpageTexts = [];
    for (const subpageUrl of subpageUrls) {
      try {
        const subpageResult = await fetchUrl(subpageUrl);
        const subpageHtml = subpageResult.html;
        const subpageText = extractText(subpageHtml);
        subpageTexts.push({ text: subpageText, url: subpageUrl });
        
        // Extract URL patterns from subpage
        const subpagePatterns = extractUrlPatterns(subpageResult.html, subpageUrl);
        scrapedData.urlPatterns.push(...subpagePatterns);
        
        // Save subpage as source
        scrapedData.sources.push({
          url: subpageUrl,
          text: subpageText,
          pageType: 'subpage',
          scrapedAt: new Date().toISOString()
        });
        
        // Rate limiting between subpages - only if we fetched fresh (not from cache)
        if (!subpageResult.fromCache) {
          await new Promise(resolve => setTimeout(resolve, getRandomDelay()));
        }
      } catch (error) {
        log(`  ❌ Failed to fetch subpage ${subpageUrl}: ${error.message}`);
      }
    }
    
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
    
    scrapedData.rawMatches = uniqueMatches;
    
    // Deduplicate URL patterns
    scrapedData.urlPatterns = Array.from(new Set(scrapedData.urlPatterns)).sort();
    
    // Terminal: Simple message
    log(`  🍹 Found ${uniqueMatches.length} happy hour snippet(s)`);
    log(`  🔗 Found ${scrapedData.urlPatterns.length} URL pattern(s)`);
    
    // File: Detailed message
    if (uniqueMatches.length > 0) {
      logVerbose(`  -> Happy hour matches found: ${uniqueMatches.length} unique snippet(s)`);
      uniqueMatches.forEach((match, index) => {
        log(`    Match ${index + 1}: Source="${match.source}" | Text="${match.text.substring(0, 200)}${match.text.length > 200 ? '...' : ''}"`);
      });
    } else {
      logVerbose(`  -> No happy hour matches found | Content URL: ${contentUrl} | Subpages processed: ${subpageTexts.length} | Total text sources: ${allTexts.length}`);
    }
    
    // Save scraped data to file
    saveScrapedData(scrapedFilePath, scrapedData);
    
    // Return URL patterns (don't save here - will be collected and saved at end)
    return {
      venue: venue.name,
      matches: uniqueMatches.length,
      subpages: subpageUrls.length,
      urlPatterns: scrapedData.urlPatterns,
      success: true,
      localPageUsed
    };
  } catch (error) {
    log(`  ❌ Error processing ${venue.name}: ${error.message}`);
    return { venue: venue.name, error: error.message };
  }
}

/**
 * Main function
 */
async function main() {
  // Parse command-line arguments
  const args = process.argv.slice(2);
  let areaFilter = null;
  let parallelWorkers = PARALLEL_WORKERS;
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--workers' || arg === '-w') {
      const workers = parseInt(args[i + 1], 10);
      if (!isNaN(workers) && workers > 0 && workers <= 50) {
        parallelWorkers = workers;
        i++; // Skip next arg
      } else {
        log(`⚠️  Invalid --workers value, using default: ${PARALLEL_WORKERS}`);
      }
    } else if (!arg.startsWith('-')) {
      // First non-flag argument is area filter
      if (!areaFilter) {
        areaFilter = arg.trim();
      }
    }
  }
  
  if (areaFilter) {
    log(`🔍 Area filter specified: "${areaFilter}"\n`);
  }
  if (parallelWorkers !== PARALLEL_WORKERS) {
    log(`⚙️  Parallel workers: ${parallelWorkers} (default: ${PARALLEL_WORKERS})\n`);
  }
  
  log('🍺 Starting Happy Hour Scraping Agent...\n');
  log('   This script scrapes venues and saves raw data to data/scraped/<venue-id>.json\n');
  log('   It does NOT modify venues.json or spots.json\n');
  
  // Ensure directories exist
  if (!fs.existsSync(SCRAPED_DIR)) {
    fs.mkdirSync(SCRAPED_DIR, { recursive: true });
  }
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
  
  // Log paths
  log(`📁 Project root: ${path.resolve(__dirname, '..')}`);
  log(`📁 Scraped directory: ${path.resolve(SCRAPED_DIR)}`);
  log(`📁 Cache directory: ${path.resolve(CACHE_DIR)}`);
  log(`📄 URL patterns file: ${path.resolve(URL_PATTERNS_PATH)}\n`);
  
  // Load venues (read-only, for filtering)
  let venues = [];
  try {
    const venuesContent = fs.readFileSync(VENUES_PATH, 'utf8');
    venues = JSON.parse(venuesContent);
    log(`📖 Loaded ${venues.length} venues from ${path.resolve(VENUES_PATH)} (read-only)`);
  } catch (error) {
    log(`❌ Error loading venues.json: ${error.message}`);
    log(`   This script requires venues.json to exist`);
    process.exit(1);
  }
  
  // Filter by area if area filter is specified
  if (areaFilter) {
    const filterLower = areaFilter.toLowerCase();
    const originalCount = venues.length;
    venues = venues.filter(venue => {
      const venueArea = (venue.area || '').toLowerCase();
      return venueArea.includes(filterLower);
    });
    
    if (venues.length === 0) {
      log(`❌ Error: No venues found for area "${areaFilter}"`);
      log(`   Available areas: ${[...new Set(JSON.parse(fs.readFileSync(VENUES_PATH, 'utf8')).map(v => v.area).filter(Boolean))].join(', ')}`);
      process.exit(1);
    }
    
    log(`✅ Filtered to ${venues.length} venue(s) for area "${areaFilter}" (from ${originalCount} total)\n`);
  }
  
  // Filter venues with websites and alcohol types
  const venuesToProcess = venues.filter(v => v.website && isAlcoholVenue(v));
  log(`🌐 Found ${venuesToProcess.length} venues with websites\n`);
  
  // Log venues per area
  const venuesPerArea = {};
  const skippedPerArea = { noWebsite: 0, notAlcohol: 0 };
  for (const venue of venues) {
    const area = venue.area || 'Unknown';
    venuesPerArea[area] = (venuesPerArea[area] || 0) + 1;
    if (!venue.website) {
      skippedPerArea.noWebsite++;
    }
    if (!isAlcoholVenue(venue)) {
      skippedPerArea.notAlcohol++;
    }
  }
  log(`Venues per area:`);
  for (const [area, count] of Object.entries(venuesPerArea).sort((a, b) => b[1] - a[1])) {
    log(`   ${area}: ${count} venues`);
  }
  log(`Skipped: ${skippedPerArea.noWebsite} (no website), ${skippedPerArea.notAlcohol} (not alcohol venue)\n`);
  
  // Parallel processing setup
  const allUrlPatterns = new Set();
  const stats = {
    processed: 0,
    found: 0,
    cached: 0,
    multiLocationCount: 0,
    localPageCount: 0,
    totalSubmenus: 0,
    errors: 0
  };
  
  // Worker pool for parallel processing
  async function processVenueWithStats(venue, index) {
    // Terminal: Simple message
    log(`\n[${index + 1}/${venuesToProcess.length}] Processing: ${venue.name}`);
    log(`  🌐 ${venue.website}`);
    if (venue.area) {
      log(`  📍 Area: ${venue.area}`);
    }
    // File: Detailed message
    logVerbose(`Processing venue [${index + 1}/${venuesToProcess.length}]: ${venue.name} | Website: ${venue.website} | Area: ${venue.area || 'N/A'} | Location: (${venue.lat || 'N/A'}, ${venue.lng || 'N/A'}) | Address: ${venue.address || 'N/A'}`);
    
    try {
      const result = await processVenue(venue);
      
      // Thread-safe stats update
      stats.processed++;
      
      if (result.skipped) {
        log(`  ⏭️  Skipped: ${result.skipped}`);
      } else if (result.error) {
        log(`  ❌ Error: ${result.error}`);
        stats.errors++;
      } else {
        if (result.fromCache) {
          stats.cached++;
          log(`  ✅ Using cached data (from today)`);
        } else {
          log(`  ✅ Scraped: ${result.matches} happy hour snippet(s) from ${result.subpages} subpage(s)`);
          log(`  🔗 Discovered ${result.urlPatterns.length} URL pattern(s)`);
          
          if (result.matches > 0) {
            stats.found++;
          }
          
          if (result.localPageUsed) {
            stats.localPageCount++;
            stats.multiLocationCount++;
          } else if (result.localPageUsed === false && result.matches > 0) {
            stats.multiLocationCount++;
          }
          
          stats.totalSubmenus += result.subpages;
          
          // Collect URL patterns (thread-safe - Set operations are atomic)
          if (result.urlPatterns && Array.isArray(result.urlPatterns)) {
            result.urlPatterns.forEach(pattern => allUrlPatterns.add(pattern));
          }
        }
      }
    } catch (error) {
      stats.processed++;
      stats.errors++;
      log(`  ❌ Fatal error processing ${venue.name}: ${error.message}`);
    }
  }
  
  // Process venues in parallel batches using a simple worker pool
  log(`🚀 Processing ${venuesToProcess.length} venues with ${parallelWorkers} parallel workers...\n`);
  
  const workers = [];
  for (let i = 0; i < venuesToProcess.length; i++) {
    const venue = venuesToProcess[i];
    
    // Start worker
    const workerPromise = processVenueWithStats(venue, i).finally(() => {
      // Remove self from workers array when done
      const index = workers.indexOf(workerPromise);
      if (index > -1) {
        workers.splice(index, 1);
      }
    });
    workers.push(workerPromise);
    
    // Wait if we have too many active workers
    if (workers.length >= parallelWorkers) {
      await Promise.race(workers);
    }
  }
  
  // Wait for all remaining workers to complete
  await Promise.all(workers);
  
  // Save all collected URL patterns at once (thread-safe)
  const sortedPatterns = Array.from(allUrlPatterns).sort();
  const existingPatterns = loadUrlPatterns();
  const allPatternsSet = new Set([...existingPatterns, ...sortedPatterns]);
  const finalPatterns = Array.from(allPatternsSet).sort();
  fs.writeFileSync(URL_PATTERNS_PATH, JSON.stringify(finalPatterns, null, 2), 'utf8');
  
  // Filter submenu-related patterns (patterns that match SUBPAGE_KEYWORDS)
  const submenuPatterns = finalPatterns.filter(pattern => {
    const patternLower = pattern.toLowerCase();
    return SUBPAGE_KEYWORDS.some(keyword => 
      patternLower.includes(keyword.toLowerCase())
    );
  });
  
  // Load existing submenu patterns and merge
  let existingSubmenus = [];
  if (fs.existsSync(SUBMENUS_PATH)) {
    try {
      const content = fs.readFileSync(SUBMENUS_PATH, 'utf8');
      existingSubmenus = JSON.parse(content);
      if (!Array.isArray(existingSubmenus)) {
        existingSubmenus = [];
      }
    } catch (error) {
      logVerbose(`  ⚠️  Could not load existing submenus: ${error.message}`);
      existingSubmenus = [];
    }
  }
  
  const allSubmenusSet = new Set([...existingSubmenus, ...submenuPatterns]);
  const finalSubmenus = Array.from(allSubmenusSet).sort();
  fs.writeFileSync(SUBMENUS_PATH, JSON.stringify(finalSubmenus, null, 2), 'utf8');
  
  // Summary
  log(`\n📊 Summary:`);
  log(`   ✅ Processed: ${stats.processed} venues`);
  log(`   💾 Cached (from today): ${stats.cached} venues`);
  log(`   🍹 Found happy hour info: ${stats.found} venues`);
  log(`   🏢 Multi-location sites detected: ${stats.multiLocationCount}`);
  log(`   📍 Local pages used: ${stats.localPageCount}`);
  log(`   🔗 Total submenus discovered: ${stats.totalSubmenus}`);
  log(`   🔗 Total URL patterns discovered: ${finalPatterns.length} (${sortedPatterns.length} new)`);
  log(`   🍽️  Submenu patterns discovered: ${finalSubmenus.length} (${submenuPatterns.length} new)`);
  log(`   ❌ Errors: ${stats.errors}`);
  log(`   📁 Scraped data saved to: ${path.resolve(SCRAPED_DIR)}`);
  log(`   📄 URL patterns saved to: ${path.resolve(URL_PATTERNS_PATH)}`);
  log(`   📄 Submenu patterns saved to: ${path.resolve(SUBMENUS_PATH)}`);
  
  log(`\n✨ Done!`);
  log(`   Next step: Run extract-happy-hours.js to extract structured data from scraped content`);
  logToFileAndConsole(`Done! Log saved to ${logPath}`, logPath);
}

// Run main function
main().catch(error => {
  log(`❌ Fatal error: ${error.message || error}`);
  process.exit(1);
});
