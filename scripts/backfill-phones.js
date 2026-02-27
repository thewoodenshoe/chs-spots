/**
 * One-time backfill script: looks up phone numbers for venues
 * that don't have one yet, using Grok API web search.
 *
 * Usage: node scripts/backfill-phones.js [--limit N] [--dry-run]
 */

const { getDb: initDb } = require('./utils/db');
const { webSearch } = require('./utils/llm-client');
const { log } = require('./utils/logger');

const BATCH_SIZE = 10;
const DELAY_BETWEEN_BATCHES_MS = 2000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseArgs() {
  const args = process.argv.slice(2);
  let limit = Infinity;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) limit = parseInt(args[i + 1], 10);
    if (args[i] === '--dry-run') dryRun = true;
  }
  return { limit, dryRun };
}

async function lookupPhones(venues) {
  const names = venues.map(v => `- ${v.name} (${v.address || v.area || 'Charleston, SC'})`).join('\n');
  const prompt = `Find the phone number for each of these Charleston, SC restaurants/venues. Return ONLY a JSON array of objects with "name" and "phone" fields. If you cannot find a phone number, set phone to null.\n\n${names}`;

  const result = await webSearch({
    query: prompt,
    log: (msg) => log('backfill-phones', msg),
    timeoutMs: 30000,
  });

  if (!result || !result.parsed) return [];
  const arr = Array.isArray(result.parsed) ? result.parsed : [];
  return arr.filter(r => r.phone && typeof r.phone === 'string');
}

function normalizePhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits[0] === '1') return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return phone.trim();
}

async function main() {
  const { limit, dryRun } = parseArgs();
  const db = initDb();

  const venues = db.prepare(`
    SELECT id, name, address, area FROM venues
    WHERE (phone IS NULL OR phone = '')
    ORDER BY name
  `).all();

  const total = Math.min(venues.length, limit);
  log('backfill-phones', `Found ${venues.length} venues without phone. Processing ${total}.${dryRun ? ' (DRY RUN)' : ''}`);

  let updated = 0;
  let failed = 0;

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = venues.slice(i, Math.min(i + BATCH_SIZE, total));
    log('backfill-phones', `Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.map(v => v.name).join(', ')}`);

    try {
      const results = await lookupPhones(batch);
      for (const result of results) {
        const venue = batch.find(v => v.name.toLowerCase() === result.name?.toLowerCase());
        if (!venue) continue;
        const phone = normalizePhone(result.phone);
        if (!phone) continue;

        if (dryRun) {
          log('backfill-phones', `[DRY] ${venue.name} -> ${phone}`);
        } else {
          db.prepare('UPDATE venues SET phone = ?, updated_at = datetime(\'now\') WHERE id = ?').run(phone, venue.id);
          log('backfill-phones', `Updated ${venue.name} -> ${phone}`);
        }
        updated++;
      }
    } catch (err) {
      log('backfill-phones', `Batch failed: ${err.message}`);
      failed += BATCH_SIZE;
    }

    if (i + BATCH_SIZE < total) await sleep(DELAY_BETWEEN_BATCHES_MS);
  }

  log('backfill-phones', `Done. Updated: ${updated}, Failed batches: ${Math.ceil(failed / BATCH_SIZE)}`);
}

main().catch(err => {
  log('backfill-phones', `Fatal: ${err.message}`);
  process.exit(1);
});
