#!/usr/bin/env node
/**
 * enrich-venues.js — Fill in missing venue attributes (website, address, phone)
 *
 * Finds venues with incomplete data and uses LLM to look them up.
 * Designed to run as part of the nightly pipeline (low volume, cheap).
 *
 * Usage: node scripts/enrich-venues.js [--dry-run]
 */

const path = require('path');
const fs = require('fs');

process.env.DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', 'data', 'chs-spots.db');
const db = require('./utils/db');
const { chat, getApiKey } = require('./utils/llm-client');

const LOG_PATH = path.join(__dirname, '..', 'logs', 'enrich-venues.log');
const logStream = (() => {
  try {
    const dir = path.dirname(LOG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return fs.createWriteStream(LOG_PATH, { flags: 'a' });
  } catch { return null; }
})();

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(msg);
  if (logStream) logStream.write(line + '\n');
}

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 10;

async function main() {
  log('=== enrich-venues.js START ===');

  const apiKey = getApiKey();
  if (!apiKey) {
    log('No GROK_API_KEY set, skipping enrichment');
    return;
  }

  const database = db.getDb();

  const incomplete = database.prepare(`
    SELECT v.id, v.name, v.address, v.website, v.phone, v.lat, v.lng, v.area
    FROM venues v
    INNER JOIN spots s ON s.venue_id = v.id AND s.status = 'approved'
    WHERE (v.website IS NULL OR v.website = '')
       OR (v.address IS NULL OR v.address = '')
       OR (v.phone IS NULL OR v.phone = '')
    GROUP BY v.id
    ORDER BY COUNT(s.id) DESC
    LIMIT 30
  `).all();

  log(`Found ${incomplete.length} venues with missing attributes`);
  if (incomplete.length === 0) {
    log('=== enrich-venues.js COMPLETE (nothing to do) ===');
    return;
  }

  let enriched = 0;
  for (let i = 0; i < incomplete.length; i += BATCH_SIZE) {
    const batch = incomplete.slice(i, i + BATCH_SIZE);
    const missing = batch.map(v => ({
      id: v.id,
      name: v.name,
      address: v.address || null,
      website: v.website || null,
      phone: v.phone || null,
      area: v.area || null,
      lat: v.lat, lng: v.lng,
      needs: [
        !v.website ? 'website' : null,
        !v.address ? 'address' : null,
        !v.phone ? 'phone' : null,
      ].filter(Boolean),
    }));

    log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${missing.map(m => m.name).join(', ')}`);

    const result = await chat({
      messages: [
        {
          role: 'system',
          content: `You are a Charleston, SC local business data expert. Given venues with missing attributes, look up the correct information.

Return ONLY a JSON array. For each venue, return:
{"index": <0-based>, "website": "<url or null>", "address": "<full address or null>", "phone": "<phone or null>"}

Only fill in fields that were requested (listed in "needs"). Use null if you cannot find the information.
For websites, return the venue's own website (not Facebook/Yelp/Google). Include https://.
For addresses, use full street address with city/state.
For phone, use format (xxx) xxx-xxxx.`,
        },
        { role: 'user', content: JSON.stringify(missing) },
      ],
      temperature: 0.1,
      timeoutMs: 45000,
      retries: 1,
      apiKey,
      log,
    });

    if (!result?.parsed || !Array.isArray(result.parsed)) {
      log(`  LLM returned no usable data for this batch`);
      continue;
    }

    for (const r of result.parsed) {
      if (typeof r.index !== 'number' || r.index < 0 || r.index >= missing.length) continue;
      const venue = missing[r.index];
      const updates = {};
      if (r.website && venue.needs.includes('website')) updates.website = r.website;
      if (r.address && venue.needs.includes('address')) updates.address = r.address;
      if (r.phone && venue.needs.includes('phone')) updates.phone = r.phone;

      if (Object.keys(updates).length === 0) continue;

      if (DRY_RUN) {
        log(`  [DRY RUN] Would update ${venue.name}: ${JSON.stringify(updates)}`);
      } else {
        const setClauses = Object.keys(updates).map(k => `${k} = @${k}`);
        setClauses.push("updated_at = datetime('now')");
        database.prepare(
          `UPDATE venues SET ${setClauses.join(', ')} WHERE id = @id`
        ).run({ ...updates, id: venue.id });
        log(`  Updated ${venue.name}: ${Object.keys(updates).join(', ')}`);
      }
      enriched++;
    }
  }

  log(`Enriched ${enriched} venue(s)${DRY_RUN ? ' (dry run)' : ''}`);
  log('=== enrich-venues.js COMPLETE ===');
  if (logStream) logStream.end();
}

main().catch(err => {
  log(`ERROR: ${err.message}`);
  if (logStream) logStream.end();
  process.exit(1);
});
