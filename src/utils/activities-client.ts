'use client';

import { Activity } from './activities';

// Client-side activities data (loaded from config at build time)
// This will be populated by a server component or API call
let clientActivities: Activity[] | null = null;

/**
 * Set activities data (called from server component or API)
 */
export function setActivities(activities: Activity[]): void {
  clientActivities = activities;
}

/**
 * Get activities (client-side)
 * Falls back to default if not set
 */
export function getActivities(): Activity[] {
  if (clientActivities) {
    return clientActivities;
  }

  // Fallback defaults
  return [
    { name: 'Happy Hour', icon: 'Martini', emoji: '🍹', color: '#0d9488' },
    { name: 'Fishing Spots', icon: 'Fish', emoji: '🎣', color: '#0284c7' },
    { name: 'Sunset Spots', icon: 'Sunset', emoji: '🌅', color: '#f59e0b' },
    { name: 'Christmas Spots', icon: 'Gift', emoji: '🎄', color: '#f97316' },
    { name: 'Pickleball Games', icon: 'Activity', emoji: '🏓', color: '#10b981' },
    { name: 'Bike Routes', icon: 'Bike', emoji: '🚴', color: '#6366f1' },
    { name: 'Golf Cart Hacks', icon: 'Car', emoji: '🛺', color: '#8b5cf6' },
  ];
}

/**
 * Get activity names as array
 */
export function getActivityNames(): string[] {
  return getActivities().map(a => a.name);
}

/**
 * Get activity by name
 */
export function getActivityByName(name: string): Activity | undefined {
  return getActivities().find(a => a.name === name);
}
