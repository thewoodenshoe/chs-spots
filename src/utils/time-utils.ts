import { Spot } from '@/contexts/SpotsContext';

function stripLabel(s: string): string {
  return /^\d/.test(s) ? s : s.replace(/^[a-zA-Z][a-zA-Z\s]*:\s*/, '');
}

function cleanNum(n: string): string {
  return n.replace(/:00$/, '').replace(/^0+(\d)/, '$1');
}

const TIME_RANGE_RE =
  /(\d{1,2}(?::\d{2})?)\s*(am|pm)?\s*(?:[-–]|\bto\b)\s*(\d{1,2}(?::\d{2})?)\s*(am|pm)/i;

function parseToMinutes(timeStr: string, ampm: string): number {
  let h = parseInt(timeStr);
  const min = timeStr.includes(':') ? parseInt(timeStr.split(':')[1]) : 0;
  const ap = ampm.toLowerCase();
  if (ap === 'pm' && h !== 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return h * 60 + min;
}

export function getSpotStartMinutes(spot: Spot): number | null {
  const raw = spot.promotionTime || spot.happyHourTime;
  if (!raw) return null;

  const cleaned = stripLabel(raw.split(',')[0].split('•')[0].trim());
  if (/all\s*day/i.test(cleaned)) return 0;

  const rm = cleaned.match(TIME_RANGE_RE);
  if (rm) return parseToMinutes(rm[1], rm[2] || rm[4]);

  const sm = cleaned.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (sm) return parseToMinutes(sm[1] + (sm[2] ? `:${sm[2]}` : ''), sm[3]);

  return null;
}

export function getSpotEndMinutes(spot: Spot): number | null {
  const raw = spot.promotionTime || spot.happyHourTime;
  if (!raw) return null;

  const cleaned = stripLabel(raw.split(',')[0].split('•')[0].trim());
  if (/all\s*day/i.test(cleaned)) return 23 * 60 + 59;

  const rm = cleaned.match(TIME_RANGE_RE);
  if (rm) return parseToMinutes(rm[3], rm[4]);

  return null;
}

export function extractCompactTime(spot: Spot): string | null {
  const raw = spot.promotionTime || spot.happyHourTime;
  if (!raw) return null;

  const cleaned = stripLabel(raw.split(',')[0].split('•')[0].trim());
  if (/all\s*day/i.test(cleaned)) return 'All day';

  const rm = cleaned.match(TIME_RANGE_RE);
  if (rm) {
    const sn = cleanNum(rm[1]);
    const sa = rm[2]?.toLowerCase() || '';
    const en = cleanNum(rm[3]);
    const ea = rm[4].toLowerCase();
    if (sa && sa !== ea) return `${sn}${sa}-${en}${ea}`;
    return `${sn}-${en}${ea}`;
  }

  const sm = cleaned.match(/(\d{1,2}(?::\d{2})?)\s*(am|pm)/i);
  if (sm) return `${cleanNum(sm[1])}${sm[2].toLowerCase()}`;

  return null;
}

function getEasternNow(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

const DAY_PATTERNS: Record<string, number[]> = {
  'daily': [0, 1, 2, 3, 4, 5, 6],
  'everyday': [0, 1, 2, 3, 4, 5, 6],
  'weekdays': [1, 2, 3, 4, 5],
  'weekends': [0, 6],
  'sunday': [0], 'sundays': [0], 'sun': [0],
  'monday': [1], 'mondays': [1], 'mon': [1],
  'tuesday': [2], 'tuesdays': [2], 'tue': [2], 'tues': [2],
  'wednesday': [3], 'wednesdays': [3], 'wed': [3], 'weds': [3],
  'thursday': [4], 'thursdays': [4], 'thu': [4], 'thur': [4], 'thurs': [4],
  'friday': [5], 'fridays': [5], 'fri': [5],
  'saturday': [6], 'saturdays': [6], 'sat': [6],
};

const MONTH_MAP: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

// Detects specific calendar dates like "Sunday May 10, 2026" or "May 10".
// Returns [dayOfWeek] if today matches, [] if not — never null.
function parseSpecificCalendarDate(text: string): number[] | null {
  const monthRe = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})\b/i;
  const m = text.match(monthRe);
  if (!m) return null;

  const month = MONTH_MAP[m[1].toLowerCase()];
  const day = parseInt(m[2], 10);
  const yearMatch = text.match(/\b(20\d{2})\b/);
  const now = getEasternNow();
  const year = yearMatch ? parseInt(yearMatch[1], 10) : now.getFullYear();

  if (now.getMonth() === month && now.getDate() === day && now.getFullYear() === year) {
    return [now.getDay()];
  }
  return [];
}

function parseDayPart(dayPart: string): number[] | null {
  const lower = dayPart.toLowerCase().replace(/\s+/g, ' ');

  // Specific calendar dates like "Sunday May 10, 2026" or "May 10"
  const calendarDate = parseSpecificCalendarDate(lower);
  if (calendarDate !== null) return calendarDate;

  // Check single-word matches first
  if (DAY_PATTERNS[lower]) return DAY_PATTERNS[lower];

  // Range: "Monday-Friday", "Tue-Sat", "Monday to Friday"
  const rangeMatch = lower.match(/^(\w+)\s*(?:[-–—]|\bto\b)\s*(\w+)$/);
  if (rangeMatch) {
    const startDay = DAY_PATTERNS[rangeMatch[1]];
    const endDay = DAY_PATTERNS[rangeMatch[2]];
    if (startDay?.length === 1 && endDay?.length === 1) {
      const si = startDay[0], ei = endDay[0];
      const days: number[] = [];
      for (let i = si; i !== (ei + 1) % 7; i = (i + 1) % 7) days.push(i);
      days.push(ei);
      return days;
    }
  }

  // Comma/ampersand list: "Friday, Saturday", "Fri & Sat"
  const parts = lower.split(/[,&]+/).map(s => s.trim());
  const collected: number[] = [];
  for (const p of parts) {
    // Handle sub-ranges within list: "Mon-Wed, Fri"
    const subRange = p.match(/^(\w+)\s*[-–—]+\s*(\w+)$/);
    if (subRange) {
      const s = DAY_PATTERNS[subRange[1]], e = DAY_PATTERNS[subRange[2]];
      if (s?.length === 1 && e?.length === 1) {
        for (let i = s[0]; i !== (e[0] + 1) % 7; i = (i + 1) % 7) collected.push(i);
        collected.push(e[0]);
        continue;
      }
    }
    const match = DAY_PATTERNS[p];
    if (match) collected.push(...match);
  }

  return collected.length > 0 ? collected : null;
}

function parseDays(raw: string): number[] | null {
  // Standard bullet format: "3pm-5pm • Mon-Fri"
  const bulletPart = raw.split('•').slice(1).join('•').trim();
  if (bulletPart) return parseDayPart(bulletPart);

  // Natural language format: "daily from 3pm to 5pm", "Monday to Friday from 4pm to 7pm"
  // Extract the part before "from <time>" or before the first standalone time reference
  const beforeTime = raw
    .replace(/\s*\bfrom\s+\d{1,2}(?::\d{2})?\s*(?:am|pm).*$/i, '')
    .replace(/\s*\d{1,2}(?::\d{2})?\s*(?:am|pm).*$/i, '')
    .trim();
  if (beforeTime) return parseDayPart(beforeTime);

  return null;
}

export type FreshnessLevel = 'fresh' | 'aging' | 'stale' | 'unknown';

export function getFreshness(
  verifiedDate: string | null | undefined,
  updatedDate?: string | null,
): {
  level: FreshnessLevel;
  label: string;
  daysAgo: number | null;
} {
  if (!verifiedDate) return { level: 'unknown', label: 'Unverified', daysAgo: null };
  const verified = new Date(verifiedDate);
  if (isNaN(verified.getTime())) return { level: 'unknown', label: 'Unverified', daysAgo: null };

  const now = new Date();
  const verifiedDays = Math.floor((now.getTime() - verified.getTime()) / 86_400_000);

  const verifiedLabel = verifiedDays === 0 ? 'Verified today' : `Verified ${verifiedDays}d ago`;

  let updatedLabel = '';
  if (updatedDate) {
    const updated = new Date(updatedDate);
    if (!isNaN(updated.getTime())) {
      const updatedDays = Math.floor((now.getTime() - updated.getTime()) / 86_400_000);
      if (updatedDays > verifiedDays) {
        updatedLabel = ` · Updated ${updatedDays}d ago`;
      }
    }
  }

  const label = verifiedLabel + updatedLabel;
  if (verifiedDays <= 7) return { level: 'fresh', label, daysAgo: verifiedDays };
  if (verifiedDays <= 14) return { level: 'aging', label, daysAgo: verifiedDays };
  return { level: 'stale', label, daysAgo: verifiedDays };
}

export function isSpotActiveNow(spot: Spot): boolean {
  const raw = spot.promotionTime || spot.happyHourTime || '';
  const now = getEasternNow();
  const allowedDays = parseDays(raw);

  // If activity is restricted to specific days and today is not one of them, never active
  if (allowedDays !== null && !allowedDays.includes(now.getDay())) {
    return false;
  }

  const start = getSpotStartMinutes(spot);
  const end = getSpotEndMinutes(spot);

  if (start !== null && end !== null) {
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    return end >= start
      ? nowMinutes >= start && nowMinutes <= end
      : nowMinutes >= start || nowMinutes <= end;
  }

  if (spot.operatingHours) {
    return isVenueOpenNow(spot.operatingHours);
  }

  return false;
}

function isVenueOpenNow(hours: Record<string, string | { open: string; close: string }>): boolean {
  const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
  const now = getEasternNow();
  const entry = hours[dayKeys[now.getDay()]];
  if (!entry || entry === 'closed') return false;
  if (typeof entry === 'string') return false;
  if (!entry.open || !entry.close) return false;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const [oh, om] = entry.open.split(':').map(Number);
  const [ch, cm] = entry.close.split(':').map(Number);
  const open = oh * 60 + (om || 0);
  const close = ch * 60 + (cm || 0);
  return close > open
    ? nowMin >= open && nowMin < close
    : nowMin >= open || nowMin < close;
}
