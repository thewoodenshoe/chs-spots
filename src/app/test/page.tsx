'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useSpots } from '@/contexts/SpotsContext';
import { useActivities } from '@/contexts/ActivitiesContext';
import { ACTIVITY_GROUPS } from '@/components/FilterModal';
import { ALL_VENUES } from '@/hooks/useSpotFiltering';
import { useVenues } from '@/contexts/VenuesContext';
import { isSpotActiveNow } from '@/utils/time-utils';

export default function TestLanding() {
  const router = useRouter();
  const { spots, loading } = useSpots();
  const { activities } = useActivities();
  const { venues } = useVenues();

  const activityMap = useMemo(() => {
    const m = new Map<string, { emoji: string; color: string }>();
    activities.forEach(a => m.set(a.name, { emoji: a.emoji, color: a.color }));
    return m;
  }, [activities]);

  const spotCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const spot of spots) {
      if (spot.lat === 0 && spot.lng === 0) continue;
      counts[spot.type] = (counts[spot.type] || 0) + 1;
    }
    return counts;
  }, [spots]);

  const activeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const spot of spots) {
      if (isSpotActiveNow(spot)) {
        counts[spot.type] = (counts[spot.type] || 0) + 1;
      }
    }
    return counts;
  }, [spots]);

  const handleSelect = (activity: string) => {
    if (activity === ALL_VENUES) {
      router.push('/?activity=All%20Venues');
    } else {
      router.push(`/?activity=${encodeURIComponent(activity)}`);
    }
  };

  const visibleGroups = useMemo(() => {
    return ACTIVITY_GROUPS
      .filter(g => g.label !== 'Everything')
      .map(group => ({
        ...group,
        activities: group.activities.filter(name => {
          if (name === ALL_VENUES) return false;
          const count = spotCounts[name] ?? 0;
          if (count === 0 && (name === 'Recently Opened' || name === 'Coming Soon')) return false;
          return true;
        }),
      }))
      .filter(group => group.activities.length > 0);
  }, [spotCounts]);

  return (
    <div className="relative min-h-dvh w-screen bg-gray-50">
      <header className="sticky top-0 z-50 bg-black/70 backdrop-blur-md safe-area-top">
        <div className="flex h-12 items-center justify-center px-4">
          <h1 className="text-base font-bold text-white tracking-tight">
            Charleston Finds & Deals
          </h1>
        </div>
      </header>

      <main className="px-4 pt-6 pb-24 max-w-lg mx-auto">
        <div className="text-center mb-6">
          <p className="text-sm text-gray-500">What are you looking for?</p>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-teal-500" />
          </div>
        ) : (
          <div className="space-y-6">
            {visibleGroups.map((group) => (
              <div key={group.label}>
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400 px-1">
                  {group.label}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {group.activities.map((name) => {
                    const config = activityMap.get(name);
                    const emoji = config?.emoji || '⭐';
                    const color = config?.color || '#6366f1';
                    const count = spotCounts[name] ?? 0;
                    const active = activeCounts[name] ?? 0;

                    return (
                      <button
                        key={name}
                        onClick={() => handleSelect(name)}
                        className="flex flex-col items-center gap-2 rounded-2xl border-2 border-gray-100 bg-white p-5 shadow-sm transition-all hover:border-teal-300 hover:shadow-md active:scale-95 touch-manipulation"
                      >
                        <span
                          className="flex h-14 w-14 items-center justify-center rounded-2xl text-3xl"
                          style={{ backgroundColor: `${color}15` }}
                        >
                          {emoji}
                        </span>
                        <span className="text-sm font-semibold text-gray-800 text-center leading-tight">
                          {name}
                        </span>
                        <span className="text-xs text-gray-400">
                          {count} spot{count !== 1 ? 's' : ''}
                        </span>
                        {active > 0 && (
                          <span className="flex items-center gap-1 text-[10px] font-semibold text-green-600">
                            <span className="relative flex h-1.5 w-1.5">
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500" />
                            </span>
                            {active} active now
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            <button
              onClick={() => handleSelect(ALL_VENUES)}
              className="flex w-full items-center gap-4 rounded-2xl border-2 border-gray-100 bg-white p-4 shadow-sm transition-all hover:border-teal-300 hover:shadow-md active:scale-95 touch-manipulation"
            >
              <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-gray-100 text-2xl">
                📍
              </span>
              <div className="text-left">
                <span className="text-sm font-semibold text-gray-800">All Venues</span>
                <p className="text-xs text-gray-400">{venues.length} places in Charleston</p>
              </div>
            </button>
          </div>
        )}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-black/70 backdrop-blur-md safe-area-bottom">
        <div className="flex h-[56px] items-stretch justify-around px-2">
          <button
            onClick={() => router.push('/')}
            className="flex flex-1 flex-col items-center justify-center gap-0.5 text-white/70 hover:text-white transition-all"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
            <span className="text-[10px] font-medium leading-tight">Map</span>
          </button>
          <button
            onClick={() => router.push('/')}
            className="flex flex-1 flex-col items-center justify-center gap-0.5 text-white/70 hover:text-white transition-all"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
            </svg>
            <span className="text-[10px] font-medium leading-tight">List</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
