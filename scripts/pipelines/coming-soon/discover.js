#!/usr/bin/env node
'use strict';

/**
 * Coming Soon Step 1+2: RSS feeds + wide LLM web search for upcoming venues.
 * Filters for "coming soon" classification only (not recently opened).
 * Outputs: step-1-discover.json
 */
const path = require('path');
try { require('dotenv').config({ path: path.resolve(__dirname, '../../..', '.env.local') }); } catch {}

const { webSearch, getApiKey } = require('../../utils/llm-client');
const { loadPrompt } = require('../../utils/load-prompt');
const { createLogger } = require('../../utils/logger');
const { writeStepOutput, getTodayDate, getTodayLabel } = require('../shared/pipeline-io');
const { delay, fetchWithRetry, parseRssItems, parseAtomEntries,
  isCharlestonRelated, classifyArticle, extractRestaurantName } = require('../../utils/discover-rss');
const { VALID_AREAS } = require('../../utils/discover-places');

const { log, warn, close: closeLog } = createLogger('cs-discover');
const PIPELINE = 'coming-soon';

const RSS_FEEDS = [
  { name: 'Google News (openings)', url: 'https://news.google.com/rss/search?q=charleston+sc+new+restaurant+OR+bar+OR+brewery+opening+OR+opened+OR+%22coming+soon%22&hl=en-US&gl=US&ceid=US:en', format: 'rss' },
  { name: 'Google News (coming soon)', url: 'https://news.google.com/rss/search?q=charleston+sc+restaurant+OR+bar+%22coming+soon%22+OR+%22new+location%22+OR+%22set+to+open%22&hl=en-US&gl=US&ceid=US:en', format: 'rss' },
  { name: 'Google News (new venues)', url: 'https://news.google.com/rss/search?q=charleston+sc+new+restaurant+OR+brewery+OR+cafe+OR+bakery+2026&hl=en-US&gl=US&ceid=US:en', format: 'rss' },
  { name: 'WhatNow Charleston', url: 'https://whatnow.com/charleston/feed/', format: 'rss' },
  { name: 'Eater Carolinas', url: 'https://carolinas.eater.com/rss/index.xml', format: 'atom', charlestonFilter: true },
];
const MAX_ARTICLE_AGE_DAYS = 120;

async function scrapeRss() {
  const allArticles = [];
  for (const feed of RSS_FEEDS) {
    try {
      const xml = await fetchWithRetry(feed.url);
      let items = feed.format === 'atom' ? parseAtomEntries(xml) : parseRssItems(xml);
      if (feed.charlestonFilter) items = items.filter(a => isCharlestonRelated(a.title, a.description));
      log(`[rss] ${feed.name}: ${items.length} articles`);
      allArticles.push(...items.map(a => ({ ...a, feed: feed.name })));
    } catch (err) { warn(`[rss] ${feed.name} failed: ${err.message}`); }
  }
  const seenLinks = new Set();
  const unique = allArticles.filter(a => a.link && !seenLinks.has(a.link) && seenLinks.add(a.link));
  log(`[rss] ${allArticles.length} raw, ${unique.length} unique articles`);
  return unique;
}

function extractFromRss(articles) {
  const candidates = [];
  for (const article of articles) {
    const cutoff = new Date(Date.now() - MAX_ARTICLE_AGE_DAYS * 86400000);
    if (article.pubDate && new Date(article.pubDate) < cutoff) continue;
    if (!isCharlestonRelated(article.title, article.description)) continue;
    const classification = classifyArticle(article.title, article.description);
    if (classification !== 'Coming Soon') continue;
    const name = extractRestaurantName(article.title);
    if (!name) continue;
    candidates.push({
      name, classification, source: article.feed,
      description: (article.description || '').slice(0, 200),
      confidence: 60,
    });
  }
  log(`[rss] ${candidates.length} coming-soon candidates from RSS`);
  return candidates;
}

async function discoverViaLlm() {
  if (!getApiKey()) { log('[llm] No API key — skipping LLM discovery'); return { items: [], error: false }; }
  const prompt = loadPrompt('coming-soon/step-1-discover', {
    AREAS_PLACEHOLDER: VALID_AREAS.map(a => `"${a}"`).join(', '),
  });
  log('[llm] Calling Grok (wide search for coming soon)...');
  const result = await webSearch({ prompt, timeoutMs: 120000, log });
  if (!result?.parsed || !Array.isArray(result.parsed)) {
    warn('[llm] LLM returned no valid array');
    return { items: [], error: true };
  }
  log(`[llm] Found ${result.parsed.length} items`);
  return { items: result.parsed, error: false };
}

async function main() {
  const todayDate = getTodayDate();
  log(`=== Coming Soon Discover: ${getTodayLabel()} ===`);

  const articles = await scrapeRss();
  const rssCandidates = extractFromRss(articles);
  const { items: llmResults, error: llmError } = await discoverViaLlm();

  const allCandidates = [...rssCandidates];
  for (const item of llmResults) {
    if (item.name) allCandidates.push({
      name: item.name.trim(), classification: 'Coming Soon',
      description: (item.description || '').trim(), address: (item.address || '').trim() || null,
      area: VALID_AREAS.includes(item.area) ? item.area : null,
      website: (item.website || '').trim() || null, phone: (item.phone || '').trim() || null,
      source: (item.source || 'Grok').trim(), expectedOpen: (item.expected_open || '').trim() || null,
      confidence: item.confidence || 50,
    });
  }

  const seen = new Set();
  const unique = allCandidates.filter(c => {
    const key = c.name.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  log(`[discover] ${allCandidates.length} total → ${unique.length} unique candidates`);

  writeStepOutput(PIPELINE, 'step-1-discover', {
    date: todayDate, articlesScanned: articles.length,
    rssCandidates: rssCandidates.length, llmResults: llmResults.length,
    llmError, candidates: unique,
  });

  closeLog();
}

main().catch(e => { console.error('Fatal:', e); closeLog(); process.exit(1); });
