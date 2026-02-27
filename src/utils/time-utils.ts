import { Spot } from '@/contexts/SpotsContext';

function stripLabel(s: string): string {
  return /^\d/.test(s) ? s : s.replace(/^[a-zA-Z][a-zA-Z\s]*:\s*/, '');
}

function cleanNum(n: string): string {
  return n.replace(/:00$/, '').replace(/^0+(\d)/, '$1');
}

const TIME_RANGE_RE =
  /(\d{1,2}(?::\d{2})?)\s*(am|pm)?\s*[-–]\s*(\d{1,2}(?::\d{2})?)\s*(am|pm)/i;

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

const DAY_PATTERNS: Record<string, number[]> = {
  'daily': [0, 1, 2, 3, 4, 5, 6],
  'everyday': [0, 1, 2, 3, 4, 5, 6],
  'weekdays': [1, 2, 3, 4, 5],
  'weekends': [0, 6],
  'sunday': [0], 'sun': [0],
  'monday': [1], 'mon': [1],
  'tuesday': [2], 'tue': [2], 'tues': [2],
  'wednesday': [3], 'wed': [3], 'weds': [3],
  'thursday': [4], 'thu': [4], 'thur': [4], 'thurs': [4],
  'friday': [5], 'fri': [5],
  'saturday': [6], 'sat': [6],
};

const DAY_ORDER = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function parseDays(raw: string): number[] | null {
  const dayPart = raw.split('•').slice(1).join('•').trim();
  if (!dayPart) return null;

  const lower = dayPart.toLowerCase().replace(/\s+/g, ' ');

  // Check single-word matches first
  if (DAY_PATTERNS[lower]) return DAY_PATTERNS[lower];

  // Range: "Monday-Friday", "Tue-Sat"
  const rangeMatch = lower.match(/^(\w+)\s*[-–—to]+\s*(\w+)$/);
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

export function isSpotActiveNow(spot: Spot): boolean {
  const start = getSpotStartMinutes(spot);
  const end = getSpotEndMinutes(spot);
  if (start === null || end === null) return false;

  const raw = spot.promotionTime || spot.happyHourTime || '';

  // Check day-of-week if specified
  const allowedDays = parseDays(raw);
  if (allowedDays !== null) {
    const today = new Date().getDay();
    if (!allowedDays.includes(today)) return false;
  }

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  if (end >= start) {
    return nowMinutes >= start && nowMinutes <= end;
  }
  // Wraps past midnight (e.g. 10pm-2am)
  return nowMinutes >= start || nowMinutes <= end;
}
