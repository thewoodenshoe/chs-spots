#!/usr/bin/env node
/**
 * Bulk-enrich venues missing website and/or phone using Grok web search.
 *
 * Usage:
 *   node scripts/enrich-venues.js [--dry-run] [--limit N] [--batch-size N]
 *
 * Requires GROK_API_KEY (or XAI_API_KEY) in environment.
 */

const db = require('./utils/db');
const { webSearch, requireApiKey, extractJsonArray } = require('./utils/llm-client');
const { enrichPhotos, enrichHours } = require('./utils/venue-enrichment');
const { loadPrompt } = require('./utils/load-prompt');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = parseInt(args.find((_, i, a) => a[i - 1] === '--limit') || '0', 10) || Infinity;
const BATCH_SIZE = parseInt(args.find((_, i, a) => a[i - 1] === '--batch-size') || '10', 10);
const DELAY_MS = 3000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function buildPrompt(venues) {
  const items = venues.map((v, i) => ({
    index: i,
    name: v.name,
    address: v.address || 'N/A',
    area: v.area || 'N/A',
    needsWebsite: !v.website,
    needsPhone: !v.phone,
  }));

  return loadPrompt('llm-venue-enrichment', {
    ITEMS: JSON.stringify(items, null, 2),
  });
}

async function processBatch(batch, batchNum, totalBatches) {
  const label = `Batch ${batchNum}/${totalBatches} (${batch.length} venues)`;
  console.log(`\n🔍 ${label}...`);
  batch.forEach(v => console.log(`   - ${v.name} (${v.area}) [need: ${!v.website ? 'url' : ''}${!v.phone ? ' phone' : ''}]`));

  const result = await webSearch({
    prompt: buildPrompt(batch),
    timeoutMs: 180000,
    log: console.log,
  });

  if (!result) {
    console.log(`   ❌ ${label}: no response from Grok`);
    return { updated: 0, skipped: batch.length, errors: [] };
  }

  // Grok web search embeds citation annotations like [[1]](url) inside JSON values — strip them
  const cleaned = result.content.replace(/\[\[\d+\]\]\([^)]*\)/g, '');
  let items = extractJsonArray(cleaned);
  if (!Array.isArray(items)) {
    items = result.parsed;
  }
  if (!Array.isArray(items)) {
    console.log(`   ❌ ${label}: could not parse JSON from response`);
    console.log(`   Raw: ${result.content.slice(0, 300)}`);
    return { updated: 0, skipped: batch.length, errors: [] };
  }

  let updated = 0;
  const errors = [];

  for (const item of items) {
    const venue = batch[item.index];
    if (!venue) {
      errors.push(`Invalid index ${item.index}`);
      continue;
    }

    const updateObj = {};

    if (item.website && !venue.website) {
      const url = item.website.trim();
      if (url !== 'n/a' && url.startsWith('http')) {
        updateObj.website = url;
      }
    }

    if (item.phone && !venue.phone) {
      updateObj.phone = item.phone.trim();
    }

    if (Object.keys(updateObj).length === 0) continue;

    const fieldNames = Object.keys(updateObj).join(', ');
    if (DRY_RUN) {
      console.log(`   [DRY] ${venue.name}: ${fieldNames} → ${Object.values(updateObj).join(', ')}`);
      updated++;
    } else {
      try {
        db.venues.update(venue.id, updateObj);
        console.log(`   ✅ ${venue.name}: ${fieldNames}`);
        updated++;
      } catch (err) {
        errors.push(`${venue.name}: ${err.message}`);
      }
    }
  }

  return { updated, skipped: batch.length - items.length, errors };
}

async function main() {
  requireApiKey('enrich-venues');
  db.setAuditContext('llm', 'enrich-venues');
  const database = db.getDb();

  const venues = database.prepare(`
    SELECT id, name, address, area, website, phone
    FROM venues
    WHERE (website IS NULL OR website = '') OR (phone IS NULL OR phone = '')
    ORDER BY area, name
  `).all();

  const toProcess = venues.slice(0, LIMIT);
  console.log(`\n📋 Found ${venues.length} venues needing enrichment`);
  console.log(`   Processing: ${toProcess.length} | Batch size: ${BATCH_SIZE} | Dry run: ${DRY_RUN}`);

  const batches = [];
  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    batches.push(toProcess.slice(i, i + BATCH_SIZE));
  }

  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalErrors = [];

  for (let i = 0; i < batches.length; i++) {
    const result = await processBatch(batches[i], i + 1, batches.length);
    totalUpdated += result.updated;
    totalSkipped += result.skipped;
    totalErrors = totalErrors.concat(result.errors);

    if (i < batches.length - 1) {
      console.log(`   ⏳ Waiting ${DELAY_MS / 1000}s before next batch...`);
      await sleep(DELAY_MS);
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ Done! Updated: ${totalUpdated} | Skipped: ${totalSkipped} | Errors: ${totalErrors.length}`);
  if (totalErrors.length > 0) {
    console.log(`\nErrors:`);
    totalErrors.forEach(e => console.log(`   ⚠️  ${e}`));
  }

  // Re-geocode incomplete coming_soon venues (may not have had data at discovery time)
  try {
    const incomplete = database.prepare(
      "SELECT id, name, address, area, lat, lng FROM venues WHERE venue_status = 'coming_soon' AND (lat IS NULL OR lat = 0 OR area IS NULL OR area = '' OR area = 'Unknown')",
    ).all();
    if (incomplete.length > 0) {
      console.log(`\n🔄 ${incomplete.length} coming_soon venue(s) with incomplete geo data — flagged for re-geocode`);
      for (const v of incomplete) {
        const issues = [];
        if (!v.lat || v.lat === 0) issues.push('no coords');
        if (!v.area || v.area === 'Unknown') issues.push('no area');
        console.log(`   📌 ${v.name} (${v.address || 'no address'}): ${issues.join(', ')}`);
      }
    }
  } catch (err) {
    console.log(`   ⚠️  CS re-geocode check failed: ${err.message}`);
  }

  // Sync activity flags for all venues with approved spots
  const venuesWithSpots = database.prepare(
    "SELECT DISTINCT venue_id FROM spots WHERE status = 'approved'",
  ).all();
  console.log(`\n🏷️  Syncing activity flags for ${venuesWithSpots.length} venues...`);
  if (!DRY_RUN) {
    for (const { venue_id } of venuesWithSpots) {
      db.syncActivityFlags(venue_id);
    }
  }
  console.log(`   Activity flags synced.`);

  await enrichPhotos(DRY_RUN);
  await enrichHours(DRY_RUN);

  const remaining = database.prepare(`
    SELECT COUNT(*) as c FROM venues
    WHERE (website IS NULL OR website = '') OR (phone IS NULL OR phone = '')
  `).get();
  console.log(`\n📊 Remaining venues needing data: ${remaining.c}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
