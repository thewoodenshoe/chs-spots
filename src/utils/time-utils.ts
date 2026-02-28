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

function getEasternNow(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
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
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const [oh, om] = entry.open.split(':').map(Number);
  const [ch, cm] = entry.close.split(':').map(Number);
  const open = oh * 60 + (om || 0);
  const close = ch * 60 + (cm || 0);
  return close > open
    ? nowMin >= open && nowMin < close
    : nowMin >= open || nowMin < close;
}
