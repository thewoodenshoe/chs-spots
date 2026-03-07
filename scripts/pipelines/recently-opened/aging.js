#!/usr/bin/env node
'use strict';

/**
 * Recently Opened Step 6: Age out recently_opened venues after 90 days.
 * Transitions venue_status to 'active' and strips "Opened {date}." prefix.
 * Reads: step-5-upserted.json → Outputs: step-6-aging.json
 */
const path = require('path');
try { require('dotenv').config({ path: path.resolve(__dirname, '../../..', '.env.local') }); } catch {}

const db = require('../../utils/db');
const { createLogger } = require('../../utils/logger');
const { readStepOutput, writeStepOutput } = require('../shared/pipeline-io');

const { log, close: closeLog } = createLogger('ro-aging');
const PIPELINE = 'recently-opened';
const RECENTLY_OPENED_MAX_DAYS = 90;

function main() {
  const input = readStepOutput(PIPELINE, 'step-5-upserted');
  if (!input) { log('No step-5 output — aborting'); process.exit(1); }
  log('=== Recently Opened Aging Check ===');
  db.setAuditContext('pipeline', 'ro-aging');

  const cutoff = new Date(Date.now() - RECENTLY_OPENED_MAX_DAYS * 86400000)
    .toISOString().slice(0, 10);
  const datePrefix = /^Opened\s+[^.]+\.\s*/i;

  const toAge = db.getDb().prepare(
    "SELECT id, name, description FROM venues WHERE venue_status = 'recently_opened' AND venue_added_at < ?",
  ).all(cutoff);

  log(`[aging] ${toAge.length} venue(s) older than ${RECENTLY_OPENED_MAX_DAYS} days`);

  const stmt = db.getDb().prepare(
    "UPDATE venues SET venue_status = 'active', description = ?, updated_at = datetime('now') WHERE id = ?",
  );
  const agedNames = [];

  for (const v of toAge) {
    const cleaned = (v.description || '').replace(datePrefix, '').trim() || null;
    stmt.run(cleaned, v.id);
    agedNames.push(v.name);
    log(`[aging] ${v.name} → active`);
  }

  log(`[aging] Done: ${toAge.length} aged out to active`);

  writeStepOutput(PIPELINE, 'step-6-aging', {
    ...input, agedOut: toAge.length, agedNames,
  });

  closeLog(); db.closeDb();
}

main();
