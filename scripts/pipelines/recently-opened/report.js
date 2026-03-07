#!/usr/bin/env node
'use strict';

/**
 * Recently Opened Step 8+9: Generate and send Telegram report.
 * Reads: step-7-precheck.json (fallback chain to earlier steps)
 */
const path = require('path');
try { require('dotenv').config({ path: path.resolve(__dirname, '../../..', '.env.local') }); } catch {}

const { createLogger } = require('../../utils/logger');
const { readStepOutput } = require('../shared/pipeline-io');

const { log, close: closeLog } = createLogger('ro-report');
const PIPELINE = 'recently-opened';

function buildReport(s) {
  const lines = [];
  lines.push('🆕 <b>RECENTLY OPENED PIPELINE</b>');
  lines.push('');
  lines.push('<b>📊 EXECUTIVE SUMMARY</b>');
  lines.push(`• RSS: ${s.articlesScanned || 0} articles → ${s.rssCandidates || 0} candidates`);
  lines.push(`• LLM: ${s.llmResults || 0} results${s.llmError ? ' (⚠️ LLM error)' : ''}`);
  lines.push(`• Geocoded: ${s.geocodedCount || 0} | Deduped: ${s.dedupedCount || 0} | Verified: ${s.verified?.length || 0}`);
  if (s.qualityApproved != null || s.qualityRejected != null) {
    lines.push(`• Quality gate: ${s.qualityApproved || 0} approved, ${s.qualityRejected || 0} rejected`);
  }
  lines.push(`• Inserted: ${s.inserted || 0} recently opened venue(s)`);
  if (s.agedOut > 0) lines.push(`• Aged out → active: ${s.agedOut}`);
  if (s.precheckFixed > 0 || s.precheckPhotoFixed > 0) {
    lines.push(`• Pre-report fixes: ${s.precheckFixed || 0} data, ${s.precheckPhotoFixed || 0} photos`);
  }
  lines.push('');

  if (s.insertedNames?.length > 0) {
    lines.push(`<b>🆕 RECENTLY OPENED (${s.insertedNames.length})</b>`);
    for (const name of s.insertedNames.slice(0, 15)) lines.push(`  • ${name}`);
    if (s.insertedNames.length > 15) lines.push(`  ... and ${s.insertedNames.length - 15} more`);
    lines.push('');
  }

  if (s.agedNames?.length > 0) {
    lines.push(`<b>📅 AGED OUT → ACTIVE (${s.agedNames.length})</b>`);
    for (const name of s.agedNames.slice(0, 10)) lines.push(`  • ${name}`);
    if (s.agedNames.length > 10) lines.push(`  ... and ${s.agedNames.length - 10} more`);
    lines.push('');
  }

  if (s.rejected?.length > 0) {
    lines.push(`<b>🚫 QUALITY REJECTED (${s.rejected.length})</b>`);
    for (const r of s.rejected.slice(0, 10)) {
      lines.push(`  • ${r.placeName || r.name}: ${r.reject_reason}`);
    }
    lines.push('');
  }

  if (s.precheckFlagged?.length > 0) {
    lines.push(`<b>⚠️ NEEDS ATTENTION (${s.precheckFlagged.length})</b>`);
    for (const f of s.precheckFlagged.slice(0, 10)) {
      lines.push(`  • ${f.name}: ${f.issues.join(', ')}`);
    }
    lines.push('');
  }

  if (!s.insertedNames?.length && !s.agedNames?.length) {
    lines.push('<i>No new recently opened venues found today.</i>');
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
  const summary = readStepOutput(PIPELINE, 'step-7-precheck')
    || readStepOutput(PIPELINE, 'step-6-aging')
    || readStepOutput(PIPELINE, 'step-5-upserted');
  if (!summary) { log('No summary found — skipping'); closeLog(); return; }
  log('[report] Building recently-opened report');

  const report = buildReport(summary);
  log(`[report] Report: ${report.length} chars`);
  await sendTelegram(report);
  log('[report] Sent to Telegram');
  closeLog();
}

main().catch(e => { console.error('Fatal:', e); closeLog(); process.exit(1); });
