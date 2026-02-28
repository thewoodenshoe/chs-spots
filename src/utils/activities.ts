import { activitiesDb } from '@/lib/db';

export interface Activity {
  name: string;
  icon: string;
  emoji: string;
  color: string;
  communityDriven?: boolean;
  venueRequired?: boolean;
}

const DEFAULT_ACTIVITIES: Activity[] = [
  { name: 'Happy Hour', icon: 'Martini', emoji: '🍹', color: '#0d9488' },
  { name: 'Brunch', icon: 'Coffee', emoji: '🥞', color: '#d97706' },
  { name: 'Must-Do Spots', icon: 'Compass', emoji: '⭐', color: '#8b5cf6', communityDriven: true },
];

let cachedActivities: Activity[] | null = null;

export function loadActivities(): Activity[] {
  if (cachedActivities) return cachedActivities;

  try {
    const rows = activitiesDb.getAll();
    if (rows.length > 0) {
      cachedActivities = rows.map(r => ({
        name: r.name,
        icon: r.icon || 'Star',
        emoji: r.emoji || '⭐',
        color: r.color || '#6366f1',
        ...(r.community_driven ? { communityDriven: true } : {}),
        venueRequired: r.venue_required !== 0,
      }));
      return cachedActivities;
    }
  } catch (error) {
    console.error('Error loading activities from database:', error);
  }

  cachedActivities = DEFAULT_ACTIVITIES;
  return cachedActivities;
}

export function getActivityNames(): string[] {
  return loadActivities().map(a => a.name);
}

export function getActivityByName(name: string): Activity | undefined {
  return loadActivities().find(a => a.name === name);
}

export function clearActivitiesCache(): void {
  cachedActivities = null;
}
