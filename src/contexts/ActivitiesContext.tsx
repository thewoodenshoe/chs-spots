'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Activity } from '@/utils/activities';

interface ActivitiesContextType {
  activities: Activity[];
  loading: boolean;
  error: string | null;
}

const ActivitiesContext = createContext<ActivitiesContextType>({
  activities: [],
  loading: true,
  error: null,
});

export function ActivitiesProvider({ children }: { children: ReactNode }) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadActivities() {
      try {
        const response = await fetch('/api/activities');
        if (!response.ok) {
          throw new Error('Failed to load activities');
        }
        const data = await response.json();
        setActivities(data);
        setError(null);
      } catch (err) {
        console.error('Error loading activities:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
        // Set fallback activities
        setActivities([
          { name: 'Happy Hour', icon: 'Martini', emoji: '🍹', color: '#0d9488' },
          { name: 'Brunch', icon: 'Coffee', emoji: '🥞', color: '#d97706' },
          { name: 'Fishing Spots', icon: 'Fish', emoji: '🎣', color: '#0284c7', communityDriven: true },
          { name: 'Local Gems', icon: 'Compass', emoji: '💎', color: '#8b5cf6', communityDriven: true },
        ]);
      } finally {
        setLoading(false);
      }
    }

    loadActivities();
  }, []);

  return (
    <ActivitiesContext.Provider value={{ activities, loading, error }}>
      {children}
    </ActivitiesContext.Provider>
  );
}

export function useActivities() {
  return useContext(ActivitiesContext);
}
