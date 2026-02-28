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

      <main className="px-3 pt-5 pb-8 max-w-lg mx-auto">
        <div className="text-center mb-5">
          <p className="text-sm text-gray-500">What are you looking for?</p>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-teal-500" />
          </div>
        ) : (
          <div className="space-y-5">
            {visibleGroups.map((group) => (
              <div key={group.label}>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400 px-0.5">
                  {group.label}
                </p>
                <div className="grid grid-cols-4 gap-2">
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
                        className="flex flex-col items-center gap-1 rounded-xl border border-gray-100 bg-white px-1 py-3 shadow-sm transition-all hover:border-teal-300 hover:shadow-md active:scale-95 touch-manipulation"
                      >
                        <span
                          className="flex h-10 w-10 items-center justify-center rounded-xl text-xl"
                          style={{ backgroundColor: `${color}15` }}
                        >
                          {emoji}
                        </span>
                        <span className="text-[11px] font-semibold text-gray-800 text-center leading-tight">
                          {name}
                        </span>
                        <span className="text-[10px] text-gray-400">
                          {count}
                        </span>
                        {active > 0 && (
                          <span className="flex items-center gap-0.5 text-[9px] font-semibold text-green-600">
                            <span className="relative flex h-1.5 w-1.5">
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500" />
                            </span>
                            {active}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400 px-0.5">
                Everything
              </p>
              <button
                onClick={() => handleSelect(ALL_VENUES)}
                className="flex w-full items-center gap-3 rounded-xl border border-gray-100 bg-white px-3 py-3 shadow-sm transition-all hover:border-teal-300 hover:shadow-md active:scale-95 touch-manipulation"
              >
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gray-100 text-xl">
                  📍
                </span>
                <div className="text-left">
                  <span className="text-[11px] font-semibold text-gray-800">All Venues</span>
                  <p className="text-[10px] text-gray-400">{venues.length} places</p>
                </div>
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
