'use strict';

/**
 * Per-agent decision audit trail.
 * Logs every LLM call with: agent name, prompt file used, input summary,
 * response summary, decision, and timestamp.
 *
 * Writes to data/reporting/agent-decisions.jsonl (one JSON object per line).
 * Rotated daily — previous day's log is renamed with date suffix.
 */

const fs = require('fs');
const { reportingPath } = require('./data-dir');

const LOG_PATH = reportingPath('agent-decisions.jsonl');
const MAX_FIELD_LENGTH = 500;

function ensureLogDir() {
  const dir = reportingPath();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function truncate(str, maxLen = MAX_FIELD_LENGTH) {
  if (!str || typeof str !== 'string') return str;
  return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
}

/**
 * Rotate log file if it's from a previous day.
 */
function rotateIfNeeded() {
  if (!fs.existsSync(LOG_PATH)) return;
  try {
    const stat = fs.statSync(LOG_PATH);
    const fileDate = stat.mtime.toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];
    if (fileDate < today) {
      const archivePath = reportingPath(`agent-decisions-${fileDate}.jsonl`);
      fs.renameSync(LOG_PATH, archivePath);
    }
  } catch { /* rotation is best-effort */ }
}

/**
 * Log an LLM agent decision.
 *
 * @param {Object} entry
 * @param {string} entry.agent - Script/module name (e.g. 'check-opening-status')
 * @param {string} entry.promptFile - Prompt template used (e.g. 'llm-opening-status-check')
 * @param {string} entry.action - What was decided (e.g. 'verify_opening', 'enrich_times')
 * @param {Object} [entry.input] - Summary of input data (venue name, etc.)
 * @param {Object} [entry.output] - Summary of LLM response
 * @param {string} [entry.decision] - Outcome (e.g. 'opened', 'still_coming_soon', 'corrected')
 * @param {boolean} [entry.applied] - Whether the decision was applied to DB
 * @param {number} [entry.durationMs] - How long the LLM call took
 * @param {string} [entry.error] - Error message if the call failed
 */
function logAgentDecision(entry) {
  try {
    ensureLogDir();
    rotateIfNeeded();
    const record = {
      timestamp: new Date().toISOString(),
      agent: entry.agent,
      promptFile: entry.promptFile || null,
      action: entry.action,
      input: entry.input ? truncateObj(entry.input) : null,
      output: entry.output ? truncateObj(entry.output) : null,
      decision: entry.decision || null,
      applied: entry.applied ?? null,
      durationMs: entry.durationMs ?? null,
      error: entry.error || null,
    };
    fs.appendFileSync(LOG_PATH, JSON.stringify(record) + '\n');
  } catch { /* audit logging is best-effort — never crash the pipeline */ }
}

function truncateObj(obj) {
  if (typeof obj === 'string') return truncate(obj);
  if (typeof obj !== 'object' || obj === null) return obj;
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = typeof v === 'string' ? truncate(v) : v;
  }
  return result;
}

/**
 * Read today's agent decisions.
 * @returns {Array<Object>}
 */
function getDecisions() {
  if (!fs.existsSync(LOG_PATH)) return [];
  try {
    return fs.readFileSync(LOG_PATH, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
  } catch { return []; }
}

module.exports = { logAgentDecision, getDecisions };
