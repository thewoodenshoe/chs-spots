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

export function isSpotActiveNow(spot: Spot): boolean {
  const start = getSpotStartMinutes(spot);
  const end = getSpotEndMinutes(spot);
  if (start === null || end === null) return false;

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  if (end >= start) {
    return nowMinutes >= start && nowMinutes <= end;
  }
  // Wraps past midnight (e.g. 10pm-2am)
  return nowMinutes >= start || nowMinutes <= end;
}
