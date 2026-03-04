/**
 * Shared time/day parsing for ETL scripts.
 * Converts free-text promotion_time strings to structured fields:
 *   time_start, time_end (HH:MM 24h), days (CSV of JS getDay numbers), specific_date (ISO).
 */

const TIME_RANGE_RE =
  /(\d{1,2}(?::\d{2})?)\s*(am|pm)?\s*(?:[-–]|\bto\b)\s*(\d{1,2}(?::\d{2})?)\s*(am|pm)/i;

const SINGLE_TIME_RE = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i;

const DAY_MAP = {
  daily: [0, 1, 2, 3, 4, 5, 6], everyday: [0, 1, 2, 3, 4, 5, 6],
  weekdays: [1, 2, 3, 4, 5], weekends: [0, 6],
  sunday: [0], sundays: [0], sun: [0],
  monday: [1], mondays: [1], mon: [1],
  tuesday: [2], tuesdays: [2], tue: [2], tues: [2],
  wednesday: [3], wednesdays: [3], wed: [3], weds: [3],
  thursday: [4], thursdays: [4], thu: [4], thur: [4], thurs: [4],
  friday: [5], fridays: [5], fri: [5],
  saturday: [6], saturdays: [6], sat: [6],
};

function timeTo24h(timeStr, ampm) {
  let h = parseInt(timeStr);
  const min = timeStr.includes(':') ? parseInt(timeStr.split(':')[1]) : 0;
  const ap = ampm.toLowerCase();
  if (ap === 'pm' && h !== 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function parseTimeRange(text) {
  const m = text.match(TIME_RANGE_RE);
  if (!m) return { timeStart: null, timeEnd: null };
  return {
    timeStart: timeTo24h(m[1], m[2] || m[4]),
    timeEnd: timeTo24h(m[3], m[4]),
  };
}

function parseSingleTime(text) {
  const m = text.match(SINGLE_TIME_RE);
  if (!m) return null;
  return timeTo24h(m[1] + (m[2] ? `:${m[2]}` : ''), m[3]);
}

function parseDayPart(dayPart) {
  const lower = dayPart.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!lower) return null;
  if (DAY_MAP[lower]) return DAY_MAP[lower];

  const rangeMatch = lower.match(/^(\w+)\s*(?:[-–—]|\bto\b)\s*(\w+)$/);
  if (rangeMatch) {
    const s = DAY_MAP[rangeMatch[1]], e = DAY_MAP[rangeMatch[2]];
    if (s?.length === 1 && e?.length === 1) {
      const days = [];
      for (let i = s[0]; i !== (e[0] + 1) % 7; i = (i + 1) % 7) days.push(i);
      days.push(e[0]);
      return [...new Set(days)];
    }
  }

  const parts = lower.split(/[,&]+/).map(s => s.trim());
  const collected = [];
  for (const p of parts) {
    const subRange = p.match(/^(\w+)\s*[-–—]+\s*(\w+)$/);
    if (subRange) {
      const s = DAY_MAP[subRange[1]], e = DAY_MAP[subRange[2]];
      if (s?.length === 1 && e?.length === 1) {
        for (let i = s[0]; i !== (e[0] + 1) % 7; i = (i + 1) % 7) collected.push(i);
        collected.push(e[0]);
        continue;
      }
    }
    const match = DAY_MAP[p];
    if (match) collected.push(...match);
  }
  return collected.length > 0 ? [...new Set(collected)] : null;
}

/**
 * Parse a promotion_time string into structured fields.
 * @param {string} raw - e.g. "4pm-6pm • Mon-Fri", "daily from 3pm to 5pm"
 * @returns {{ timeStart: string|null, timeEnd: string|null, days: string|null, specificDate: string|null }}
 */
function parsePromotionTime(raw) {
  if (!raw) return { timeStart: null, timeEnd: null, days: null, specificDate: null };

  const first = raw.split(',')[0].trim();
  const allDay = /all\s*day/i.test(first);

  let { timeStart, timeEnd } = allDay
    ? { timeStart: '00:00', timeEnd: '23:59' }
    : parseTimeRange(first);

  if (!timeStart && !allDay) {
    const single = parseSingleTime(first);
    if (single) timeStart = single;
  }

  let dayNums = null;

  const bulletPart = raw.split('•').slice(1).join('•').trim();
  if (bulletPart) {
    dayNums = parseDayPart(bulletPart);
  } else {
    const beforeTime = raw
      .replace(/\s*\bfrom\s+\d{1,2}(?::\d{2})?\s*(?:am|pm).*$/i, '')
      .replace(/\s*\d{1,2}(?::\d{2})?\s*(?:am|pm).*$/i, '')
      .trim();
    if (beforeTime) dayNums = parseDayPart(beforeTime);
  }

  const days = dayNums ? dayNums.sort((a, b) => a - b).join(',') : null;

  return { timeStart, timeEnd, days, specificDate: null };
}

module.exports = { parsePromotionTime, parseTimeRange, parseDayPart, timeTo24h, DAY_MAP };
