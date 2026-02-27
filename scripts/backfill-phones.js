/**
 * Backfill phone numbers for venues from raw HTML data + optional Grok API.
 *
 * Phase 1: Scan data/raw/today/<venueId>/*.html for tel: links
 * Phase 2: (optional) Use Grok API for remaining venues (--grok flag)
 *
 * Usage:
 *   node scripts/backfill-phones.js [--dry-run] [--grok] [--limit N]
 */

const path = require('path');
const fs = require('fs');
const { getDb: initDb } = require('./utils/db');
const { createLogger } = require('./utils/logger');

const { log } = createLogger('backfill-phones');

const RAW_DIR = path.resolve(__dirname, '..', 'data', 'raw', 'today');
const PHONE_RE = /href\s*=\s*["']tel:([^"']+)["']/gi;

function normalizePhone(raw) {
  const digits = raw.replace(/\D/g, '');
  const d = digits.startsWith('1') && digits.length === 11 ? digits.slice(1) : digits;
  if (d.length !== 10) return null;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function extractPhonesFromDir(venueDir) {
  if (!fs.existsSync(venueDir)) return [];
  const htmlFiles = fs.readdirSync(venueDir).filter(f => f.endsWith('.html'));
  const counts = new Map();

  for (const file of htmlFiles) {
    const html = fs.readFileSync(path.join(venueDir, file), 'utf-8');
    let match;
    while ((match = PHONE_RE.exec(html)) !== null) {
      const phone = normalizePhone(match[1]);
      if (phone) counts.set(phone, (counts.get(phone) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([phone]) => phone);
}

function parseArgs() {
  const args = process.argv.slice(2);
  let limit = Infinity;
  let dryRun = false;
  let useGrok = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) limit = parseInt(args[i + 1], 10);
    if (args[i] === '--dry-run') dryRun = true;
    if (args[i] === '--grok') useGrok = true;
  }
  return { limit, dryRun, useGrok };
}

async function main() {
  const { limit, dryRun, useGrok } = parseArgs();
  const db = initDb();

  const venues = db.prepare(`
    SELECT id, name, address, area FROM venues
    WHERE phone IS NULL OR phone = ''
    ORDER BY name
  `).all();

  log(`Found ${venues.length} venues without phone numbers`);

  let scraped = 0;
  let skipped = 0;
  const remaining = [];

  const total = Math.min(venues.length, limit);

  for (let i = 0; i < total; i++) {
    const venue = venues[i];
    const venueDir = path.join(RAW_DIR, venue.id);
    const phones = extractPhonesFromDir(venueDir);

    if (phones.length > 0) {
      const phone = phones[0];
      if (dryRun) {
        log(`[DRY] ${venue.name} -> ${phone}`);
      } else {
        db.prepare("UPDATE venues SET phone = ?, updated_at = datetime('now') WHERE id = ?").run(phone, venue.id);
      }
      scraped++;
    } else {
      remaining.push(venue);
      skipped++;
    }
  }

  log(`Phase 1 (raw HTML): ${scraped} phones found, ${skipped} venues without tel: links`);

  if (useGrok && remaining.length > 0) {
    log(`Phase 2 (Grok API): looking up ${remaining.length} remaining venues...`);
    const { webSearch } = require('./utils/llm-client');
    const BATCH_SIZE = 10;

    for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
      const batch = remaining.slice(i, i + BATCH_SIZE);
      const names = batch.map(v => `- ${v.name}, ${v.address || v.area || 'Charleston SC'}`).join('\n');
      const prompt = `Find the phone number for each of these Charleston, SC restaurants/venues. Return ONLY a JSON array of objects with "name" and "phone" fields. If unknown, set phone to null.\n\n${names}`;

      const result = await webSearch({ prompt, log, timeoutMs: 30000 });
      if (!result?.parsed || !Array.isArray(result.parsed)) continue;

      for (const r of result.parsed) {
        if (!r.phone) continue;
        const venue = batch.find(v => v.name.toLowerCase() === r.name?.toLowerCase());
        if (!venue) continue;
        const phone = normalizePhone(r.phone);
        if (!phone) continue;

        if (dryRun) {
          log(`[DRY/GROK] ${venue.name} -> ${phone}`);
        } else {
          db.prepare("UPDATE venues SET phone = ?, updated_at = datetime('now') WHERE id = ?").run(phone, venue.id);
        }
        scraped++;
      }

      if (i + BATCH_SIZE < remaining.length) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  log(`Done. Total phones set: ${scraped}${dryRun ? ' (DRY RUN)' : ''}`);
}

main().catch(err => {
  log(`Fatal: ${err.message}`);
  process.exit(1);
});
