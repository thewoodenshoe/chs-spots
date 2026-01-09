const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { URL } = require('url');

// Use built-in fetch (Node 18+) - redirect: 'follow' is the default behavior
const fetch = globalThis.fetch || global.fetch;
if (typeof fetch !== 'function') {
  throw new Error('fetch is not available. Please use Node.js 18+ which includes built-in fetch.');
}

// Configuration
const RATE_LIMIT_DELAY_MIN = 1500; // Minimum delay between requests
const RATE_LIMIT_DELAY_MAX = 2500; // Maximum delay between requests
const MAX_SUBPAGES = 8; // Maximum subpages to fetch per site
const MAX_LOCAL_LINKS = 3; // Maximum local page links to try

// Keywords for finding relevant subpages
const SUBPAGE_KEYWORDS = [
  'menu', 'menus', 'happy-hour', 'happyhour', 'specials', 
  'event', 'events', 'bar', 'drinks', 'food', 'dinner', 
  'lunch', 'cocktail', 'wine', 'beer'
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
 * Find local page links for multi-location sites
 */
function findLocalPageLinks(html, baseUrl, venueArea) {
  const $ = cheerio.load(html);
  const areaLower = (venueArea || '').toLowerCase();
  const links = [];
  
  // Normalize area name for matching
  const areaVariations = [];
  if (areaLower) {
    areaVariations.push(areaLower);
    areaVariations.push(areaLower.replace(/\s+/g, '-'));
    areaVariations.push(areaLower.replace(/\s+/g, ''));
    areaVariations.push(areaLower.replace(/'/g, ''));
  }
  
  // Also check all Charleston areas
  CHARLESTON_AREAS.forEach(area => {
    const areaLower = area.toLowerCase();
    areaVariations.push(areaLower);
    areaVariations.push(areaLower.replace(/\s+/g, '-'));
    areaVariations.push(areaLower.replace(/\s+/g, ''));
    areaVariations.push(areaLower.replace(/'/g, ''));
  });
  
  $('a[href]').each((i, elem) => {
    const href = $(elem).attr('href');
    const linkText = $(elem).text().toLowerCase();
    if (!href || !isInternalUrl(href, baseUrl)) return;
    
    const hrefLower = href.toLowerCase();
    let score = 0;
    
    // Score based on area match
    areaVariations.forEach((variation, index) => {
      // Exact match in link text (highest score)
      if (linkText.includes(variation)) {
        score = Math.max(score, 100 - index);
      }
      // Match in URL
      if (hrefLower.includes(variation)) {
        score = Math.max(score, 50 - index);
      }
    });
    
    if (score > 0) {
      const resolvedUrl = resolveUrl(href, baseUrl);
      if (resolvedUrl) {
        links.push({ url: resolvedUrl, score, text: linkText });
      }
    }
  });
  
  // Sort by score (highest first) and limit
  links.sort((a, b) => b.score - a.score);
  return links.slice(0, MAX_LOCAL_LINKS).map(l => l.url);
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
  if (!venue.website) {
    return { venue: venue.name, matches: [], subpages: [], skipped: 'no website' };
  }
  
  if (!isAlcoholVenue(venue)) {
    return { venue: venue.name, matches: [], subpages: [], skipped: 'not alcohol venue' };
  }
  
  const venueSubmenus = [];
  
  try {
    // Fetch homepage
    const homepageHtml = await fetchUrl(venue.website);
    const isMultiLocation = detectMultiLocation(homepageHtml, venue.website);
    
    let contentHtml = homepageHtml;
    let contentUrl = venue.website;
    let localPageUsed = false;
    
    // If multi-location detected, try to find local page
    if (isMultiLocation) {
      console.log(`  🔍 Found multi-location site for ${venue.name}`);
      const localPageLinks = findLocalPageLinks(homepageHtml, venue.website, venue.area);
      
      if (localPageLinks.length > 0) {
        console.log(`  📍 Found ${localPageLinks.length} potential local page(s)`);
        
        // Try each local page link until one succeeds
        for (const localPageUrl of localPageLinks) {
          try {
            const localHtml = await fetchUrl(localPageUrl);
            contentHtml = localHtml;
            contentUrl = localPageUrl;
            localPageUsed = true;
            console.log(`  ✅ Using local page: ${localPageUrl}`);
            break;
          } catch (error) {
            console.log(`  ⚠️  Failed to fetch local page ${localPageUrl}: ${error.message}`);
            // Continue to next link
          }
        }
      } else {
        console.log(`  ℹ️  No local page links found, using homepage`);
      }
    }
    
    // Extract subpage links from the content page (homepage or local page)
    const subpageUrls = findRelevantSubpageLinks(contentHtml, contentUrl);
    console.log(`  🔗 Discovered ${subpageUrls.length} submenu(s)`);
    
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
        console.error(`  ❌ Failed to fetch subpage ${subpageUrl}: ${error.message}`);
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
    
    console.log(`  🍹 Found ${uniqueMatches.length} happy hour snippet(s)`);
    
    return {
      venue: venue.name,
      matches: uniqueMatches,
      subpages: subpageUrls,
      success: true,
      localPageUsed
    };
  } catch (error) {
    console.error(`  ❌ Error processing ${venue.name}: ${error.message}`);
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
  console.log('🍺 Starting Happy Hour Update Agent...\n');
  
  // Log paths
  console.log(`📁 Project root: ${path.resolve(__dirname, '..')}`);
  console.log(`📁 Data directory: ${path.resolve(path.dirname(VENUES_PATH))}`);
  console.log(`📄 Venues file: ${path.resolve(VENUES_PATH)}`);
  console.log(`📄 Spots file: ${path.resolve(SPOTS_PATH)}`);
  console.log(`📄 Submenus inventory: ${path.resolve(SUBMENUS_INVENTORY_PATH)}\n`);
  
  // Load venues
  const venues = JSON.parse(fs.readFileSync(VENUES_PATH, 'utf8'));
  console.log(`📖 Loaded ${venues.length} venues from ${path.resolve(VENUES_PATH)}`);
  
  // Load existing spots or create empty array
  let spots = [];
  if (fs.existsSync(SPOTS_PATH)) {
    spots = JSON.parse(fs.readFileSync(SPOTS_PATH, 'utf8'));
    console.log(`📖 Loaded ${spots.length} existing spots`);
  }
  
  // Filter venues with websites and alcohol types
  const venuesToProcess = venues.filter(v => v.website && isAlcoholVenue(v));
  console.log(`🌐 Found ${venuesToProcess.length} venues with websites\n`);
  
  // Submenus inventory (one-time collection)
  const submenusInventory = [];
  
  let processed = 0;
  let found = 0;
  let multiLocationCount = 0;
  let localPageCount = 0;
  let totalSubmenus = 0;
  
  for (const venue of venuesToProcess) {
    console.log(`\n[${processed + 1}/${venuesToProcess.length}] Processing: ${venue.name}`);
    console.log(`  🌐 ${venue.website}`);
    if (venue.area) {
      console.log(`  📍 Area: ${venue.area}`);
    }
    
    const result = await processVenue(venue, submenusInventory);
    
    if (result.skipped) {
      console.log(`  ⏭️  Skipped: ${result.skipped}`);
    } else if (result.error) {
      console.log(`  ❌ Error: ${result.error}`);
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
      
      console.log(`  ✅ Scanned: ${matchCount} happy hour snippet(s) from ${subpageCount} subpage(s)`);
      
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
          console.log(`  ✨ Created new spot`);
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
          console.log(`  🔄 Updated existing spot`);
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
  console.log(`\n\n💾 Saving ${spots.length} spots to ${path.resolve(SPOTS_PATH)}...`);
  fs.writeFileSync(SPOTS_PATH, JSON.stringify(spots, null, 2), 'utf8');
  console.log(`✅ Spots saved`);
  
  // Save submenus inventory (one-time)
  console.log(`\n💾 Writing submenus inventory to ${path.resolve(SUBMENUS_INVENTORY_PATH)}...`);
  fs.writeFileSync(SUBMENUS_INVENTORY_PATH, JSON.stringify(submenusInventory, null, 2), 'utf8');
  console.log(`✅ Submenus inventory saved (${submenusInventory.length} restaurants, ${totalSubmenus} total submenus)`);
  
  // Summary
  console.log(`\n📊 Summary:`);
  console.log(`   ✅ Processed: ${processed} venues`);
  console.log(`   🍹 Found happy hour info: ${found} venues`);
  console.log(`   🏢 Multi-location sites detected: ${multiLocationCount}`);
  console.log(`   📍 Local pages used: ${localPageCount}`);
  console.log(`   🔗 Total submenus discovered: ${totalSubmenus}`);
  console.log(`   📄 Total spots in file: ${spots.length}`);
  console.log(`\n✨ Done!`);
}

// Run main function
main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});