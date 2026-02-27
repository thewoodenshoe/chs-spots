#!/usr/bin/env node
/**
 * discover-openings.js - Nightly Restaurant Opening Discovery
 *
 * Discovers new/upcoming restaurant and bar openings in Charleston via:
 *   1. Google News RSS (3 queries: openings, coming soon, new venues)
 *   2. WhatNow Charleston RSS (dedicated opening news)
 *   3. Eater Carolinas Atom feed (filtered for Charleston content)
 *   4. Grok API with web_search (real-time web intelligence)
 *
 * Geocodes discovered restaurants via Google Places Text Search API,
 * deduplicates against existing spots/venues, and inserts as
 * "Recently Opened" or "Coming Soon" activity spots.
 *
 * Usage: GOOGLE_PLACES_ENABLED=true node scripts/discover-openings.js
 *
 * Cost: ~$0.50/night (geocoding) + ~$0.002/night (Grok API)
 */

const fs = require('fs');
const path = require('path');
const db = require('./utils/db');
const { detectSecondaryTypes } = require('./utils/activity-tagger');

// ── Logging ─────────────────────────────────────────────────────

const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
const logPath = path.join(logDir, 'discover-openings.log');
fs.writeFileSync(logPath, '', 'utf8');

function log(message) {
  const ts = new Date().toISOString();
  console.log(message);
  fs.appendFileSync(logPath, `[${ts}] ${message}\n`);
}

function logVerbose(message) {
  const ts = new Date().toISOString();
  fs.appendFileSync(logPath, `[${ts}] ${message}\n`);
}

// ── Environment ─────────────────────────────────────────────────

try {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local') });
} catch (e) {
  try { require('dotenv').config(); } catch (_) {}
}

const GOOGLE_MAPS_API_KEY =
  process.env.GOOGLE_PLACES_SERVER_KEY ||
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ||
  process.env.GOOGLE_PLACES_KEY;

if (!GOOGLE_MAPS_API_KEY) {
  log('❌ Error: No Google Places API key found. Set GOOGLE_PLACES_SERVER_KEY in .env.local');
  process.exit(1);
}

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT = process.env.TELEGRAM_ADMIN_CHAT_ID || '';

// ── Config ──────────────────────────────────────────────────────

const RSS_FEEDS = [
  {
    name: 'Google News (openings)',
    url: 'https://news.google.com/rss/search?q=charleston+sc+new+restaurant+OR+bar+OR+brewery+opening+OR+opened+OR+%22coming+soon%22&hl=en-US&gl=US&ceid=US:en',
    format: 'rss',
  },
  {
    name: 'Google News (coming soon)',
    url: 'https://news.google.com/rss/search?q=charleston+sc+restaurant+OR+bar+%22coming+soon%22+OR+%22new+location%22+OR+%22set+to+open%22&hl=en-US&gl=US&ceid=US:en',
    format: 'rss',
  },
  {
    name: 'Google News (new venues)',
    url: 'https://news.google.com/rss/search?q=charleston+sc+new+restaurant+OR+brewery+OR+cafe+OR+bakery+2026&hl=en-US&gl=US&ceid=US:en',
    format: 'rss',
  },
  {
    name: 'WhatNow Charleston',
    url: 'https://whatnow.com/charleston/feed/',
    format: 'rss',
  },
  {
    name: 'Eater Carolinas',
    url: 'https://carolinas.eater.com/rss/index.xml',
    format: 'atom',
    charlestonFilter: true,
  },
];

const MAX_ARTICLE_AGE_DAYS = 120;
const RECENTLY_OPENED_EXPIRY_DAYS = 60;
const COMING_SOON_EXPIRY_DAYS = 120;
const GEOCODE_DELAY_MS = 500;

const areasConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'config', 'areas.json'), 'utf8'),
);

// ── Classification Keywords ────────────────────────────────────

const RECENTLY_OPENED_KEYWORDS = [
  'opened', 'now open', 'soft open', 'grand opening', 'just opened',
  'opens its doors', 'debuted', 'has opened', 'is open', 'officially open',
  'doors open', 'first look', 'opens in', 'opens on', 'opens at',
];

const COMING_SOON_KEYWORDS = [
  'coming soon', 'set to open', 'opening date', 'plans to open',
  'will open', 'anticipated', 'announces', 'slated', 'expected to open',
  'planning to open', 'under construction', 'in the works',
  'new location', 'new concept', 'new spot', 'headed to', 'coming to',
  'moving to', 'taking over', 'replace', 'under renovation',
];

const VENUE_KEYWORDS = [
  'restaurant', 'bar', 'cafe', 'tavern', 'lounge', 'brewery', 'pub',
  'hotel', 'bistro', 'eatery', 'pizzeria', 'taqueria', 'bakery',
  'coffee', 'rooftop', 'grill', 'kitchen', 'food hall', 'wine bar',
  'cocktail', 'sushi', 'ramen', 'steakhouse', 'seafood',
];

// ── Helpers ─────────────────────────────────────────────────────

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      return await response.text();
    } catch (err) {
      if (i === retries - 1) throw err;
      await delay(1000 * (i + 1));
    }
  }
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&#8217;/g, '\u2019')
    .replace(/&#8211;/g, '\u2013')
    .replace(/&#8212;/g, '\u2014')
    .replace(/&#8230;/g, '\u2026');
}

function stripHtml(str) {
  return str.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// ── RSS / Atom Parsing ──────────────────────────────────────────

function parseRssItems(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = (block.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/) || [])[1] || '';
    const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || '';
    const pubDate = (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || '';
    const desc = (block.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/) || [])[1] || '';
    const source = (block.match(/<source[^>]*>(.*?)<\/source>/) || [])[1] || '';
    items.push({
      title: decodeHtmlEntities(title.trim()),
      link: link.trim(),
      pubDate: pubDate.trim(),
      description: decodeHtmlEntities(stripHtml(desc.trim())),
      source: decodeHtmlEntities(source.trim()),
    });
  }
  return items;
}

function parseAtomEntries(xml) {
  const items = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
  let match;
  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = (block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || '';
    const link = (block.match(/<link[^>]*href="([^"]*)"/) || [])[1] || '';
    const updated = (block.match(/<updated>(.*?)<\/updated>/) || [])[1] || '';
    const published = (block.match(/<published>(.*?)<\/published>/) || [])[1] || '';
    const summary = (block.match(/<summary[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/summary>/) || [])[1] || '';
    items.push({
      title: decodeHtmlEntities(title.trim()),
      link: link.trim(),
      pubDate: (published || updated).trim(),
      description: decodeHtmlEntities(stripHtml(summary.trim())),
      source: 'Eater Carolinas',
    });
  }
  return items;
}

// ── Article Analysis ────────────────────────────────────────────

function isCharlestonRelated(title, description) {
  const text = `${title} ${description}`.toLowerCase();
  const markers = [
    'charleston', 'chs', 'mount pleasant', 'mt pleasant', 'james island',
    'daniel island', 'west ashley', 'north charleston', 'folly',
    'summerville', 'johns island', "sullivan's island", 'sullivans island',
    'shem creek', 'king street', 'isle of palms', 'park circle',
  ];
  return markers.some(m => text.includes(m));
}

function isVenueRelated(title, description) {
  const text = `${title} ${description}`.toLowerCase();
  return VENUE_KEYWORDS.some(kw => text.includes(kw));
}

function classifyArticle(title, description) {
  const text = `${title} ${description}`.toLowerCase();
  const openScore = RECENTLY_OPENED_KEYWORDS.reduce(
    (n, kw) => n + (text.includes(kw) ? 1 : 0), 0,
  );
  const soonScore = COMING_SOON_KEYWORDS.reduce(
    (n, kw) => n + (text.includes(kw) ? 1 : 0), 0,
  );
  if (openScore === 0 && soonScore === 0) return null;
  return openScore >= soonScore ? 'Recently Opened' : 'Coming Soon';
}

function extractRestaurantName(title) {
  const cleaned = title
    .replace(/\s*[-\u2013\u2014|]\s*(The Post and Courier|Post and Courier|Charleston City Paper|Eater Carolinas|Eater|CHStoday|Live 5 News|WCSC|WCIV|ABC News 4|Charleston Scene|Resy|Google News|WhatNow|What Now Charleston|SCBiz|WCBD News 2|Palmetto Life|Southern Living|The Food Section|Bravo|Page Six|Savannah Morning News|Greenville Online|Delaware North Newsroom).*$/i, '')
    .trim();

  const patterns = [
    /^(.+?)\s+(?:opens?|opened|to open|is opening|set to open|coming soon)\b/i,
    /^(?:new\s+(?:restaurant|bar|brewery|cafe|eatery|spot)\s+)(.+?)\s+(?:opens?|coming|set|headed)\b/i,
    /^(.+?)\s+(?:announces|debuts?|launches)\b/i,
    /(?:first look|inside|a look inside|review)\s*:?\s*(.+?)(?:\s+in\s+|\s+on\s+|\s*,|\s*$)/i,
    /^(.+?)\s+(?:brings?|serves?|offers?)\s/i,
    /^(.+?)\s+(?:to replace|replacing|taking over)\b/i,
    /^(.+?)\s+is\s+charleston'?s?\s+newest\b/i,
    /(?:what to expect at|what to know about|check out)\s+(.+?)(?:\s*$|\s*,)/i,
    /^(.+?)\s+(?:coming to|headed to|moving to)\b/i,
    /^(.+?)\s+(?:sets?\s+opening|posts?\s+job|adds?)\b/i,
    /^new\s+(.+?)\s+(?:in|on|at|near)\s+/i,
  ];

  for (const pattern of patterns) {
    const m = cleaned.match(pattern);
    if (m && m[1]) {
      let name = m[1].replace(/^["'\u201C\u201D]|["'\u201C\u201D]$/g, '').trim();
      name = name.replace(/^(Popular|Highly anticipated|New|Beloved|Shuttered|Longtime)\s+/i, '').trim();
      if (name.length > 2 && name.length < 80) return name;
    }
  }
  return null;
}

function extractDescription(title, description, classification) {
  const prefix = classification === 'Recently Opened' ? 'New opening' : 'Coming soon';
  let cleaned = (description || '')
    .replace(/<!\[CDATA\[/g, '')
    .replace(/\]\]>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || cleaned.length < 10) {
    cleaned = title.replace(/<[^>]+>/g, '').trim();
  }
  if (!cleaned || cleaned.length < 5) {
    return `${prefix} in the Charleston area.`;
  }
  return cleaned.length > 200
    ? cleaned.substring(0, 200).replace(/\s+\S*$/, '') + '...'
    : cleaned;
}

function isWithinDays(dateStr, days) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
  return diff >= 0 && diff <= days;
}

// ── Grok API Discovery ──────────────────────────────────────────

const { webSearch, chat, getApiKey } = require('./utils/llm-client');

const VALID_AREAS = areasConfig.map(a => a.name);

async function discoverViaGrok() {
  if (!getApiKey()) {
    log('  Grok API skipped: no GROK_API_KEY');
    return [];
  }

  const prompt = `Do a deep research on restaurants, bars, breweries, cafes, bakeries, and food/drink concepts in the Charleston, South Carolina metro area that are either:
1. Coming soon — announced, under construction, permits filed, or planning to open within the next 3 months
2. Recently opened — opened within the last 90 days

Search Charleston food blogs, Post and Courier, Charleston City Paper, Eater Carolinas, WhatNow Charleston, Holy City Sinner, CHStoday, Charleston CVB, Instagram announcements, Facebook posts, and local news. Include venues inside new hotel openings, food halls, and multi-tenant developments (list each concept separately).

Return ONLY a valid JSON array with no markdown fences. Each object must have:
- "name": the restaurant or bar name (exact name, not a description)
- "address": full street address if known, otherwise null
- "area": one of: ${VALID_AREAS.map(a => `"${a}"`).join(', ')}
- "classification": either "Recently Opened" or "Coming Soon"
- "description": one sentence about what it is (cuisine type, concept)
- "source": the news outlet or website where you found this information
- "expected_open": when it is scheduled to open if known (e.g. "March 2026", "Spring 2026"), otherwise null

Only include the Charleston SC metro area. No national chains unless it is their first Charleston location. Be thorough — aim for 30-50 results.`;

  log('  Calling Grok API with web_search...');

  const result = await webSearch({ prompt, timeoutMs: 120000, log });
  if (!result?.parsed || !Array.isArray(result.parsed)) {
    log('  ⚠️ Grok API returned no valid JSON array');
    return [];
  }

  const valid = result.parsed
    .filter(item => item.name && item.classification)
    .slice(0, 50)
    .map(item => ({
      restaurantName: item.name.trim(),
      classification: item.classification === 'Recently Opened' ? 'Recently Opened' : 'Coming Soon',
      grokDescription: (item.description || '').trim(),
      grokArea: VALID_AREAS.includes(item.area) ? item.area : null,
      grokAddress: (item.address || '').trim() || null,
      source: (item.source || 'Grok web search').trim(),
      expectedOpen: (item.expected_open || '').trim() || null,
      feed: 'Grok API',
    }));

  log(`  🤖 Grok API: ${result.parsed.length} results, ${valid.length} valid`);
  return valid;
}

// ── Area Assignment ─────────────────────────────────────────────

function findAreaFromCoordinates(lat, lng) {
  const matches = areasConfig.filter(area => {
    if (!area.bounds) return false;
    const { south, west, north, east } = area.bounds;
    return lat >= south && lat <= north && lng >= west && lng <= east;
  });
  if (matches.length === 0) return 'Downtown Charleston';
  if (matches.length === 1) return matches[0].name;
  let best = matches[0];
  let bestDist = Infinity;
  for (const area of matches) {
    const d = (lat - area.center.lat) ** 2 + (lng - area.center.lng) ** 2;
    if (d < bestDist) { bestDist = d; best = area; }
  }
  return best.name;
}

function findAreaFromAddress(address) {
  if (!address) return null;
  const lower = address.toLowerCase();
  for (const area of areasConfig) {
    if (lower.includes(area.name.toLowerCase())) return area.name;
  }
  if (lower.includes('folly beach')) return 'James Island';
  if (lower.includes('park circle')) return 'North Charleston';
  if (lower.includes('shem creek')) return 'Mount Pleasant';
  const zipMatch = address.match(/\b(\d{5})\b/);
  if (zipMatch) {
    for (const area of areasConfig) {
      if (area.zipCodes && area.zipCodes.includes(zipMatch[1])) return area.name;
    }
  }
  return null;
}

// ── Grok Enrichment Fallback ────────────────────────────────────

async function enrichViaGrok(name, address) {
  if (!getApiKey()) return null;
  const areaList = VALID_AREAS.map(a => `"${a}"`).join(', ');

  const result = await chat({
    messages: [{
      role: 'user',
      content: `For the restaurant/bar "${name}" in Charleston, SC${address ? ` (address: ${address})` : ''}:\nReturn a JSON object with:\n- "area": which Charleston neighborhood? One of: ${areaList}\n- "address": the full street address\n- "venueType": "restaurant", "bar", "cafe", "brewery", or "bakery"\n- "description": one sentence about what it is\n\nOnly return the JSON object, nothing else.`,
    }],
    model: 'grok-3-mini-fast',
    timeoutMs: 30000,
    log: (msg) => logVerbose(msg),
  });

  if (!result?.parsed) return null;
  if (result.parsed.area && VALID_AREAS.includes(result.parsed.area)) {
    log(`  🤖 Grok enriched "${name}" → area: ${result.parsed.area}, type: ${result.parsed.venueType || '?'}`);
    return result.parsed;
  }
  logVerbose(`  Grok returned invalid area for "${name}": ${result.parsed.area}`);
  return null;
}

// ── Google Places Geocoding ─────────────────────────────────────

async function geocodeViaPlaces(name, address) {
  const searchTerm = address ? `${name} ${address}` : `"${name}" charleston sc`;
  const query = encodeURIComponent(searchTerm);
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&key=${GOOGLE_MAPS_API_KEY}`;
  try {
    const text = await fetchWithRetry(url);
    const data = JSON.parse(text);
    if (data.status === 'OK' && data.results?.length > 0) {
      const r = data.results[0];
      const result = {
        placeId: r.place_id,
        name: r.name,
        address: r.formatted_address,
        lat: r.geometry?.location?.lat,
        lng: r.geometry?.location?.lng,
        types: r.types || [],
        website: null,
      };
      if (r.place_id) {
        result.website = await fetchPlaceWebsite(r.place_id);
      }
      return result;
    }
    logVerbose(`  Geocode "${name}": ${data.status} (${data.results?.length || 0} results)`);
  } catch (err) {
    log(`  ❌ Geocode error for "${name}": ${err.message}`);
  }
  return null;
}

function cleanWebsiteUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    [...u.searchParams.keys()]
      .filter(k => k.startsWith('utm_'))
      .forEach(k => u.searchParams.delete(k));
    return u.toString();
  } catch {
    return rawUrl;
  }
}

async function fetchPlacePhoto(placeId, spotId) {
  const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=photos&key=${GOOGLE_MAPS_API_KEY}`;
  try {
    const text = await fetchWithRetry(detailUrl);
    const data = JSON.parse(text);
    if (data.status !== 'OK' || !data.result?.photos?.length) return null;
    const photoRef = data.result.photos[0].photo_reference;
    const photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${photoRef}&key=${GOOGLE_MAPS_API_KEY}`;
    const res = await fetch(photoUrl, { redirect: 'follow' });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const destDir = path.join(__dirname, '..', 'public', 'spots');
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    const dest = path.join(destDir, `${spotId}.jpg`);
    fs.writeFileSync(dest, buffer);
    return `/spots/${spotId}.jpg`;
  } catch {
    return null;
  }
}

async function fetchPlaceWebsite(placeId) {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=website&key=${GOOGLE_MAPS_API_KEY}`;
  try {
    const text = await fetchWithRetry(url);
    const data = JSON.parse(text);
    if (data.status === 'OK' && data.result?.website) {
      return cleanWebsiteUrl(data.result.website);
    }
  } catch (err) {
    logVerbose(`  Place Details error for ${placeId}: ${err.message}`);
  }
  return null;
}

// ── Deduplication ───────────────────────────────────────────────

function isDuplicate(candidate, existingSpots, existingVenues) {
  const candidateTitle = candidate.placeName.toLowerCase().trim();

  for (const spot of existingSpots) {
    const spotTitle = (spot.title || '').toLowerCase().trim();
    if (spotTitle === candidateTitle) {
      logVerbose(`  Duplicate by title: "${candidate.placeName}" matches spot #${spot.id}`);
      return true;
    }
    if (spotTitle.length > 5 && candidateTitle.length > 5) {
      const shorter = spotTitle.length < candidateTitle.length ? spotTitle : candidateTitle;
      const longer = spotTitle.length < candidateTitle.length ? candidateTitle : spotTitle;
      if (longer.includes(shorter) && shorter.length / longer.length > 0.5) {
        logVerbose(`  Duplicate by substring: "${candidate.placeName}" ~ "${spot.title}"`);
        return true;
      }
    }
  }

  if (candidate.placeId) {
    for (const venue of existingVenues) {
      if (venue.id === candidate.placeId) {
        logVerbose(`  Duplicate by Place ID: "${candidate.placeName}" matches venue "${venue.name}"`);
        return true;
      }
    }
    // Also check if any existing spot already references this venue
    for (const spot of existingSpots) {
      if (spot.venue_id === candidate.placeId) {
        logVerbose(`  Duplicate by venue_id: "${candidate.placeName}" matches spot #${spot.id} "${spot.title}"`);
        return true;
      }
    }
  }

  if (candidate.lat && candidate.lng) {
    for (const spot of existingSpots) {
      if (!spot.lat || !spot.lng) continue;
      if (spot.type !== candidate.classification) continue;
      const dist = Math.sqrt(
        (spot.lat - candidate.lat) ** 2 + (spot.lng - candidate.lng) ** 2,
      );
      if (dist < 0.0002) {
        logVerbose(`  Duplicate by proximity: "${candidate.placeName}" near spot #${spot.id} "${spot.title}"`);
        return true;
      }
    }
  }

  return false;
}

// ── Cleanup ─────────────────────────────────────────────────────

function cleanupExpiredSpots() {
  const database = db.getDb();
  const now = new Date();

  const recentlyOpenedExpiry = new Date(now.getTime() - RECENTLY_OPENED_EXPIRY_DAYS * 86400000).toISOString();
  const comingSoonExpiry = new Date(now.getTime() - COMING_SOON_EXPIRY_DAYS * 86400000).toISOString();

  const roCount = database.prepare(
    "SELECT COUNT(*) as cnt FROM spots WHERE type = 'Recently Opened' AND source = 'automated' AND last_update_date < ? AND manual_override = 0",
  ).get(recentlyOpenedExpiry.split('T')[0]).cnt;

  const csCount = database.prepare(
    "SELECT COUNT(*) as cnt FROM spots WHERE type = 'Coming Soon' AND source = 'automated' AND last_update_date < ? AND manual_override = 0",
  ).get(comingSoonExpiry.split('T')[0]).cnt;

  if (roCount > 0) {
    database.prepare(
      "DELETE FROM spots WHERE type = 'Recently Opened' AND source = 'automated' AND last_update_date < ? AND manual_override = 0",
    ).run(recentlyOpenedExpiry.split('T')[0]);
    log(`  🗑️  Removed ${roCount} expired "Recently Opened" spots (older than ${RECENTLY_OPENED_EXPIRY_DAYS} days)`);
  }

  if (csCount > 0) {
    database.prepare(
      "DELETE FROM spots WHERE type = 'Coming Soon' AND source = 'automated' AND last_update_date < ? AND manual_override = 0",
    ).run(comingSoonExpiry.split('T')[0]);
    log(`  🗑️  Removed ${csCount} expired "Coming Soon" spots (older than ${COMING_SOON_EXPIRY_DAYS} days)`);
  }

  if (roCount === 0 && csCount === 0) {
    log('  ✅ No expired spots to clean up');
  }

  return roCount + csCount;
}

// ── Telegram Notification ───────────────────────────────────────

async function sendTelegramSummary(stats) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT) {
    log('  Telegram skipped: missing TELEGRAM_BOT_TOKEN or TELEGRAM_ADMIN_CHAT_ID');
    return;
  }

  const lines = [
    '🔍 Nightly Opening Discovery',
    '',
    `📰 RSS articles: ${stats.articlesScanned}`,
    `🤖 Grok results: ${stats.grokCount || 0}`,
    `🎯 Candidates: ${stats.candidatesFound}`,
    `📍 Geocoded: ${stats.geocoded}`,
    `✅ New spots: ${stats.insertedCount}`,
  ];

  if (stats.insertedNames.length > 0) {
    lines.push('');
    for (const name of stats.insertedNames) {
      lines.push(name);
    }
  }

  if (stats.cleanedUp > 0) {
    lines.push('', `🗑️ Expired spots removed: ${stats.cleanedUp}`);
  }

  lines.push('', `⏱️ Completed in ${stats.elapsed}s`);

  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT, text: lines.join('\n'), disable_web_page_preview: true }),
    });
    const data = await res.json();
    if (data.ok) {
      log('  📱 Telegram notification sent');
    } else {
      log(`  ⚠️ Telegram response: ${JSON.stringify(data)}`);
    }
  } catch (err) {
    log(`  ❌ Telegram failed: ${err.message}`);
  }
}

// ── Main Pipeline ───────────────────────────────────────────────

(async () => {
  const { acquire: acquireLock, release: releaseLock } = require('./utils/pipeline-lock');
  const lock = acquireLock('discover-openings');
  if (!lock.acquired) {
    log(`🔒 Pipeline locked by ${lock.holder} (PID ${lock.pid}). Waiting for next run.`);
    process.exit(0);
  }

  const startTime = Date.now();
  log('🔍 Nightly Restaurant Opening Discovery');
  log(`   ${new Date().toISOString()}\n`);

  // Step 1: Fetch RSS feeds
  log('Step 1: Fetching RSS feeds...');
  const allArticles = [];

  for (const feed of RSS_FEEDS) {
    try {
      const xml = await fetchWithRetry(feed.url);
      let items = feed.format === 'atom' ? parseAtomEntries(xml) : parseRssItems(xml);

      if (feed.charlestonFilter) {
        const before = items.length;
        items = items.filter(a => isCharlestonRelated(a.title, a.description));
        log(`  📰 ${feed.name}: ${before} total, ${items.length} Charleston-related`);
      } else {
        log(`  📰 ${feed.name}: ${items.length} articles`);
      }

      allArticles.push(...items.map(a => ({ ...a, feed: feed.name })));
    } catch (err) {
      log(`  ❌ ${feed.name} failed: ${err.message}`);
    }
  }

  // Deduplicate articles by link URL across feeds
  const seenLinks = new Set();
  const dedupedArticles = allArticles.filter(a => {
    if (!a.link || seenLinks.has(a.link)) return false;
    seenLinks.add(a.link);
    return true;
  });

  log(`  Combined: ${allArticles.length} raw, ${dedupedArticles.length} unique articles\n`);

  if (dedupedArticles.length === 0) {
    log('⚠️  No articles found from any feed. Exiting.');
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    await sendTelegramSummary({ articlesScanned: 0, candidatesFound: 0, geocoded: 0, insertedCount: 0, insertedNames: [], cleanedUp: 0, elapsed });
    releaseLock();
    db.closeDb();
    return;
  }

  // Step 2: Classify and extract
  log('Step 2: Classifying articles...');
  const candidates = [];

  for (const article of dedupedArticles) {
    if (!isWithinDays(article.pubDate, MAX_ARTICLE_AGE_DAYS)) {
      logVerbose(`  Skip (too old): ${article.title}`);
      continue;
    }
    if (!isCharlestonRelated(article.title, article.description)) {
      logVerbose(`  Skip (not Charleston): ${article.title}`);
      continue;
    }

    const classification = classifyArticle(article.title, article.description);
    if (!classification) {
      logVerbose(`  Skip (no classification): ${article.title}`);
      continue;
    }

    const restaurantName = extractRestaurantName(article.title);
    if (!restaurantName) {
      logVerbose(`  Skip (no name extracted): ${article.title}`);
      continue;
    }

    if (!isVenueRelated(article.title, article.description)) {
      logVerbose(`  Skip (not venue-related): ${article.title}`);
    }

    candidates.push({
      ...article,
      classification,
      restaurantName,
    });
  }

  log(`  ${candidates.length} candidates with names extracted\n`);

  // Step 2b: Grok API Discovery
  log('Step 2b: Grok API web search discovery...');
  const grokResults = await discoverViaGrok();

  if (grokResults.length > 0) {
    candidates.push(...grokResults);
    log(`  Combined: ${candidates.length} total candidates (RSS + Grok)\n`);
  }

  if (candidates.length === 0) {
    log('ℹ️  No new restaurant openings found from any source.');
    log('\nStep 6: Cleanup expired spots...');
    const cleanedUp = cleanupExpiredSpots();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`\n✨ Discovery complete in ${elapsed}s (0 new spots)`);
    await sendTelegramSummary({ articlesScanned: dedupedArticles.length, grokCount: grokResults.length, candidatesFound: 0, geocoded: 0, insertedCount: 0, insertedNames: [], cleanedUp, elapsed });
    releaseLock();
    db.closeDb();
    return;
  }

  // Deduplicate candidates by restaurant name
  const seen = new Set();
  const uniqueCandidates = candidates.filter(c => {
    const key = c.restaurantName.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  log(`  ${uniqueCandidates.length} unique candidates after dedup\n`);

  // Step 3: Geocode via Google Places
  log('Step 3: Geocoding via Google Places API...');
  const geocoded = [];

  for (const candidate of uniqueCandidates) {
    await delay(GEOCODE_DELAY_MS);
    const result = await geocodeViaPlaces(candidate.restaurantName, candidate.grokAddress);
    if (result) {
      geocoded.push({ ...candidate, ...result, placeName: result.name });
      const websiteNote = result.website ? ` | ${result.website}` : ' | no website';
      log(`  ✅ ${candidate.restaurantName} → ${result.name} (${result.address})${websiteNote}`);
    } else if (candidate.grokAddress) {
      // Retry with just the address if name-based search failed
      await delay(GEOCODE_DELAY_MS);
      const fallback = await geocodeViaPlaces(candidate.grokAddress);
      if (fallback) {
        geocoded.push({ ...candidate, ...fallback, placeName: candidate.restaurantName });
        log(`  ✅ ${candidate.restaurantName} → geocoded via address (${fallback.address})`);
      } else {
        log(`  ❌ ${candidate.restaurantName} → not found (tried name + address)`);
      }
    } else {
      log(`  ❌ ${candidate.restaurantName} → not found`);
    }
  }

  log(`\n  ${geocoded.length}/${uniqueCandidates.length} geocoded successfully\n`);

  if (geocoded.length === 0) {
    log('ℹ️  No restaurants could be geocoded. Exiting.');
    log('\nStep 6: Cleanup expired spots...');
    const cleanedUp = cleanupExpiredSpots();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`\n✨ Discovery complete in ${elapsed}s (0 new spots)`);
    await sendTelegramSummary({ articlesScanned: dedupedArticles.length, grokCount: grokResults.length, candidatesFound: uniqueCandidates.length, geocoded: 0, insertedCount: 0, insertedNames: [], cleanedUp, elapsed });
    releaseLock();
    db.closeDb();
    return;
  }

  // Step 4: Deduplicate against database + watchlist
  log('Step 4: Deduplicating against database...');
  const existingSpots = db.spots.getAll({});
  const existingVenues = db.getDb().prepare('SELECT * FROM venues').all();
  const excludedNames = new Set(
    db.watchlist.getExcluded().map(w => (w.name || '').toLowerCase().trim()).filter(Boolean)
  );

  const newSpots = geocoded.filter(c => {
    if (excludedNames.has(c.placeName.toLowerCase().trim())) {
      log(`  🚫 Watchlist excluded: ${c.placeName}`);
      return false;
    }
    return !isDuplicate(c, existingSpots, existingVenues);
  });
  log(`  ${newSpots.length} new spots after database dedup\n`);

  // Step 5: Insert new spots
  log('Step 5: Inserting new spots...');
  let insertedCount = 0;
  const insertedNames = [];

  for (const spot of newSpots) {
    let area = findAreaFromAddress(spot.address) ||
               (spot.grokArea) ||
               findAreaFromCoordinates(spot.lat, spot.lng);

    let description = spot.grokDescription || extractDescription(spot.title, spot.description, spot.classification);
    if (spot.expectedOpen && description) {
      description = `${description} Expected: ${spot.expectedOpen}.`;
    } else if (spot.expectedOpen) {
      description = `Expected to open: ${spot.expectedOpen}.`;
    }

    // Grok enrichment fallback for missing area or description
    if (!area || area === 'Unknown' || area === 'Downtown Charleston' && !spot.address?.toLowerCase().includes('charleston')) {
      const enriched = await enrichViaGrok(spot.placeName, spot.address);
      if (enriched) {
        if (enriched.area && VALID_AREAS.includes(enriched.area)) area = enriched.area;
        if (!description && enriched.description) description = enriched.description;
        if (!spot.address && enriched.address) spot.address = enriched.address;
      }
    }

    // Prefer the original Grok name over Google's geocoded name
    // (Google often returns a different business at the same address)
    const spotTitle = spot.restaurantName || spot.placeName;

    const today = new Date().toISOString().split('T')[0];

    // Link to existing venue if we got a Place ID match
    let venueId = null;
    if (spot.placeId) {
      const matchedVenue = existingVenues.find(v => v.id === spot.placeId);
      if (matchedVenue) {
        venueId = matchedVenue.id;
        if (!area || area === 'Downtown Charleston') {
          area = matchedVenue.area || area;
        }
        log(`  🔗 Linked to venue: ${matchedVenue.name} (${matchedVenue.id})`);
      }
    }

    try {
      const newId = db.spots.insert({
        venue_id: venueId,
        title: spotTitle,
        type: spot.classification,
        source: 'automated',
        status: 'approved',
        description,
        source_url: spot.website || null,
        lat: spot.lat,
        lng: spot.lng,
        area: area || 'Downtown Charleston',
        last_update_date: today,
      });

      if (spot.placeId) {
        const photoPath = await fetchPlacePhoto(spot.placeId, newId);
        if (photoPath) {
          db.getDb().prepare('UPDATE spots SET photo_url = ? WHERE id = ?').run(photoPath, newId);
          log(`  📷 Photo downloaded for ${spotTitle}`);
        }
      }

      insertedCount++;
      insertedNames.push(`${spot.classification === 'Recently Opened' ? '🆕' : '🔜'} ${spotTitle} (${area || 'Downtown Charleston'})`);
      log(`  ✅ #${newId}: ${spotTitle} [${spot.classification}] → ${area || 'Downtown Charleston'}`);

      const secondaryTypes = detectSecondaryTypes(`${spotTitle} ${description}`, spot.classification);
      for (const secType of secondaryTypes) {
        try {
          const secId = db.spots.insert({
            venue_id: venueId,
            title: spotTitle,
            type: secType,
            source: 'automated',
            status: 'approved',
            description,
            source_url: spot.website || null,
            lat: spot.lat,
            lng: spot.lng,
            area: area || 'Downtown Charleston',
            last_update_date: today,
          });
          log(`  🏷️  #${secId}: ${spotTitle} [${secType}] (cross-tagged)`);
        } catch (secErr) {
          log(`  ⚠️  Cross-tag "${secType}" failed for "${spotTitle}": ${secErr.message}`);
        }
      }
    } catch (err) {
      log(`  ❌ Failed to insert "${spotTitle}": ${err.message}`);
    }
  }

  log(`\n  Inserted ${insertedCount} new spot(s)\n`);

  // Step 6: Cleanup expired spots
  log('Step 6: Cleanup expired spots...');
  const cleanedUp = cleanupExpiredSpots();

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`\n✨ Discovery complete in ${elapsed}s`);
  log(`   Articles scanned: ${dedupedArticles.length}`);
  log(`   Candidates found: ${uniqueCandidates.length}`);
  log(`   Geocoded: ${geocoded.length}`);
  log(`   New spots inserted: ${insertedCount}`);

  if (insertedNames.length > 0) {
    log('\n   New spots:');
    for (const name of insertedNames) {
      log(`   ${name}`);
    }
  }

  // Step 7: Telegram notification
  log('\nStep 7: Sending Telegram notification...');
  await sendTelegramSummary({
    articlesScanned: dedupedArticles.length,
    grokCount: grokResults.length,
    candidatesFound: uniqueCandidates.length,
    geocoded: geocoded.length,
    insertedCount,
    insertedNames,
    cleanedUp,
    elapsed,
  });

  log(`\nLog saved to ${logPath}`);
  releaseLock();
  db.closeDb();
})().catch(err => {
  console.error('Fatal:', err);
  try { require('./utils/pipeline-lock').release(); } catch {}
  process.exit(1);
});
