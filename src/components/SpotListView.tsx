'use client';

import { useState, useMemo, useCallback, SyntheticEvent } from 'react';
import Image from 'next/image';
import { Spot } from '@/contexts/SpotsContext';
import { NEAR_ME } from '@/components/AreaSelector';
import { Activity } from '@/utils/activities';
import { calculateDistanceMiles } from '@/utils/distance';
import { isSpotActiveNow } from '@/utils/time-utils';
import { toggleFavorite } from '@/utils/favorites';
import { shareSpot } from '@/utils/share';
import { useVenues, OperatingHours } from '@/contexts/VenuesContext';
import { getOpenStatus } from '@/utils/active-status';
import WhatsNewStrip from '@/components/WhatsNewStrip';

export type SortMode = 'alpha' | 'activityActive' | 'venueOpen' | 'nearest';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const DAY_LABELS: Record<string, string> = {
  sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat',
};

function formatTime12(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m ? `${h12}:${String(m).padStart(2, '0')}${ampm}` : `${h12}${ampm}`;
}

function formatTodayHours(hours: OperatingHours | null): string | null {
  if (!hours) return null;
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = DAY_KEYS[now.getDay()];
  const entry = hours[day];
  if (!entry || entry === 'closed') return 'Closed today';
  return `${formatTime12(entry.open)} - ${formatTime12(entry.close)}`;
}

function formatFullWeekHours(hours: OperatingHours | null): { day: string; hours: string; isToday: boolean }[] {
  if (!hours) return [];
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const todayIdx = now.getDay();
  return DAY_KEYS.map((key, idx) => {
    const entry = hours[key];
    const h = !entry || entry === 'closed' ? 'Closed' : `${formatTime12(entry.open)} - ${formatTime12(entry.close)}`;
    return { day: DAY_LABELS[key], hours: h, isToday: idx === todayIdx };
  });
}

const SUB_TAG_RULES: [RegExp, string][] = [
  [/\bDog Park\b/i, 'Dog Park'],
  [/\bBeach\b/i, 'Beach'],
  [/\bBrewing|Brewery\b/i, 'Brewery'],
  [/\bBiergarten|Taproom|Ice House\b/i, 'Bar'],
  [/\bPub\b/i, 'Pub'],
  [/\bTavern\b/i, 'Tavern'],
  [/\bCaf[eé]|Coffee\b/i, 'Cafe'],
  [/\bDeli\b/i, 'Deli'],
  [/\bBBQ\b/i, 'BBQ'],
  [/\bHistoric Site\b/i, 'Historic'],
  [/\bCounty Park\b/i, 'Park'],
  [/\bPark\b/i, 'Park'],
  [/\bRestaurant\b/i, 'Restaurant'],
  [/\bBar\b/i, 'Bar'],
];

function getSubTag(title: string): string | null {
  for (const [re, tag] of SUB_TAG_RULES) {
    if (re.test(title)) return tag;
  }
  return null;
}

const MIXED_ACTIVITIES = new Set(['Dog-Friendly', 'Must-See Spots']);

interface SpotListViewProps {
  spots: Spot[];
  allSpots?: Spot[];
  activities: Activity[];
  userLocation: { lat: number; lng: number } | null;
  selectedArea: string;
  selectedActivity: string;
  sortMode: SortMode;
  onSortChange: (mode: SortMode) => void;
  onSpotSelect: (spot: Spot) => void;
  onEditSpot?: (spot: Spot) => void;
  onAddSpot?: () => void;
  isSearching?: boolean;
  showFavoritesOnly?: boolean;
  onFavoritesChange?: (count: number) => void;
  onWhatsNewSelect?: (spot: Spot) => void;
}

export default function SpotListView({
  spots,
  allSpots,
  activities,
  userLocation,
  selectedArea,
  selectedActivity,
  sortMode,
  onSortChange,
  onSpotSelect,
  onEditSpot,
  onAddSpot,
  isSearching = false,
  showFavoritesOnly = false,
  onFavoritesChange,
  onWhatsNewSelect,
}: SpotListViewProps) {
  const { venues } = useVenues();
  const venueMap = useMemo(() => new Map(venues.map(v => [v.id, v])), [venues]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [favIds, setFavIds] = useState<Set<number>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const raw = localStorage.getItem('chs-finds-favorites');
      return raw ? new Set(JSON.parse(raw) as number[]) : new Set();
    } catch { return new Set(); }
  });
  const [shareToastId, setShareToastId] = useState<number | null>(null);

  const setShareToast = useCallback((id: number) => {
    setShareToastId(id);
    setTimeout(() => setShareToastId(null), 2000);
  }, []);

  const handleToggleFavorite = useCallback((spotId: number) => {
    const nowFav = toggleFavorite(spotId);
    setFavIds((prev) => {
      const next = new Set(prev);
      if (nowFav) next.add(spotId);
      else next.delete(spotId);
      onFavoritesChange?.(next.size);
      return next;
    });
  }, [onFavoritesChange]);

  const sortedSpots = useMemo(() => {
    let filtered = spots;
    if (showFavoritesOnly) {
      filtered = filtered.filter((s) => favIds.has(s.id));
    }

    const withMeta = filtered.map((spot) => {
      const venue = spot.venueId ? venueMap.get(spot.venueId) : undefined;
      return {
        spot,
        distance: userLocation
          ? calculateDistanceMiles(userLocation.lat, userLocation.lng, spot.lat, spot.lng)
          : null,
        activeNow: isSpotActiveNow(spot),
        openStatus: venue ? getOpenStatus(venue.operatingHours) : null,
        venueHours: venue?.operatingHours ?? null,
        fav: favIds.has(spot.id),
      };
    });

    switch (sortMode) {
      case 'nearest':
        return withMeta.sort((a, b) => {
          if (a.distance === null && b.distance === null) return a.spot.title.localeCompare(b.spot.title);
          if (a.distance === null) return 1;
          if (b.distance === null) return -1;
          return a.distance - b.distance;
        });
      case 'activityActive':
        return withMeta.sort((a, b) => {
          if (a.activeNow === b.activeNow) return a.spot.title.localeCompare(b.spot.title);
          return a.activeNow ? -1 : 1;
        });
      case 'venueOpen':
        return withMeta.sort((a, b) => {
          const aOpen = a.openStatus?.isOpen ? 1 : 0;
          const bOpen = b.openStatus?.isOpen ? 1 : 0;
          if (aOpen !== bOpen) return bOpen - aOpen;
          const aClosing = a.openStatus?.label === 'Closing soon' ? 1 : 0;
          const bClosing = b.openStatus?.label === 'Closing soon' ? 1 : 0;
          if (aClosing !== bClosing) return bClosing - aClosing;
          return a.spot.title.localeCompare(b.spot.title);
        });
      case 'alpha':
      default:
        return withMeta.sort((a, b) => a.spot.title.localeCompare(b.spot.title));
    }
  }, [spots, sortMode, userLocation, showFavoritesOnly, favIds, venueMap]);

  const getActivityConfig = (type: string) =>
    activities.find((a) => a.name === type);

  if (spots.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="text-center max-w-xs">
          <div className="text-4xl mb-3">🔍</div>
          <p className="text-base font-semibold text-gray-800">
            No {selectedActivity} {selectedArea === NEAR_ME ? 'nearby' : `in ${selectedArea}`} yet
          </p>
          <p className="mt-1 text-sm text-gray-500">
            {selectedActivity === 'Recently Opened' || selectedActivity === 'Coming Soon'
              ? 'Know a new opening? Tip us and we\u2019ll add it!'
              : 'Know a spot? Add it and help fellow explorers!'}
          </p>
          {onAddSpot && (
            <button
              onClick={onAddSpot}
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-teal-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-teal-600 transition-colors active:scale-95"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Be the first to add one
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-gray-50">
      {/* Sort bar */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-500">
            {sortedSpots.length} spot{sortedSpots.length !== 1 ? 's' : ''}
          </span>
          {showFavoritesOnly && (
            <span className="flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-600">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
              Saved Only
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <label htmlFor="sort-select" className="text-xs text-gray-500">
            Sort:
          </label>
          <select
            id="sort-select"
            value={sortMode}
            onChange={(e) => onSortChange(e.target.value as SortMode)}
            className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-medium text-gray-700 focus:border-teal-400 focus:outline-none"
          >
            <option value="alpha">A &ndash; Z</option>
            {['Happy Hour', 'Brunch', 'Live Music'].includes(selectedActivity) && (
              <option value="activityActive">Activity Active</option>
            )}
            <option value="venueOpen">Open Now</option>
            {userLocation && <option value="nearest">Nearest</option>}
          </select>
        </div>
      </div>

      {/* Active Now banner */}
      {(() => {
        const TIME_ACTIVITIES = new Set(['Happy Hour', 'Brunch', 'Live Music']);
        if (!TIME_ACTIVITIES.has(selectedActivity)) return null;
        const activeCount = spots.filter(s => isSpotActiveNow(s)).length;
        if (activeCount === 0) return null;
        return (
          <button
            onClick={() => onSortChange('activityActive')}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-medium transition-colors ${
              sortMode === 'activityActive'
                ? 'bg-green-50 text-green-700'
                : 'bg-green-50/50 text-green-600 hover:bg-green-50'
            }`}
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
            </span>
            {activeCount} active right now
            {sortMode !== 'activityActive' && (
              <span className="ml-auto text-[10px] text-green-500">Tap to sort</span>
            )}
          </button>
        );
      })()}

      {/* What's New strip */}
      {allSpots && onWhatsNewSelect
        && selectedActivity !== 'Recently Opened'
        && selectedActivity !== 'Coming Soon'
        && (() => {
          const newSpots = allSpots
            .filter(s => (s.type === 'Recently Opened' || s.type === 'Coming Soon') && s.lat !== 0 && s.lng !== 0)
            .sort((a, b) => {
              const da = a.lastUpdateDate ? new Date(a.lastUpdateDate).getTime() : 0;
              const db = b.lastUpdateDate ? new Date(b.lastUpdateDate).getTime() : 0;
              return db - da;
            })
            .slice(0, 8);
          if (newSpots.length === 0) return null;
          return <WhatsNewStrip spots={newSpots} activities={activities} onSelect={onWhatsNewSelect} />;
        })()
      }

      {/* Scrollable card list */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {sortedSpots.map(({ spot, distance, activeNow, openStatus, venueHours, fav }) => {
          const cfg = getActivityConfig(spot.type);
          const emoji = cfg?.emoji || '📍';
          const color = cfg?.color || '#0d9488';
          const promoTime = spot.promotionTime || spot.happyHourTime;
          const promoList = spot.promotionList ?? spot.happyHourList ?? [];
          const isExpanded = expandedId === spot.id;

          return (
            <div
              key={spot.id}
              className="rounded-xl bg-white shadow-sm border border-gray-100 active:scale-[0.99] transition-transform touch-manipulation"
            >
              {/* Main card row — always visible */}
              <button
                onClick={() => setExpandedId(isExpanded ? null : spot.id)}
                className="flex w-full items-start gap-3 p-3 text-left"
              >
                {/* Emoji circle */}
                <span
                  className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-lg"
                  style={{ backgroundColor: color + '20' }}
                >
                  {emoji}
                </span>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900 text-sm truncate">
                      {spot.title}
                    </span>
                    {(isSearching || selectedArea === NEAR_ME) && spot.area && (
                      <span className="flex-shrink-0 rounded-full bg-teal-50 px-1.5 py-0.5 text-[10px] font-medium text-teal-600">
                        {spot.area}
                      </span>
                    )}
                    {MIXED_ACTIVITIES.has(spot.type) && (() => {
                      const tag = getSubTag(spot.title);
                      return tag ? (
                        <span className="flex-shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                          {tag}
                        </span>
                      ) : null;
                    })()}
                    {spot.status === 'pending' && (
                      <span className="flex-shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                        Pending
                      </span>
                    )}
                  </div>

                  {promoTime && (
                    <p className="mt-0.5 text-xs text-gray-500 truncate">
                      <span className="font-semibold text-gray-600">
                        {spot.type === 'Happy Hour' ? 'Happy Hour' : spot.type === 'Brunch' ? 'Brunch' : spot.type}:{' '}
                      </span>
                      {promoTime}
                    </p>
                  )}

                  {venueHours && (
                    <p className="mt-0.5 text-xs text-gray-400 truncate">
                      <span className="font-medium text-gray-500">Opening Hours: </span>
                      {formatTodayHours(venueHours)}
                    </p>
                  )}

                  {!isExpanded && promoList.length > 0 && (
                    <p className="mt-0.5 text-xs text-gray-400 truncate">
                      {promoList.slice(0, 2).map((item) => {
                        const m = item.match(/^\[([^\]]+)\]\s*(.*)/);
                        return m ? m[2] : item;
                      }).join(' · ')}
                    </p>
                  )}

                  {!promoTime && !venueHours && promoList.length === 0 && spot.description && (
                    <p className="mt-0.5 text-xs text-gray-400 truncate">
                      {spot.description}
                    </p>
                  )}
                </div>

                {/* Right side: active, time, distance, fav */}
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  {activeNow && (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700 whitespace-nowrap animate-pulse">
                      Active Now
                    </span>
                  )}
                  {!activeNow && openStatus && openStatus.label && (
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${
                      openStatus.isOpen
                        ? 'bg-emerald-50 text-emerald-600'
                        : 'bg-gray-100 text-gray-500'
                    }`}>
                      {openStatus.label === 'Closing soon'
                        ? `Closes ${openStatus.closesAt}`
                        : openStatus.isOpen
                          ? `Open til ${openStatus.closesAt}`
                          : 'Closed'}
                    </span>
                  )}
                  {distance !== null && (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600 whitespace-nowrap">
                      {distance < 0.1
                        ? '<0.1 mi'
                        : distance < 10
                          ? `${distance.toFixed(1)} mi`
                          : `${Math.round(distance)} mi`}
                    </span>
                  )}
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleFavorite(spot.id);
                      }}
                      className="p-0.5 transition-colors"
                      aria-label={fav ? 'Remove from saved' : 'Save spot'}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ${fav ? 'text-red-500' : 'text-gray-300'}`} viewBox="0 0 24 24" fill={fav ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                      </svg>
                    </button>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className={`h-4 w-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
              </button>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="border-t border-gray-100 px-4 pb-3 pt-2 space-y-2">
                  {/* Activity-specific times (Happy Hour / Brunch / etc.) */}
                  {promoTime && (
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-0.5">
                        {spot.type === 'Happy Hour' ? 'Happy Hour' : spot.type === 'Brunch' ? 'Brunch Hours' : spot.type}
                      </div>
                      <div className="space-y-0.5">
                        {promoTime.split(/\s*[•]\s*/).filter(Boolean).map((part, i) => (
                          <div key={i} className="text-xs text-gray-700 leading-snug">{part}</div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Opening Hours */}
                  {venueHours && (
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-0.5">
                        Opening Hours
                      </div>
                      <div className="space-y-0.5">
                        {formatFullWeekHours(venueHours).map(({ day, hours: h, isToday }) => (
                          <div key={day} className={`text-xs leading-snug flex gap-2 ${isToday ? 'text-gray-900 font-semibold' : 'text-gray-500'}`}>
                            <span className="w-8">{day}</span>
                            <span>{h}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Specials */}
                  {promoList.length > 0 && (
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-0.5">
                        Specials
                      </div>
                      <div className="space-y-0.5">
                        {promoList.map((item, i) => {
                          const m = item.match(/^\[([^\]]+)\]\s*(.*)/);
                          const label = m ? m[1] : null;
                          const text = m ? m[2] : item;
                          if (!text.trim()) return null;
                          return (
                            <div key={i} className="text-xs text-gray-600">
                              {label && <span className="font-semibold text-gray-700">{label}: </span>}
                              {text}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Fallback description */}
                  {!promoTime && promoList.length === 0 && spot.description && (
                    <p className="text-xs text-gray-600">{spot.description}</p>
                  )}

                  {/* Photo */}
                  {spot.photoUrl && (
                    <div className="relative h-28 w-full overflow-hidden rounded-lg">
                      <Image
                        src={spot.photoUrl}
                        alt={spot.title}
                        fill
                        className="object-cover"
                        unoptimized
                        onError={(e: SyntheticEvent<HTMLImageElement>) => {
                          e.currentTarget.parentElement!.style.display = 'none';
                        }}
                      />
                    </div>
                  )}

                  {/* Action row */}
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSpotSelect(spot);
                      }}
                      className="flex items-center gap-1 rounded-full bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-700 hover:bg-teal-100 transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                      </svg>
                      Map
                    </button>

                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${spot.lat},${spot.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1 rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      Directions
                    </a>

                    {spot.sourceUrl && (
                      <a
                        href={spot.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition-colors"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                        Website
                      </a>
                    )}

                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        const result = await shareSpot(spot.title, spot.id, spot.type, spot.area);
                        if (result === 'copied' || result === 'shared') setShareToast(spot.id);
                      }}
                      className="flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-200 transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                      </svg>
                      {shareToastId === spot.id ? 'Copied!' : 'Share'}
                    </button>

                    {onEditSpot && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditSpot(spot);
                        }}
                        className="ml-auto flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-200 transition-colors"
                      >
                        Edit
                      </button>
                    )}
                  </div>

                  {/* Last updated */}
                  {spot.lastUpdateDate && (
                    <p className="text-[10px] text-gray-400">
                      Updated{' '}
                      {new Date(spot.lastUpdateDate).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
