'use strict';

/**
 * Rule-based logic validation for spots and venue operating hours.
 * Catches impossible times, misclassified activities, and operating hours
 * that conflict with activity schedules.
 *
 * Returns: { passed, flagged, failed } — each an array of { spot, issues[] }
 */

const HOUR_RULES = {
  'Happy Hour': { minStart: 11, maxStart: 22, minEnd: 14, maxEnd: 26, minDur: 30, maxDur: 480 },
  'Brunch':     { minStart: 6,  maxStart: 14, minEnd: 9,  maxEnd: 17, minDur: 60, maxDur: 480 },
  'Live Music': { minStart: 10, maxStart: 23, minEnd: 14, maxEnd: 28, minDur: 60, maxDur: 600 },
};

function parseHHMM(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1]) * 60 + parseInt(m[2]);
}

function fmtMin(min) {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function parseDays(d) {
  if (!d || typeof d !== 'string') return null;
  const nums = d.split(',').map(n => parseInt(n.trim())).filter(n => n >= 0 && n <= 6);
  return nums.length > 0 ? nums : null;
}

function checkActivityTimes(spot) {
  const issues = [];
  const rules = HOUR_RULES[spot.type];
  if (!rules) return issues;

  const start = parseHHMM(spot.time_start);
  const end = parseHHMM(spot.time_end);

  if (start !== null) {
    const startH = start / 60;
    if (startH < rules.minStart) {
      issues.push({ severity: 'warn', rule: 'early_start', msg: `${spot.type} starts at ${spot.time_start} (before ${rules.minStart}:00)` });
    }
    if (startH > rules.maxStart) {
      issues.push({ severity: 'fail', rule: 'late_start', msg: `${spot.type} starts at ${spot.time_start} (after ${rules.maxStart}:00)` });
    }
  }

  if (end !== null) {
    let endH = end / 60;
    if (endH < 4) endH += 24;
    if (endH < rules.minEnd) {
      issues.push({ severity: 'warn', rule: 'early_end', msg: `${spot.type} ends at ${spot.time_end} (before ${rules.minEnd}:00)` });
    }
    if (endH > rules.maxEnd) {
      issues.push({ severity: 'fail', rule: 'late_end', msg: `${spot.type} ends at ${spot.time_end} (after ${fmtMin(rules.maxEnd * 60)})` });
    }
  }

  if (start !== null && end !== null) {
    let duration = end - start;
    if (duration < 0) duration += 1440;
    if (duration < rules.minDur) {
      issues.push({ severity: 'warn', rule: 'short_duration', msg: `${spot.type} duration ${duration}min (< ${rules.minDur}min)` });
    }
    if (duration > rules.maxDur) {
      issues.push({ severity: 'warn', rule: 'long_duration', msg: `${spot.type} duration ${duration}min (> ${rules.maxDur}min)` });
    }
  }

  return issues;
}

function checkDays(spot) {
  const issues = [];
  const days = parseDays(spot.days);
  if (!days) return issues;

  if (spot.type === 'Brunch' && days.length === 7) {
    issues.push({ severity: 'warn', rule: 'brunch_daily', msg: 'Brunch listed as daily — unusual, likely misclassified operating hours' });
  }
  if (spot.type === 'Happy Hour' && days.length === 7) {
    issues.push({ severity: 'warn', rule: 'hh_daily', msg: 'Happy Hour listed as daily — verify this is a genuine deal, not regular hours' });
  }

  return issues;
}

function checkOperatingHoursConsistency(spot, venueHours) {
  const issues = [];
  if (!venueHours || typeof venueHours !== 'object') return issues;

  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const spotDays = parseDays(spot.days);
  if (!spotDays) return issues;

  const spotStart = parseHHMM(spot.time_start);
  if (spotStart === null) return issues;

  for (const dayNum of spotDays) {
    const dayName = dayNames[dayNum];
    const hours = venueHours[dayName];
    if (!hours || hours === 'closed') {
      issues.push({
        severity: 'warn',
        rule: 'activity_on_closed_day',
        msg: `${spot.type} scheduled on ${dayName} but venue is closed`,
      });
      continue;
    }
    if (hours.open) {
      const venueOpen = parseHHMM(hours.open);
      if (venueOpen !== null && spotStart < venueOpen && spotStart > 0) {
        issues.push({
          severity: 'warn',
          rule: 'activity_before_open',
          msg: `${spot.type} starts at ${spot.time_start} but venue opens at ${hours.open} on ${dayName}`,
        });
      }
    }
  }

  return issues;
}

function checkOperatingHoursQuality(venue) {
  const issues = [];
  if (!venue.operating_hours) {
    issues.push({ severity: 'info', rule: 'no_hours', msg: `Venue "${venue.name}" has no operating hours` });
    return issues;
  }

  let hours;
  try {
    hours = typeof venue.operating_hours === 'string'
      ? JSON.parse(venue.operating_hours)
      : venue.operating_hours;
  } catch {
    issues.push({ severity: 'fail', rule: 'invalid_hours_json', msg: `Venue "${venue.name}" has unparseable operating_hours` });
    return issues;
  }

  const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  let closedCount = 0;
  let nullCount = 0;

  for (const day of dayNames) {
    const h = hours[day];
    if (!h || h === null) { nullCount++; continue; }
    if (h === 'closed') { closedCount++; continue; }
    if (h.open && h.close) {
      const open = parseHHMM(h.open);
      const close = parseHHMM(h.close);
      if (open !== null && close !== null) {
        let dur = close - open;
        if (dur < 0) dur += 1440;
        if (dur > 1080) {
          issues.push({ severity: 'warn', rule: 'long_business_day', msg: `Venue "${venue.name}" open ${dur / 60}hrs on ${day}` });
        }
      }
    }
  }

  if (nullCount === 7) {
    issues.push({ severity: 'warn', rule: 'all_hours_null', msg: `Venue "${venue.name}" has operating_hours but all days are null` });
  }
  if (closedCount >= 5) {
    issues.push({ severity: 'warn', rule: 'mostly_closed', msg: `Venue "${venue.name}" closed ${closedCount}/7 days` });
  }

  return issues;
}

/**
 * Run all logic checks on a set of spots with their venue data.
 * @param {Array} spots — spot objects with type, time_start, time_end, days
 * @param {Map|Object} venueMap — venue_id -> venue object (with operating_hours)
 * @returns {{ passed: Array, flagged: Array, failed: Array }}
 */
function runLogicChecks(spots, venueMap) {
  const passed = [];
  const flagged = [];
  const failed = [];

  for (const spot of spots) {
    const issues = [
      ...checkActivityTimes(spot),
      ...checkDays(spot),
    ];

    const venue = venueMap instanceof Map ? venueMap.get(spot.venue_id) : venueMap[spot.venue_id];
    if (venue) {
      let hours = null;
      try {
        hours = typeof venue.operating_hours === 'string'
          ? JSON.parse(venue.operating_hours) : venue.operating_hours;
      } catch { /* skip */ }
      if (hours) issues.push(...checkOperatingHoursConsistency(spot, hours));
    }

    const hasFail = issues.some(i => i.severity === 'fail');
    const hasWarn = issues.some(i => i.severity === 'warn');

    if (hasFail) {
      failed.push({ spot, issues });
    } else if (hasWarn) {
      flagged.push({ spot, issues });
    } else {
      passed.push({ spot, issues });
    }
  }

  return { passed, flagged, failed };
}

module.exports = {
  runLogicChecks,
  checkActivityTimes,
  checkDays,
  checkOperatingHoursConsistency,
  checkOperatingHoursQuality,
};
