#!/usr/bin/env node
/**
 * discover-openings.js — Nightly Restaurant Opening Discovery
 *
 * Discovers new/upcoming restaurant openings in Charleston via RSS + Grok,
 * geocodes via Google Places, creates venues first (venue-first architecture),
 * then creates Coming Soon / Recently Opened spots linked to those venues.
 */

const fs = require('fs');
const path = require('path');
const db = require('./utils/db');
const { createLogger } = require('./utils/logger');
const { detectSecondaryTypes } = require('./utils/activity-tagger');
const { webSearch, getApiKey } = require('./utils/llm-client');
const { delay, fetchWithRetry, parseRssItems, parseAtomEntries,
  isCharlestonRelated, classifyArticle, extractRestaurantName,
  extractDescription, isWithinDays, isVenueRelated } = require('./utils/discover-rss');
const { VALID_AREAS, getGoogleApiKey, geocodeViaPlaces, fetchPlacePhoto,
  findAreaFromCoordinates, findAreaFromAddress, enrichViaGrok,
  isDuplicate } = require('./utils/discover-places');

const { log, warn, error, close: closeLog } = createLogger('discover-openings');

const RSS_FEEDS = [
  { name: 'Google News (openings)', url: 'https://news.google.com/rss/search?q=charleston+sc+new+restaurant+OR+bar+OR+brewery+opening+OR+opened+OR+%22coming+soon%22&hl=en-US&gl=US&ceid=US:en', format: 'rss' },
  { name: 'Google News (coming soon)', url: 'https://news.google.com/rss/search?q=charleston+sc+restaurant+OR+bar+%22coming+soon%22+OR+%22new+location%22+OR+%22set+to+open%22&hl=en-US&gl=US&ceid=US:en', format: 'rss' },
  { name: 'Google News (new venues)', url: 'https://news.google.com/rss/search?q=charleston+sc+new+restaurant+OR+brewery+OR+cafe+OR+bakery+2026&hl=en-US&gl=US&ceid=US:en', format: 'rss' },
  { name: 'WhatNow Charleston', url: 'https://whatnow.com/charleston/feed/', format: 'rss' },
  { name: 'Eater Carolinas', url: 'https://carolinas.eater.com/rss/index.xml', format: 'atom', charlestonFilter: true },
];

const MAX_ARTICLE_AGE_DAYS = 120;
const RECENTLY_OPENED_EXPIRY_DAYS = 60;
const COMING_SOON_EXPIRY_DAYS = 120;
const GEOCODE_DELAY_MS = 500;

async function discoverViaGrok() {
  if (!getApiKey()) { log('Grok API skipped: no GROK_API_KEY'); return []; }
  const instructionsPath = path.join(__dirname, '..', 'data', 'config', 'llm-instructions-coming-soon.txt');
  let prompt = fs.readFileSync(instructionsPath, 'utf8');
  prompt = prompt.replace('{AREAS_PLACEHOLDER}', VALID_AREAS.map(a => `"${a}"`).join(', '));
  log('Calling Grok API with web_search...');
  const result = await webSearch({ prompt, timeoutMs: 120000, log });
  if (!result?.parsed || !Array.isArray(result.parsed)) { warn('Grok API returned no valid JSON array'); return []; }
  const valid = result.parsed.filter(item => item.name && item.classification).slice(0, 50).map(item => ({
    restaurantName: item.name.trim(),
    classification: item.classification === 'Recently Opened' ? 'Recently Opened' : 'Coming Soon',
    grokDescription: (item.description || '').trim(),
    grokArea: VALID_AREAS.includes(item.area) ? item.area : null,
    grokAddress: (item.address || '').trim() || null,
    source: (item.source || 'Grok web search').trim(),
    expectedOpen: (item.expected_open || '').trim() || null,
    feed: 'Grok API',
  }));
  log(`Grok API: ${result.parsed.length} results, ${valid.length} valid`);
  return valid;
}

function upsertVenueFromGeocode(geocoded, area, classification, expectedOpen) {
  if (!geocoded.placeId) return null;
  const venueStatus = classification === 'Recently Opened' ? 'recently_opened' : 'coming_soon';
  db.venues.upsert({
    id: geocoded.placeId,
    name: geocoded.name,
    address: geocoded.address || null,
    lat: geocoded.lat,
    lng: geocoded.lng,
    area: area || null,
    website: geocoded.website || null,
    types: Array.isArray(geocoded.types) ? geocoded.types.join(', ') : null,
    venue_status: venueStatus,
    venue_added_at: new Date().toISOString().slice(0, 10),
  });
  if (expectedOpen) {
    db.venues.updateStatus(geocoded.placeId, venueStatus, expectedOpen);
  }
  return geocoded.placeId;
}

function ageOutOldVenueStatuses() {
  const rawDb = db.getDb();
  const threeMonthsAgo = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const aged = rawDb.prepare(
    "UPDATE venues SET venue_status = 'active', updated_at = datetime('now') WHERE venue_status = 'recently_opened' AND venue_added_at < ?",
  ).run(threeMonthsAgo);
  if (aged.changes > 0) log(`Aged out ${aged.changes} "recently_opened" venues to active`);
  return aged.changes;
}

async function sendTelegram(stats) {
  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID || '';
  if (!token || !chatId) return;
  const lines = ['Opening Discovery', '', `RSS articles: ${stats.articlesScanned}`,
    `Grok results: ${stats.grokCount || 0}`, `Candidates: ${stats.candidatesFound}`,
    `Geocoded: ${stats.geocoded}`, `New spots: ${stats.insertedCount}`];
  if (stats.insertedNames.length > 0) { lines.push(''); lines.push(...stats.insertedNames); }
  if (stats.cleanedUp > 0) lines.push('', `Expired removed: ${stats.cleanedUp}`);
  lines.push('', `Completed in ${stats.elapsed}s`);
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: lines.join('\n'), disable_web_page_preview: true }),
    });
  } catch (err) { warn(`Telegram failed: ${err.message}`); }
}

async function main() {
  const { acquire: acquireLock, release: releaseLock } = require('./utils/pipeline-lock');
  const lock = acquireLock('discover-openings');
  if (!lock.acquired) { log(`Pipeline locked by ${lock.holder}. Exiting.`); return; }
  if (!getGoogleApiKey()) { error('No Google Places API key found'); releaseLock(); return; }

  const startTime = Date.now();
  log('Nightly Restaurant Opening Discovery');

  const allArticles = [];
  for (const feed of RSS_FEEDS) {
    try {
      const xml = await fetchWithRetry(feed.url);
      let items = feed.format === 'atom' ? parseAtomEntries(xml) : parseRssItems(xml);
      if (feed.charlestonFilter) items = items.filter(a => isCharlestonRelated(a.title, a.description));
      log(`${feed.name}: ${items.length} articles`);
      allArticles.push(...items.map(a => ({ ...a, feed: feed.name })));
    } catch (err) { warn(`${feed.name} failed: ${err.message}`); }
  }

  const seenLinks = new Set();
  const articles = allArticles.filter(a => a.link && !seenLinks.has(a.link) && seenLinks.add(a.link));
  log(`Combined: ${allArticles.length} raw, ${articles.length} unique`);

  const candidates = [];
  for (const article of articles) {
    if (!isWithinDays(article.pubDate, MAX_ARTICLE_AGE_DAYS)) continue;
    if (!isCharlestonRelated(article.title, article.description)) continue;
    const classification = classifyArticle(article.title, article.description);
    if (!classification) continue;
    const restaurantName = extractRestaurantName(article.title);
    if (!restaurantName) continue;
    candidates.push({ ...article, classification, restaurantName });
  }
  log(`${candidates.length} RSS candidates`);

  const grokResults = await discoverViaGrok();
  if (grokResults.length > 0) candidates.push(...grokResults);
  log(`${candidates.length} total candidates (RSS + Grok)`);

  const seen = new Set();
  const unique = candidates.filter(c => {
    const key = c.restaurantName.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });

  log(`Geocoding ${unique.length} unique candidates...`);
  const geocoded = [];
  for (const candidate of unique) {
    await delay(GEOCODE_DELAY_MS);
    let result = await geocodeViaPlaces(candidate.restaurantName, candidate.grokAddress, log);
    if (!result && candidate.grokAddress) {
      await delay(GEOCODE_DELAY_MS);
      result = await geocodeViaPlaces(candidate.grokAddress, null, log);
      if (result) result.name = candidate.restaurantName;
    }
    if (result) {
      geocoded.push({ ...candidate, ...result, placeName: result.name });
      log(`${candidate.restaurantName} -> ${result.name} (${result.address})`);
    }
  }
  log(`${geocoded.length}/${unique.length} geocoded`);

  const existingSpots = db.spots.getAll({});
  const existingVenues = db.getDb().prepare('SELECT * FROM venues').all();
  const excludedNames = new Set(db.watchlist.getExcluded().map(w => (w.name || '').toLowerCase().trim()).filter(Boolean));
  const newSpots = geocoded.filter(c => {
    if (excludedNames.has(c.placeName.toLowerCase().trim())) return false;
    return !isDuplicate(c, existingSpots, existingVenues);
  });
  log(`${newSpots.length} new spots after dedup`);

  let insertedCount = 0;
  const insertedNames = [];
  const today = new Date().toISOString().split('T')[0];

  for (const spot of newSpots) {
    let area = findAreaFromAddress(spot.address) || spot.grokArea || findAreaFromCoordinates(spot.lat, spot.lng);
    let description = spot.grokDescription || extractDescription(spot.title, spot.description, spot.classification);
    if (spot.expectedOpen) description = `${description || ''} Expected: ${spot.expectedOpen}.`.trim();
    if (!area || area === 'Unknown') {
      const enriched = await enrichViaGrok(spot.placeName, spot.address, log);
      if (enriched) {
        if (enriched.area && VALID_AREAS.includes(enriched.area)) area = enriched.area;
        if (!description && enriched.description) description = enriched.description;
      }
    }
    const venueId = upsertVenueFromGeocode(spot, area, spot.classification, spot.expectedOpen);
    const spotTitle = spot.restaurantName || spot.placeName;
    try {
      if (spot.placeId) {
        const photoPath = await fetchPlacePhoto(spot.placeId, spotTitle);
        if (photoPath) db.venues.updatePhotoUrl(venueId, photoPath);
      }
      if (description) {
        db.getDb().prepare(
          "UPDATE venues SET submitter_name = COALESCE(submitter_name, 'discovery'), updated_at = datetime('now') WHERE id = ?",
        ).run(venueId);
      }
      insertedCount++;
      insertedNames.push(`${spot.classification === 'Recently Opened' ? 'NEW' : 'SOON'} ${spotTitle} (${area || 'Downtown Charleston'})`);
      log(`Venue ${venueId}: ${spotTitle} [${spot.classification}] -> ${area || 'Downtown Charleston'}`);
    } catch (err) { error(`Failed to process "${spotTitle}": ${err.message}`); }
  }

  log(`Processed ${insertedCount} new venue(s)`);
  const cleanedUp = ageOutOldVenueStatuses();
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`Discovery complete in ${elapsed}s`);

  await sendTelegram({ articlesScanned: articles.length, grokCount: grokResults.length,
    candidatesFound: unique.length, geocoded: geocoded.length, insertedCount, insertedNames, cleanedUp, elapsed });

  releaseLock();
  closeLog();
  db.closeDb();
}

main().catch(err => {
  console.error('Fatal:', err);
  try { require('./utils/pipeline-lock').release(); } catch { /* already released */ }
  process.exit(1);
});
