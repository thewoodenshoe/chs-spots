'use strict';

const MANDATORY_FIELDS = {
  'Live Music': ['venue_id', 'time_start', 'time_end', 'title'],
  'Happy Hour': ['venue_id', 'time_start', 'time_end', 'days', 'title'],
  Brunch: ['venue_id', 'time_start', 'time_end', 'days', 'title'],
};

function checkItem(item, type) {
  const required = MANDATORY_FIELDS[type] || ['venue_id', 'title'];
  const missing = required.filter(f => !item[f] && item[f] !== 0);
  if (missing.length > 0) {
    return { pass: false, reason: `Missing mandatory fields: ${missing.join(', ')}` };
  }
  if (item.time_start && !/^\d{2}:\d{2}$/.test(item.time_start)) {
    return { pass: false, reason: `Invalid time_start format: ${item.time_start}` };
  }
  if (item.time_end && !/^\d{2}:\d{2}$/.test(item.time_end)) {
    return { pass: false, reason: `Invalid time_end format: ${item.time_end}` };
  }
  return { pass: true, reason: null };
}

/**
 * Run quality gate on a list of enriched items.
 * @param {Array} items - items with mandatory fields populated
 * @param {string} type - activity type (Live Music, Happy Hour, Brunch)
 * @param {Function} log
 * @returns {{ approved: Array, rejected: Array }}
 */
function runQualityGate(items, type, log) {
  const approved = [];
  const rejected = [];

  for (const item of items) {
    const { pass, reason } = checkItem(item, type);
    if (pass) {
      approved.push(item);
    } else {
      rejected.push({ ...item, reject_reason: reason });
      log(`[quality-gate] REJECT: ${item.title || item.venue} — ${reason}`);
    }
  }

  log(`[quality-gate] ${type}: ${approved.length} approved, ${rejected.length} rejected`);
  return { approved, rejected };
}

module.exports = { runQualityGate, checkItem, MANDATORY_FIELDS };
