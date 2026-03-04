import { Spot } from '@/contexts/SpotsContext';

function getEasternNow(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

function formatAmPm(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  const hour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m ? `${hour}:${String(m).padStart(2, '0')}${suffix}` : `${hour}${suffix}`;
}

export function getSpotStartMinutes(spot: Spot): number | null {
  if (!spot.timeStart) return null;
  return toMinutes(spot.timeStart);
}

export function getSpotEndMinutes(spot: Spot): number | null {
  if (!spot.timeEnd) return null;
  return toMinutes(spot.timeEnd);
}

export function extractCompactTime(spot: Spot): string | null {
  if (!spot.timeStart) return null;
  if (spot.timeStart === '00:00' && spot.timeEnd === '23:59') return 'All day';
  const start = formatAmPm(spot.timeStart);
  if (!spot.timeEnd) return start;
  const end = formatAmPm(spot.timeEnd);
  return `${start}-${end}`;
}

export function isSpotActiveNow(spot: Spot): boolean {
  const now = getEasternNow();

  if (spot.specificDate) {
    const [y, m, d] = spot.specificDate.split('-').map(Number);
    if (now.getFullYear() !== y || now.getMonth() !== m - 1 || now.getDate() !== d) return false;
  } else if (spot.days && spot.days.length > 0) {
    if (!spot.days.includes(now.getDay())) return false;
  }

  if (spot.timeStart && spot.timeEnd) {
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const start = toMinutes(spot.timeStart);
    const end = toMinutes(spot.timeEnd);
    return end >= start
      ? nowMin >= start && nowMin <= end
      : nowMin >= start || nowMin <= end;
  }

  if (spot.operatingHours) return isVenueOpenNow(spot.operatingHours);
  return false;
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

function isVenueOpenNow(hours: Record<string, string | { open: string; close: string }>): boolean {
  const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
  const now = getEasternNow();
  const entry = hours[dayKeys[now.getDay()]];
  if (!entry || entry === 'closed') return false;
  if (typeof entry === 'string') return false;
  if (!entry.open || !entry.close) return false;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const open = toMinutes(entry.open);
  const close = toMinutes(entry.close);
  return close > open
    ? nowMin >= open && nowMin < close
    : nowMin >= open || nowMin < close;
}
