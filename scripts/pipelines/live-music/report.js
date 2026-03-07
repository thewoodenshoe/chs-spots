#!/usr/bin/env node
'use strict';

/**
 * Live Music Step 8: Generate and send Telegram report.
 * Reads: step-final-summary.json → Sends to Telegram
 */
const path = require('path');
try { require('dotenv').config({ path: path.resolve(__dirname, '../../..', '.env.local') }); } catch {}

const { sendTelegram } = require('../../utils/google-places');
const { createLogger } = require('../../utils/logger');
const { readStepOutput } = require('../shared/pipeline-io');

const { log, close: closeLog } = createLogger('lm-report');
const PIPELINE = 'live-music';

function truncList(items, max, fmt) {
  const lines = items.slice(0, max).map(fmt);
  if (items.length > max) lines.push(`  ... and ${items.length - max} more`);
  return lines.join('\n');
}

function buildReport(s) {
  const lines = [];
  lines.push(`🎵 <b>LIVE MUSIC PIPELINE</b> — ${s.dateLabel}`);
  if (s.acquireError) {
    lines.push('');
    lines.push('⚠️ <b>LLM ERROR</b>: Acquisition failed. Existing data preserved.');
    lines.push('No stale clearing performed. Will retry next run.');
    return lines.join('\n');
  }
  lines.push('');

  lines.push('<b>📊 EXECUTIVE SUMMARY</b>');
  lines.push(`• LLM found <b>${s.rawCount || 0}</b> raw events`);
  lines.push(`• ${s.enrichedCount || 0} passed quality gate`);
  lines.push(`• ${s.droppedCount || 0} dropped (missing venue or times)`);
  lines.push(`• ${s.rejected?.length || 0} rejected at quality gate`);
  const u = s.upsert || {};
  lines.push(`• ${u.updated || 0} updated, ${u.created || 0} created, ${u.staleCleared || 0} stale cleared`);
  const pr = s.preReport || {};
  if (pr.fixed > 0 || pr.removed > 0) {
    lines.push(`• Pre-report: ${pr.fixed || 0} fixed, ${pr.removed || 0} removed`);
  }
  lines.push(`• ${s.existingSpots || 0} total Live Music spots`);
  lines.push(`• Pipeline: ${s.elapsed || '?'}s`);
  lines.push('');

  lines.push('<b>🔄 PIPELINE STEPS</b>');
  lines.push(`1. <b>Discover</b> → ${s.rawCount || 0} raw events from LLM`);
  lines.push(`2. <b>Critical fill</b> → ${s.enrichedCount || 0} enriched, ${s.droppedCount || 0} dropped`);
  lines.push(`3. <b>Quality gate</b> → ${s.approved?.length || 0} approved, ${s.rejected?.length || 0} rejected`);
  lines.push(`4. <b>Upsert</b> → ${u.updated || 0} updated, ${u.created || 0} created`);
  if (u.staleCleared > 0) lines.push(`5. <b>Stale</b> → ${u.staleCleared} cleared`);
  lines.push('');

  if (s.approved?.length > 0) {
    lines.push(`<b>🎸 TODAY'S SHOWS (${s.approved.length})</b>`);
    lines.push(truncList(s.approved, 20, e =>
      `  • ${e.venue || e.title} — ${e.performer || ''} ${e.promotion_time || ''}`));
    lines.push('');
  }

  if (s.rejected?.length > 0) {
    lines.push(`<b>⏭ REJECTED (${s.rejected.length})</b>`);
    lines.push(truncList(s.rejected, 10, e =>
      `  • ${e.venue || e.title}: ${e.reject_reason || 'unknown'}`));
    lines.push('');
  }

  if (!s.approved?.length && !s.rejected?.length) {
    lines.push('<i>No live music events found for today.</i>');
  }

  return lines.join('\n');
}

async function main() {
  const summary = readStepOutput(PIPELINE, 'step-final-summary');
  if (!summary) { log('No summary file found — skipping'); closeLog(); return; }
  log(`[report] Building report for ${summary.dateLabel}`);

  const report = buildReport(summary);
  log(`[report] Report: ${report.length} chars`);

  if (report.length > 4000) {
    await sendTelegram(report.slice(0, 4000));
    await sendTelegram(report.slice(4000));
  } else {
    await sendTelegram(report);
  }

  log('[report] Sent to Telegram');
  closeLog();
}

main().catch(e => { console.error('Fatal:', e); closeLog(); process.exit(1); });
