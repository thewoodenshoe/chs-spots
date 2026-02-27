#!/usr/bin/env node
/**
 * Extract Operating Hours from Venue Websites
 *
 * Three-tier approach:
 *   Tier 1: Regex parse structured day/time patterns from scraped HTML (free)
 *   Tier 2: LLM extraction for semi-structured content (Grok API)
 *   Tier 3: LLM knowledge query for venues with no hours on website (Grok API)
 *
 * Usage:
 *   node scripts/extract-hours.js              # Process venues missing hours
 *   node scripts/extract-hours.js --force      # Reprocess all venues
 *   node scripts/extract-hours.js --dry-run    # Preview without writing to DB
 *   node scripts/extract-hours.js --tier1-only # Only run regex parsing (no LLM)
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });
const { dataPath } = require('./utils/data-dir');
const db = require('./utils/db');

const { chat, extractJsonArray, extractJsonObject, getApiKey } = require('./utils/llm-client');

const SILVER_TRIMMED_DIR = dataPath('silver_trimmed', 'today');

const DAY_NAMES = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_FULL = {
  monday: 'mon', tuesday: 'tue', wednesday: 'wed', thursday: 'thu',
  friday: 'fri', saturday: 'sat', sunday: 'sun',
  mon: 'mon', tue: 'tue', wed: 'wed', thu: 'thu',
  fri: 'fri', sat: 'sat', sun: 'sun',
  tues: 'tue', weds: 'wed', thurs: 'thu', thur: 'thu',
};

// ── Tier 1: Regex parsing ───────────────────────────────────────

function normalizeTime(timeStr) {
  const t = timeStr.trim().toLowerCase().replace(/\s+/g, '');
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const min = m[2] || '00';
  const ampm = m[3];
  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;
  if (!ampm && hour >= 1 && hour <= 6) hour += 12;
  return `${String(hour).padStart(2, '0')}:${min}`;
}

function parseDayRange(dayStr) {
  const s = dayStr.trim().toLowerCase().replace(/\s+/g, '');
  const rangeMatch = s.match(/^([a-z]+)[-–—to]+([a-z]+)$/);
  if (rangeMatch) {
    const start = DAY_FULL[rangeMatch[1]];
    const end = DAY_FULL[rangeMatch[2]];
    if (!start || !end) return [];
    const si = DAY_NAMES.indexOf(start);
    const ei = DAY_NAMES.indexOf(end);
    if (si < 0 || ei < 0) return [];
    const days = [];
    for (let i = si; i !== (ei + 1) % 7; i = (i + 1) % 7) days.push(DAY_NAMES[i]);
    days.push(DAY_NAMES[ei]);
    return days;
  }
  const single = DAY_FULL[s];
  return single ? [single] : [];
}

function regexParseHours(text) {
  const hours = {};
  const patterns = [
    // "Monday: 11:00 AM - 10:00 PM" or "Mon-Fri 11am-9pm"
    /(?:^|\n|[|•·])\s*((?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|tues|weds|thurs|thur)[a-z]*(?:\s*[-–—to]+\s*(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|tues|weds|thurs|thur)[a-z]*)?)\s*[:\s]+(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)?)\s*[-–—to]+\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)?)/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const days = parseDayRange(match[1]);
      const open = normalizeTime(match[2]);
      const close = normalizeTime(match[3]);
      if (days.length > 0 && open && close) {
        for (const day of days) {
          if (!hours[day]) hours[day] = { open, close };
        }
      }
    }
  }

  // "Open Daily 10am-8pm"
  const dailyMatch = text.match(/open\s+daily\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*[-–—to]+\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
  if (dailyMatch && Object.keys(hours).length === 0) {
    const open = normalizeTime(dailyMatch[1]);
    const close = normalizeTime(dailyMatch[2]);
    if (open && close) {
      for (const day of DAY_NAMES) hours[day] = { open, close };
    }
  }

  const coveredDays = Object.keys(hours).length;
  if (coveredDays >= 3) return hours;
  return null;
}

// ── Tier 2: LLM extraction from website content ────────────────

const HOURS_SYSTEM_PROMPT = `You extract operating hours from restaurant/bar website content.

Return ONLY valid JSON in this exact format:
{
  "found": true,
  "hours": {
    "mon": {"open": "11:00", "close": "22:00"},
    "tue": {"open": "11:00", "close": "22:00"},
    "wed": {"open": "11:00", "close": "22:00"},
    "thu": {"open": "11:00", "close": "23:00"},
    "fri": {"open": "11:00", "close": "23:00"},
    "sat": {"open": "10:00", "close": "23:00"},
    "sun": {"open": "10:00", "close": "21:00"}
  }
}

Rules:
- Use 24-hour format (e.g., "22:00" not "10:00 PM")
- Use day abbreviations: mon, tue, wed, thu, fri, sat, sun
- If closed on a day, use "closed" as the value instead of an object
- If you cannot find hours, return {"found": false}
- Only look for REGULAR BUSINESS HOURS, not happy hour or event times
- Output ONLY valid JSON, no explanation text`;

async function llmExtractHours(text, venueName) {
  if (!getApiKey()) return null;

  const result = await chat({
    messages: [
      { role: 'system', content: HOURS_SYSTEM_PROMPT },
      { role: 'user', content: `Extract the regular operating/business hours for "${venueName}" from this website content:\n\n${text.substring(0, 8000)}` },
    ],
    temperature: 0,
    timeoutMs: 30000,
    log: (msg) => console.warn(msg),
  });

  if (!result) return null;
  const parsed = extractJsonObject(result.content);
  if (!parsed?.found || !parsed?.hours) return null;
  return parsed.hours;
}

// ── Tier 3: LLM knowledge query ────────────────────────────────

async function llmKnowledgeQuery(venues) {
  if (!getApiKey() || venues.length === 0) return new Map();

  const venueList = venues.map((v, i) => `${i}. ${v.name} at ${v.address || 'Charleston, SC'}`).join('\n');

  const result = await chat({
    messages: [
      { role: 'system', content: 'You are a helpful assistant that knows operating hours for restaurants and bars in Charleston, SC. Return ONLY a valid JSON array.' },
      { role: 'user', content: `What are the regular operating hours for each of these restaurants/bars in Charleston, SC?\n\n${venueList}\n\nReturn a JSON array where each element has:\n{"index": <number matching the list above>, "hours": {"mon": {"open": "11:00", "close": "22:00"}, "tue": ...}}\n\nUse 24-hour format. Day abbreviations: mon, tue, wed, thu, fri, sat, sun. If a day is closed, use "closed" as the value. If you don't know a venue's hours, still include it with "hours": null.\nReturn ONLY a valid JSON array.` },
    ],
    temperature: 0,
    timeoutMs: 60000,
    log: (msg) => console.warn(msg),
  });

  if (!result?.parsed || !Array.isArray(result.parsed)) return new Map();

  const results = new Map();
  for (const item of result.parsed) {
    if (typeof item.index !== 'number' || item.index < 0 || item.index >= venues.length) continue;
    if (!item.hours || typeof item.hours !== 'object') continue;
    results.set(venues[item.index].id, item.hours);
  }
  return results;
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const dryRun = args.includes('--dry-run');
  const tier1Only = args.includes('--tier1-only');

  console.log(`\n═══ extract-hours.js START ═══`);
  console.log(`  Mode: ${force ? 'force (reprocess all)' : 'incremental'}`);
  if (dryRun) console.log('  DRY RUN: no database writes');
  if (tier1Only) console.log('  TIER 1 ONLY: no LLM calls');

  db.ensureSchema();
  const database = db.getDb();

  // Ensure columns exist
  const cols = database.prepare('PRAGMA table_info(venues)').all().map(c => c.name);
  if (!cols.includes('operating_hours')) {
    database.exec('ALTER TABLE venues ADD COLUMN operating_hours TEXT');
    database.exec('ALTER TABLE venues ADD COLUMN hours_source TEXT');
    database.exec('ALTER TABLE venues ADD COLUMN hours_updated_at TEXT');
    console.log('  Added hours columns to venues table');
  }

  // Get venues with approved spots
  const venuesWithSpots = database.prepare(`
    SELECT DISTINCT v.id, v.name, v.address, v.website, v.operating_hours, v.hours_updated_at
    FROM venues v
    JOIN spots s ON v.id = s.venue_id
    WHERE s.status = 'approved'
    ORDER BY v.name
  `).all();

  const toProcess = force
    ? venuesWithSpots
    : venuesWithSpots.filter(v => !v.operating_hours);

  console.log(`  Total venues with spots: ${venuesWithSpots.length}`);
  console.log(`  Already have hours: ${venuesWithSpots.length - toProcess.length}`);
  console.log(`  To process: ${toProcess.length}\n`);

  if (toProcess.length === 0) {
    console.log('Nothing to process.');
    db.closeDb();
    return;
  }

  const metrics = { tier1: 0, tier2: 0, tier3: 0, failed: 0 };
  const tier2Queue = [];
  const tier3Queue = [];

  // ── Tier 1: Regex parsing ─────────────────────────────────────
  console.log('── Tier 1: Regex Parsing ──');
  for (const venue of toProcess) {
    const filePath = path.join(SILVER_TRIMMED_DIR, `${venue.id}.json`);
    if (!fs.existsSync(filePath)) {
      tier3Queue.push(venue);
      continue;
    }

    let text = '';
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      text = (data.pages || []).map(p => p.text).join('\n');
    } catch {
      tier3Queue.push(venue);
      continue;
    }

    if (!text || text.length < 50) {
      tier3Queue.push(venue);
      continue;
    }

    const hours = regexParseHours(text);
    if (hours) {
      if (!dryRun) {
        database.prepare(`
          UPDATE venues SET operating_hours = ?, hours_source = 'regex', hours_updated_at = datetime('now')
          WHERE id = ?
        `).run(JSON.stringify(hours), venue.id);
      }
      metrics.tier1++;
      console.log(`  ✓ ${venue.name}: regex parsed (${Object.keys(hours).length} days)`);
    } else {
      tier2Queue.push({ ...venue, text });
    }
  }
  console.log(`  Tier 1 complete: ${metrics.tier1} parsed, ${tier2Queue.length} need LLM, ${tier3Queue.length} no file\n`);

  if (tier1Only) {
    console.log('Stopping (--tier1-only mode)');
    printSummary(metrics);
    db.closeDb();
    return;
  }

  // ── Tier 2: LLM extraction from website content ──────────────
  if (tier2Queue.length > 0) {
    console.log(`── Tier 2: LLM Extraction (${tier2Queue.length} venues) ──`);
    if (!process.env.GROK_API_KEY) {
      console.warn('  GROK_API_KEY not set, skipping Tier 2');
      tier3Queue.push(...tier2Queue.map(v => ({ id: v.id, name: v.name, address: v.address })));
    } else {
      for (const venue of tier2Queue) {
        const hours = await llmExtractHours(venue.text, venue.name, venue.id);
        if (hours) {
          if (!dryRun) {
            database.prepare(`
              UPDATE venues SET operating_hours = ?, hours_source = 'llm-website', hours_updated_at = datetime('now')
              WHERE id = ?
            `).run(JSON.stringify(hours), venue.id);
          }
          metrics.tier2++;
          console.log(`  ✓ ${venue.name}: LLM extracted (${Object.keys(hours).length} days)`);
        } else {
          tier3Queue.push({ id: venue.id, name: venue.name, address: venue.address });
          console.log(`  ✗ ${venue.name}: LLM found no hours`);
        }
        // Rate limit
        await new Promise(r => setTimeout(r, 500));
      }
    }
    console.log(`  Tier 2 complete: ${metrics.tier2} extracted\n`);
  }

  // ── Tier 3: LLM knowledge query ──────────────────────────────
  if (tier3Queue.length > 0) {
    console.log(`── Tier 3: LLM Knowledge Query (${tier3Queue.length} venues) ──`);
    if (!process.env.GROK_API_KEY) {
      console.warn('  GROK_API_KEY not set, skipping Tier 3');
      metrics.failed += tier3Queue.length;
    } else {
      for (let i = 0; i < tier3Queue.length; i += 8) {
        const batch = tier3Queue.slice(i, i + 8);
        console.log(`  Batch ${Math.floor(i / 8) + 1}/${Math.ceil(tier3Queue.length / 8)} (${batch.length} venues)...`);
        const results = await llmKnowledgeQuery(batch);

        for (const venue of batch) {
          const hours = results.get(venue.id);
          if (hours) {
            if (!dryRun) {
              database.prepare(`
                UPDATE venues SET operating_hours = ?, hours_source = 'llm-knowledge', hours_updated_at = datetime('now')
                WHERE id = ?
              `).run(JSON.stringify(hours), venue.id);
            }
            metrics.tier3++;
            console.log(`  ✓ ${venue.name}: knowledge query`);
          } else {
            metrics.failed++;
            console.log(`  ✗ ${venue.name}: unknown hours`);
          }
        }
        if (i + 8 < tier3Queue.length) await new Promise(r => setTimeout(r, 1000));
      }
    }
    console.log(`  Tier 3 complete: ${metrics.tier3} found\n`);
  }

  printSummary(metrics);
  db.closeDb();
}

function printSummary(metrics) {
  const total = metrics.tier1 + metrics.tier2 + metrics.tier3 + metrics.failed;
  console.log('═══ SUMMARY ═══');
  console.log(`  Tier 1 (regex):     ${metrics.tier1}`);
  console.log(`  Tier 2 (LLM web):   ${metrics.tier2}`);
  console.log(`  Tier 3 (LLM know):  ${metrics.tier3}`);
  console.log(`  Failed/unknown:     ${metrics.failed}`);
  console.log(`  Total:              ${total}`);
  console.log(`  Success rate:       ${total > 0 ? Math.round(((total - metrics.failed) / total) * 100) : 0}%`);
  console.log('═══ extract-hours.js END ═══\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  db.closeDb();
  process.exit(1);
});
