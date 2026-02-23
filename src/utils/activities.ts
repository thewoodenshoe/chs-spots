import fs from 'fs';
import { configPath } from '@/lib/data-dir';

export interface Activity {
  name: string;
  icon: string;
  emoji: string;
  color: string;
  communityDriven?: boolean;
}

let cachedActivities: Activity[] | null = null;

/**
 * Load activities from config file
 * Caches the result for performance
 */
export function loadActivities(): Activity[] {
  if (cachedActivities) {
    return cachedActivities;
  }

  const activitiesPath = configPath('activities.json');
  
  try {
    if (fs.existsSync(activitiesPath)) {
      const content = fs.readFileSync(activitiesPath, 'utf8');
      cachedActivities = JSON.parse(content) as Activity[];
      return cachedActivities!
    }
  } catch (error) {
    console.error('Error loading activities.json:', error);
  }

  // Fallback to default activities if file doesn't exist
  cachedActivities = [
    { name: 'Happy Hour', icon: 'Martini', emoji: '🍹', color: '#0d9488' },
    { name: 'Brunch', icon: 'Coffee', emoji: '🥞', color: '#d97706' },
    { name: 'Fishing Spots', icon: 'Fish', emoji: '🎣', color: '#0284c7', communityDriven: true },
    { name: 'Must-See Spots', icon: 'Compass', emoji: '⭐', color: '#8b5cf6', communityDriven: true },
  ];
  
  return cachedActivities;
}

/**
 * Get activity names as array (for SpotType)
 */
export function getActivityNames(): string[] {
  return loadActivities().map(a => a.name);
}

/**
 * Get activity by name
 */
export function getActivityByName(name: string): Activity | undefined {
  return loadActivities().find(a => a.name === name);
}

/**
 * Clear cache (useful for testing or hot reloading)
 */
export function clearActivitiesCache(): void {
  cachedActivities = null;
}
