#!/usr/bin/env node
'use strict';

/**
 * Promotions Step 6: Pre-report quality check.
 * Scans all approved HH/Brunch spots for anomalies after upsert + critical fill.
 * Attempts rule-based fixes, then flags the rest.
 */
const path = require('path');
try { require('dotenv').config({ path: path.resolve(__dirname, '../../..', '.env.local') }); } catch {}

const db = require('../../utils/db');
const { createLogger } = require('../../utils/logger');
const { checkItem } = require('../shared/quality-gate');

const { log, close: closeLog } = createLogger('pm-quality');
const TYPES = ['Happy Hour', 'Brunch'];

function main() {
  log('=== Promotions Quality Check ===');
  db.setAuditContext('pipeline', 'pm-quality');
  const d = db.getDb();

  const spots = d.prepare(
    "SELECT id, title, type, time_start, time_end, days, venue_id, description FROM spots WHERE status = 'approved' AND type IN ('Happy Hour', 'Brunch')",
  ).all();

  log(`[quality] Checking ${spots.length} spots`);
  let issues = 0;
  let fixed = 0;

  for (const spot of spots) {
    const { pass, reason } = checkItem(spot, spot.type);
    if (pass) continue;

    issues++;
    const venue = spot.venue_id ? d.prepare('SELECT * FROM venues WHERE id = ?').get(spot.venue_id) : null;

    if (!venue) {
      log(`[quality] REJECT #${spot.id} ${spot.title}: no venue`);
      db.spots.update(spot.id, { status: 'rejected' });
      continue;
    }

    if (!venue.lat || !venue.lng) {
      log(`[quality] FLAG #${spot.id} ${spot.title}: venue missing coordinates`);
    }

    if (!spot.time_start || !spot.time_end) {
      if (venue.operating_hours) {
        try {
          const hours = JSON.parse(venue.operating_hours);
          if (hours && Array.isArray(hours) && hours.length > 0) {
            log(`[quality] INFO #${spot.id} ${spot.title}: has venue hours but no spot times — ${reason}`);
          }
        } catch { /* not valid JSON */ }
      }
      log(`[quality] FLAG #${spot.id} ${spot.title}: ${reason}`);
    }
  }

  log(`[quality] Done: ${issues} issue(s), ${fixed} auto-fixed`);
  closeLog(); db.closeDb();
}

main();
