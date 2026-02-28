import type { OperatingHours } from '@/contexts/VenuesContext';
import { formatTime12 } from '@/utils/format-hours';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function getEasternNow(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

function todayKey(): string {
  return DAY_KEYS[getEasternNow().getDay()];
}

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + (m || 0);
}

export function isOpenNow(hours: OperatingHours | null | undefined): boolean {
  if (!hours) return false;

  const day = todayKey();
  const entry = hours[day];
  if (!entry || entry === 'closed') return false;

  const now = getEasternNow();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const open = toMinutes(entry.open);
  const close = toMinutes(entry.close);

  if (close > open) {
    return nowMin >= open && nowMin < close;
  }
  // Wraps past midnight (e.g. 17:00 → 02:00)
  return nowMin >= open || nowMin < close;
}

export function getOpenStatus(hours: OperatingHours | null | undefined): {
  isOpen: boolean;
  label: string;
  closesAt?: string;
  opensAt?: string;
} {
  if (!hours) return { isOpen: false, label: '' };

  const day = todayKey();
  const entry = hours[day];

  if (!entry || entry === 'closed') {
    const nextOpen = findNextOpen(hours, day);
    return { isOpen: false, label: 'Closed', opensAt: nextOpen || undefined };
  }

  const now = getEasternNow();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const open = toMinutes(entry.open);
  const close = toMinutes(entry.close);

  const isCurrentlyOpen = close > open
    ? nowMin >= open && nowMin < close
    : nowMin >= open || nowMin < close;

  if (isCurrentlyOpen) {
    const closingSoon = close > open
      ? (close - nowMin) <= 60
      : (close + 24 * 60 - nowMin) % (24 * 60) <= 60;

    return {
      isOpen: true,
      label: closingSoon ? 'Closing soon' : 'Open',
      closesAt: formatTime12(entry.close),
    };
  }

  if (nowMin < open) {
    return { isOpen: false, label: 'Closed', opensAt: formatTime12(entry.open) };
  }

  const nextOpen = findNextOpen(hours, day);
  return { isOpen: false, label: 'Closed', opensAt: nextOpen || undefined };
}

function findNextOpen(hours: OperatingHours, currentDay: string): string | null {
  const idx = DAY_KEYS.indexOf(currentDay as typeof DAY_KEYS[number]);
  for (let i = 1; i <= 7; i++) {
    const nextDay = DAY_KEYS[(idx + i) % 7];
    const entry = hours[nextDay];
    if (entry && entry !== 'closed') {
      const dayLabel = i === 1 ? 'tomorrow' : nextDay.charAt(0).toUpperCase() + nextDay.slice(1);
      return `${dayLabel} ${formatTime12(entry.open)}`;
    }
  }
  return null;
}
