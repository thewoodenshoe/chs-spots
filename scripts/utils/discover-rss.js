/**
 * RSS/Atom feed parsing and article classification for discover-openings.
 */

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
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/').replace(/&#8217;/g, '\u2019')
    .replace(/&#8211;/g, '\u2013').replace(/&#8212;/g, '\u2014')
    .replace(/&#8230;/g, '\u2026');
}

function stripHtml(str) {
  return str.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

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

const CHARLESTON_MARKERS = [
  'charleston', 'chs', 'mount pleasant', 'mt pleasant', 'james island',
  'daniel island', 'west ashley', 'north charleston', 'folly',
  'summerville', 'johns island', "sullivan's island", 'sullivans island',
  'shem creek', 'king street', 'isle of palms', 'park circle',
];

function isCharlestonRelated(title, description) {
  const text = `${title} ${description}`.toLowerCase();
  return CHARLESTON_MARKERS.some(m => text.includes(m));
}

function classifyArticle(title, description) {
  const text = `${title} ${description}`.toLowerCase();
  const openScore = RECENTLY_OPENED_KEYWORDS.reduce((n, kw) => n + (text.includes(kw) ? 1 : 0), 0);
  const soonScore = COMING_SOON_KEYWORDS.reduce((n, kw) => n + (text.includes(kw) ? 1 : 0), 0);
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
  let cleaned = (description || '').replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned.length < 10) cleaned = title.replace(/<[^>]+>/g, '').trim();
  if (!cleaned || cleaned.length < 5) return `${prefix} in the Charleston area.`;
  return cleaned.length > 200 ? cleaned.substring(0, 200).replace(/\s+\S*$/, '') + '...' : cleaned;
}

function isWithinDays(dateStr, days) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  const diff = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
  return diff >= 0 && diff <= days;
}

function isVenueRelated(title, description) {
  const VENUE_KEYWORDS = [
    'restaurant', 'bar', 'cafe', 'tavern', 'lounge', 'brewery', 'pub',
    'hotel', 'bistro', 'eatery', 'pizzeria', 'taqueria', 'bakery',
    'coffee', 'rooftop', 'grill', 'kitchen', 'food hall', 'wine bar',
    'cocktail', 'sushi', 'ramen', 'steakhouse', 'seafood',
  ];
  const text = `${title} ${description}`.toLowerCase();
  return VENUE_KEYWORDS.some(kw => text.includes(kw));
}

module.exports = {
  delay,
  fetchWithRetry,
  parseRssItems,
  parseAtomEntries,
  isCharlestonRelated,
  classifyArticle,
  extractRestaurantName,
  extractDescription,
  isWithinDays,
  isVenueRelated,
};
