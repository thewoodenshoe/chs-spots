#!/usr/bin/env node
// Formats and sends the live music pipeline report via Telegram.
// Reads live-music-summary.json written by refresh-live-music.js.

const fs = require('fs');
const path = require('path');
const { reportingPath } = require('../utils/data-dir');
const { sendTelegram } = require('../utils/google-places');
const { createLogger } = require('../utils/logger');
const { log, close: closeLog } = createLogger('live-music-report');

try {
  require('dotenv').config({ path: path.resolve(__dirname, '../..', '.env.local') });
} catch { /* dotenv not installed in production */ }

function truncateList(items, max, formatter) {
  const lines = items.slice(0, max).map(formatter);
  if (items.length > max) lines.push(`  ... and ${items.length - max} more`);
  return lines.join('\n');
}

function formatShow(item) {
  const est = item.endEstimated ? ' (end est.)' : '';
  return `  • ${item.venue} — ${item.performer} ${item.time}${est}`;
}

function buildReport(summary) {
  const { dateLabel, elapsed, acquisition, results, details, existingSpots, dryRun } = summary;
  const lines = [];

  lines.push(`🎵 <b>LIVE MUSIC PIPELINE</b> — ${dateLabel}`);
  if (dryRun) lines.push('<i>(DRY RUN — no writes)</i>');
  lines.push('');

  // Executive Summary
  lines.push('<b>📊 EXECUTIVE SUMMARY</b>');
  lines.push(`• Grok returned <b>${acquisition.raw}</b> events`);
  if (acquisition.dropped > 0) {
    lines.push(`• Quality filter: ${acquisition.valid} valid, ${acquisition.dropped} dropped (no time/venue)`);
  }
  lines.push(`• ${results.matched} matched to existing venues`);
  if (results.created > 0) lines.push(`• ${results.created} new venue(s) created`);
  if (results.skipped > 0) lines.push(`• ${results.skipped} skipped (quality not guaranteed)`);
  if (results.staleCleared > 0) lines.push(`• ${results.staleCleared} stale show(s) cleared`);
  lines.push(`• ${existingSpots} total Live Music spots in DB`);
  lines.push(`• Pipeline: ${elapsed}s`);
  lines.push('');

  // Pipeline narrative
  lines.push('<b>🔄 PIPELINE STEPS</b>');
  lines.push(`1. <b>Acquire</b> — Grok web search → ${acquisition.raw} results`);
  const qcLine = acquisition.dropped > 0
    ? `2. <b>Quality gate</b> — ${acquisition.dropped} dropped (missing venue name or start time) → ${acquisition.valid} passed`
    : `2. <b>Quality gate</b> — all ${acquisition.valid} passed`;
  lines.push(qcLine);
  lines.push(`3. <b>Match</b> — ${results.matched} matched existing spots`);
  if (results.created > 0 || results.skipped > 0) {
    const venueNew = details.created?.filter(c => c.venueCreated).length || 0;
    const venueReused = (details.created?.length || 0) - venueNew;
    const parts = [];
    if (venueNew > 0) parts.push(`${venueNew} new venue(s) geocoded`);
    if (venueReused > 0) parts.push(`${venueReused} reused existing venue(s)`);
    if (results.skipped > 0) parts.push(`${results.skipped} failed venue resolution`);
    lines.push(`4. <b>Venue resolution</b> — ${parts.join(', ')}`);
  }
  if (results.staleCleared > 0) {
    lines.push(`5. <b>Cleanup</b> — cleared ${results.staleCleared} stale events from yesterday`);
  }
  lines.push('');

  // Today's Shows
  if (details.matched?.length > 0) {
    lines.push(`<b>🎸 TODAY'S SHOWS (${details.matched.length})</b>`);
    lines.push(truncateList(details.matched, 20, formatShow));
    if (details.multiShow?.length > 0) {
      lines.push(`  + ${details.multiShow.length} additional set(s) at multi-show venues`);
    }
    lines.push('');
  }

  // New Venues
  if (details.created?.length > 0) {
    lines.push(`<b>🆕 NEW (${details.created.length})</b>`);
    lines.push(truncateList(details.created, 10, item => {
      const tag = item.venueCreated ? '📍 new venue' : '🔗 existing venue';
      return `  • ${item.venue} — ${item.performer} (${tag})`;
    }));
    lines.push('');
  }

  // Skipped
  if (details.skipped?.length > 0) {
    lines.push(`<b>⏭ SKIPPED (${details.skipped.length})</b>`);
    lines.push(truncateList(details.skipped, 10, item =>
      `  • ${item.venue}: ${item.reason}`));
    lines.push('');
  }

  // No shows
  if ((details.matched?.length || 0) === 0 && (details.created?.length || 0) === 0) {
    lines.push('<i>No live music events found for today.</i>');
    lines.push('');
  }

  return lines.join('\n');
}

async function main() {
  const summaryPath = reportingPath('live-music-summary.json');
  if (!fs.existsSync(summaryPath)) {
    log('[live-music-report] No summary file found — skipping report');
    closeLog();
    return;
  }

  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  log(`[live-music-report] Loaded summary for ${summary.dateLabel}`);

  const report = buildReport(summary);
  log(`[live-music-report] Report: ${report.length} chars`);

  if (report.length > 4000) {
    const parts = [report.slice(0, 4000), report.slice(4000)];
    for (const part of parts) await sendTelegram(part);
  } else {
    await sendTelegram(report);
  }

  log('[live-music-report] Report sent to Telegram');
  closeLog();
}

main().catch(e => {
  console.error('Fatal:', e);
  closeLog();
  process.exit(1);
});
