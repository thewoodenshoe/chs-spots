import fs from 'fs';
import path from 'path';

export interface Activity {
  name: string;
  icon: string;
  emoji: string;
  color: string;
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

  const activitiesPath = path.join(process.cwd(), 'data', 'config', 'activities.json');
  
  try {
    if (fs.existsSync(activitiesPath)) {
      const content = fs.readFileSync(activitiesPath, 'utf8');
      cachedActivities = JSON.parse(content);
      return cachedActivities;
    }
  } catch (error) {
    console.error('Error loading activities.json:', error);
  }

  // Fallback to default activities if file doesn't exist
  cachedActivities = [
    { name: 'Happy Hour', icon: 'Martini', emoji: '🍹', color: '#0d9488' },
    { name: 'Fishing Spots', icon: 'Fish', emoji: '🎣', color: '#0284c7' },
    { name: 'Sunset Spots', icon: 'Sunset', emoji: '🌅', color: '#f59e0b' },
    { name: 'Christmas Spots', icon: 'Gift', emoji: '🎄', color: '#f97316' },
    { name: 'Pickleball Games', icon: 'Activity', emoji: '🏓', color: '#10b981' },
    { name: 'Bike Routes', icon: 'Bike', emoji: '🚴', color: '#6366f1' },
    { name: 'Golf Cart Hacks', icon: 'Car', emoji: '🛺', color: '#8b5cf6' },
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
