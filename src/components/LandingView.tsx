'use client';

import { useState, useEffect, useMemo } from 'react';
import { Spot } from '@/contexts/SpotsContext';
import { Activity } from '@/utils/activities';
import { ACTIVITY_GROUPS, SpotType } from '@/components/FilterModal';
import { ALL_VENUES } from '@/hooks/useSpotFiltering';
import { isSpotActiveNow } from '@/utils/time-utils';

const PASTEL_BG: Record<string, string> = {
  'Happy Hour': 'bg-amber-50 border-amber-200',
  'Brunch': 'bg-orange-50 border-orange-200',
  'Live Music': 'bg-violet-50 border-violet-200',
  'Coffee Shops': 'bg-rose-50 border-rose-200',
  'Rooftop Bars': 'bg-sky-50 border-sky-200',
  'Dog-Friendly': 'bg-lime-50 border-lime-200',
  'Landmarks & Attractions': 'bg-indigo-50 border-indigo-200',
  'Recently Opened': 'bg-emerald-50 border-emerald-200',
  'Coming Soon': 'bg-yellow-50 border-yellow-200',
};

const LANDING_GROUP_ORDER = ["What's Happening", "What's New", 'Explore'];

interface LandingViewProps {
  spots: Spot[];
  activities: Activity[];
  venueCount: number;
  loading: boolean;
  userLocation: { lat: number; lng: number } | null;
  onSelectActivity: (activity: SpotType) => void;
  onSearch: () => void;
}

export default function LandingView({
  spots, activities, venueCount, loading, userLocation, onSelectActivity, onSearch,
}: LandingViewProps) {
  const activityMap = useMemo(() => {
    const m = new Map<string, { emoji: string; color: string }>();
    activities.forEach(a => m.set(a.name, { emoji: a.emoji, color: a.color }));
    return m;
  }, [activities]);

  const [clockTick, setClockTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setClockTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

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
    let pool = spots.filter(s => s.lat !== 0 || s.lng !== 0);
    if (userLocation) {
      pool = pool
        .map(s => ({
          s,
          d: (s.lat - userLocation.lat) ** 2 + (s.lng - userLocation.lng) ** 2,
        }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 100)
        .map(x => x.s);
    }
    for (const spot of pool) {
      if (isSpotActiveNow(spot)) {
        counts[spot.type] = (counts[spot.type] || 0) + 1;
      }
    }
    return counts;
  }, [spots, userLocation, clockTick]);

  const visibleGroups = useMemo(() => {
    return LANDING_GROUP_ORDER
      .map(label => ACTIVITY_GROUPS.find(g => g.label === label))
      .filter((g): g is typeof ACTIVITY_GROUPS[0] => !!g)
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

  const totalSpots = spots.filter(s => s.lat !== 0 || s.lng !== 0).length;

  return (
    <div className="relative h-dvh w-screen overflow-y-auto overscroll-contain bg-gray-50/80">
      <header className="bg-gradient-to-br from-teal-700 to-teal-800 px-5 pt-10 pb-6 safe-area-top">
        <h1 className="text-xl font-bold text-white tracking-tight text-center animate-fade-in">
          Charleston Finds & Deals
        </h1>
        <p className="mt-1.5 text-sm text-teal-100 text-center animate-fade-in-delay">
          {totalSpots} deals updated nightly from {venueCount} venues
        </p>

        <button
          onClick={onSearch}
          className="mt-4 flex w-full items-center gap-3 rounded-xl bg-white/15 backdrop-blur-sm px-4 py-3 text-sm text-teal-100 transition-all hover:bg-white/25 active:scale-[0.98] touch-manipulation animate-fade-in-delay-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 flex-shrink-0 text-teal-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          Search venues, deals, happy hours...
        </button>
      </header>

      <main className="px-4 pt-5 pb-8 max-w-lg mx-auto">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-teal-500" />
          </div>
        ) : (
          <div className="space-y-5">
            {visibleGroups.map((group, gi) => (
              <section key={group.label} className="animate-fade-in-up" style={{ animationDelay: `${gi * 80}ms` }}>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-400 px-0.5">
                  {group.label}
                </p>
                <div className="grid grid-cols-4 gap-2">
                  {group.activities.map((name) => {
                    const config = activityMap.get(name);
                    const emoji = config?.emoji || '⭐';
                    const count = spotCounts[name] ?? 0;
                    const active = activeCounts[name] ?? 0;
                    const pastel = PASTEL_BG[name] || 'bg-gray-50 border-gray-200';

                    return (
                      <button
                        key={name}
                        onClick={() => onSelectActivity(name as SpotType)}
                        className={`flex flex-col items-center gap-1 rounded-xl border px-1 py-3 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 active:scale-95 touch-manipulation ${pastel}`}
                      >
                        <span className="text-2xl leading-none">{emoji}</span>
                        <span className="text-[11px] font-semibold text-gray-800 text-center leading-tight">
                          {name}
                        </span>
                        <span className="text-[10px] text-gray-400 font-medium">{count}</span>
                        {active > 0 && (
                          <span className="flex items-center gap-0.5 text-[9px] font-bold text-green-600">
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
              </section>
            ))}

            <section className="animate-fade-in-up" style={{ animationDelay: `${visibleGroups.length * 80}ms` }}>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-400 px-0.5">
                Everything
              </p>
              <button
                onClick={() => onSelectActivity(ALL_VENUES as SpotType)}
                className="flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 active:scale-95 touch-manipulation"
              >
                <span className="text-xl">📍</span>
                <div className="text-left flex-1">
                  <span className="text-[11px] font-semibold text-gray-800">All Venues</span>
                  <p className="text-[10px] text-gray-400">{venueCount} places in Charleston</p>
                </div>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </section>

            <div className="text-center pt-2 animate-fade-in-up" style={{ animationDelay: `${(visibleGroups.length + 1) * 80}ms` }}>
              <button
                onClick={() => onSelectActivity('Happy Hour' as SpotType)}
                className="inline-flex items-center gap-2 rounded-full bg-teal-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:bg-teal-700 hover:shadow-lg active:scale-95 touch-manipulation"
              >
                Browse Deals Now
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
