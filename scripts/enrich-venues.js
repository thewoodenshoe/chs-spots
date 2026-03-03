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

  return `I need you to find contact information for these venues in Charleston, SC.

For each venue, search the web and return:
- "website": the venue's official website URL. If it's a landmark, park, beach access, or public place without its own website, find the best relevant page (e.g. a tourism board page, city page, or well-known guide page about that place). Only use "n/a" if absolutely nothing relevant exists.
- "phone": the venue's phone number in (XXX) XXX-XXXX format. If it's a landmark, public beach, park, or attraction that genuinely has no phone number, use "n/a".

Return a JSON array with one object per venue:
[
  { "index": 0, "website": "https://...", "phone": "(843) 555-1234" },
  { "index": 1, "website": "https://...", "phone": "n/a" }
]

Only include fields the venue is missing (check needsWebsite / needsPhone).
Do NOT invent URLs — only return URLs you found via web search.

Venues to look up:
${JSON.stringify(items, null, 2)}`;
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

  const database = db.getDb();
  let updated = 0;
  const errors = [];

  for (const item of items) {
    const venue = batch[item.index];
    if (!venue) {
      errors.push(`Invalid index ${item.index}`);
      continue;
    }

    const sets = [];
    const vals = [];

    if (item.website && !venue.website) {
      const url = item.website.trim();
      if (url !== 'n/a' && url.startsWith('http')) {
        sets.push('website = ?');
        vals.push(url);
      } else if (url === 'n/a') {
        sets.push('website = ?');
        vals.push('n/a');
      }
    }

    if (item.phone && !venue.phone) {
      const ph = item.phone.trim();
      sets.push('phone = ?');
      vals.push(ph);
    }

    if (sets.length === 0) continue;

    sets.push('updated_at = ?');
    vals.push(new Date().toISOString());
    vals.push(venue.id);

    if (DRY_RUN) {
      console.log(`   [DRY] ${venue.name}: ${sets.join(', ')} → ${vals.slice(0, -1).join(', ')}`);
      updated++;
    } else {
      try {
        database.prepare(`UPDATE venues SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
        console.log(`   ✅ ${venue.name}: ${sets.filter(s => !s.startsWith('updated_at')).join(', ')}`);
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
