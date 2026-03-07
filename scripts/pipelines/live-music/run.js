#!/usr/bin/env node
'use strict';

/**
 * Live Music Pipeline Orchestrator — runs all 9 steps.
 * Steps: Discover → Critical Fill → Quality Gate → Upsert → Pre-Report → SEO → Report → Telegram
 */
const path = require('path');
try { require('dotenv').config({ path: path.resolve(__dirname, '../../..', '.env.local') }); } catch {}

const db = require('../../utils/db');
const { createLogger } = require('../../utils/logger');
const { readStepOutput, writeStepOutput, getTodayDate, getTodayLabel } = require('../shared/pipeline-io');
const { runQualityGate } = require('../shared/quality-gate');
const { upsertSpots } = require('../shared/upsert');
const { runPreReportCheck } = require('../shared/pre-report-check');

const { log, error: logError, close: closeLog } = createLogger('lm-pipeline');
const PIPELINE = 'live-music';
const TYPE = 'Live Music';

function runStep(label, scriptPath) {
  log(`--- Step: ${label} ---`);
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const child = spawn(process.execPath, [scriptPath], {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', d => process.stdout.write(d));
    child.stderr.on('data', d => process.stderr.write(d));
    child.on('exit', code => {
      if (code !== 0) reject(new Error(`${label} exited with code ${code}`));
      else resolve();
    });
  });
}

async function main() {
  const startMs = Date.now();
  const todayDate = getTodayDate();
  const todayLabel = getTodayLabel();
  log(`=== Live Music Pipeline: ${todayLabel} ===`);
  db.setAuditContext('pipeline', 'lm-pipeline');

  // Step 1+2: Discover + Open LLM (venue resolution built in)
  await runStep('Discover', path.join(__dirname, 'discover-today.js'));

  // Step 3: Critical Fill (targeted LLM for missing times)
  await runStep('Critical Fill', path.join(__dirname, 'critical-fill.js'));

  const enriched = readStepOutput(PIPELINE, 'step-3-enriched');
  if (!enriched) { log('No enriched output — aborting'); closeLog(); process.exit(1); }

  if (enriched.acquireError) {
    log('[pipeline] Acquire error — skipping upsert, preserving data');
    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    writeStepOutput(PIPELINE, 'step-final-summary', {
      date: todayDate, dateLabel: todayLabel, elapsed, acquireError: true,
      existingSpots: enriched.existingSpots,
    });
    await runStep('Report', path.join(__dirname, 'report.js'));
    closeLog(); db.closeDb(); return;
  }

  // Step 4: Quality Gate
  log('--- Step: Quality Gate ---');
  const { approved, rejected } = runQualityGate(enriched.enrichedEvents, TYPE, log);

  // Step 5: Upsert
  log('--- Step: Upsert ---');
  const approvedVenueIds = new Set(approved.map(a => a.venue_id));
  const staleIds = (enriched.existingSpotIds || [])
    .filter(s => !approvedVenueIds.has(s.venue_id))
    .map(s => s.id);

  const upsertResult = upsertSpots({
    approved, staleIds, acquireError: false, todayDate, type: TYPE,
  }, { db, log });

  // Step 6: Pre-Report Check
  log('--- Step: Pre-Report Check ---');
  const approvedIds = db.getDb().prepare(
    "SELECT id FROM spots WHERE type = ? AND status = 'approved' AND specific_date = ?",
  ).all(TYPE, todayDate).map(r => r.id);
  const preReport = await runPreReportCheck(approvedIds, TYPE, { db, log });

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  log(`\n[pipeline] Done in ${elapsed}s`);

  // Write final summary for report step
  writeStepOutput(PIPELINE, 'step-final-summary', {
    date: todayDate, dateLabel: todayLabel, elapsed, acquireError: false,
    existingSpots: enriched.existingSpots, rawCount: enriched.rawCount,
    enrichedCount: enriched.enrichedEvents.length,
    droppedCount: enriched.droppedCount || 0,
    approved, rejected, upsert: upsertResult, preReport,
  });

  // Step 8+9: Report + Telegram
  await runStep('Report', path.join(__dirname, 'report.js'));

  closeLog(); db.closeDb();
}

main().catch(e => { logError('Fatal:', e); closeLog(); process.exit(1); });
