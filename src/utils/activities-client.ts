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
    { name: 'Brunch', icon: 'Coffee', emoji: '🥞', color: '#d97706' },
    { name: 'Live Music', icon: 'Music', emoji: '🎵', color: '#7c3aed' },
    { name: 'Coffee Shops', icon: 'Coffee', emoji: '☕', color: '#92400e' },
    { name: 'Rooftop Bars', icon: 'Building', emoji: '🏙️', color: '#0ea5e9' },
    { name: 'Dog-Friendly', icon: 'Dog', emoji: '🐕', color: '#ea580c' },
    { name: 'Landmarks & Attractions', icon: 'Landmark', emoji: '🏛️', color: '#4f46e5' },
    { name: 'Recently Opened', icon: 'Sparkles', emoji: '🆕', color: '#16a34a' },
    { name: 'Coming Soon', icon: 'Clock', emoji: '🔜', color: '#7c3aed' },
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
