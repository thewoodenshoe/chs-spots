#!/usr/bin/env node
'use strict';

/**
 * Openings Step 8+9: Generate and send Telegram report.
 * Reads: step-6-lifecycle.json (or step-5-upserted.json fallback)
 */
const path = require('path');
try { require('dotenv').config({ path: path.resolve(__dirname, '../../..', '.env.local') }); } catch {}

const { createLogger } = require('../../utils/logger');
const { readStepOutput } = require('../shared/pipeline-io');

const { log, close: closeLog } = createLogger('op-report');
const PIPELINE = 'openings';

function buildReport(s) {
  const lines = [];
  lines.push('🏗 <b>OPENINGS PIPELINE</b>');
  lines.push('');
  lines.push('<b>📊 EXECUTIVE SUMMARY</b>');
  lines.push(`• RSS: ${s.articlesScanned || 0} articles → ${s.rssCandidates || 0} candidates`);
  lines.push(`• LLM: ${s.llmResults || 0} results${s.llmError ? ' (⚠️ LLM error)' : ''}`);
  lines.push(`• Geocoded: ${s.geocodedCount || 0} | Deduped: ${s.dedupedCount || 0} | Verified: ${s.verified?.length || 0}`);
  lines.push(`• Inserted: ${s.inserted || 0} new venue(s)`);
  if (s.agedOut > 0) lines.push(`• Aged out: ${s.agedOut}`);
  if (s.transitioned > 0) lines.push(`• Coming soon → opened: ${s.transitioned}`);
  lines.push('');

  if (s.insertedNames?.length > 0) {
    lines.push(`<b>🆕 NEW VENUES (${s.insertedNames.length})</b>`);
    for (const name of s.insertedNames.slice(0, 15)) lines.push(`  • ${name}`);
    if (s.insertedNames.length > 15) lines.push(`  ... and ${s.insertedNames.length - 15} more`);
    lines.push('');
  }

  if (s.transitionedNames?.length > 0) {
    lines.push(`<b>🎉 NOW OPEN</b>`);
    for (const name of s.transitionedNames) lines.push(`  • ${name}`);
    lines.push('');
  }

  if (!s.insertedNames?.length && !s.transitionedNames?.length) {
    lines.push('<i>No new venues found today.</i>');
  }

  return lines.join('\n');
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID || '';
  if (!token || !chatId) { log('[report] Telegram not configured'); return; }
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
  } catch (err) { log(`[report] Telegram failed: ${err.message}`); }
}

async function main() {
  const summary = readStepOutput(PIPELINE, 'step-6-lifecycle')
    || readStepOutput(PIPELINE, 'step-5-upserted');
  if (!summary) { log('No summary found — skipping'); closeLog(); return; }
  log('[report] Building openings report');

  const report = buildReport(summary);
  log(`[report] Report: ${report.length} chars`);
  await sendTelegram(report);
  log('[report] Sent to Telegram');
  closeLog();
}

main().catch(e => { console.error('Fatal:', e); closeLog(); process.exit(1); });
