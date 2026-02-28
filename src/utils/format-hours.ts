import type { OperatingHours } from '@/contexts/VenuesContext';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const DAY_LABELS: Record<string, string> = {
  sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat',
};

export function formatTime12(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m ? `${h12}:${String(m).padStart(2, '0')}${ampm}` : `${h12}${ampm}`;
}

export interface DayHours {
  day: string;
  hours: string;
  isToday: boolean;
}

export function formatFullWeekHours(hours: OperatingHours | null): DayHours[] {
  if (!hours) return [];
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const todayIdx = now.getDay();
  return DAY_KEYS.map((key, idx) => {
    const entry = hours[key];
    const h = !entry || entry === 'closed'
      ? 'Closed'
      : `${formatTime12(entry.open)} – ${formatTime12(entry.close)}`;
    return { day: DAY_LABELS[key], hours: h, isToday: idx === todayIdx };
  });
}
