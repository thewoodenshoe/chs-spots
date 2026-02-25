'use client';

import { useState, useMemo } from 'react';
import Image from 'next/image';
import { Spot } from '@/contexts/SpotsContext';
import { Activity } from '@/utils/activities';
import { calculateDistanceMiles } from '@/utils/distance';

export type SortMode = 'alpha' | 'recent' | 'nearest';

interface SpotListViewProps {
  spots: Spot[];
  activities: Activity[];
  userLocation: { lat: number; lng: number } | null;
  selectedArea: string;
  selectedActivity: string;
  sortMode: SortMode;
  onSortChange: (mode: SortMode) => void;
  onSpotSelect: (spot: Spot) => void;
  onEditSpot?: (spot: Spot) => void;
  onAddSpot?: () => void;
}

export default function SpotListView({
  spots,
  activities,
  userLocation,
  selectedArea,
  selectedActivity,
  sortMode,
  onSortChange,
  onSpotSelect,
  onEditSpot,
  onAddSpot,
}: SpotListViewProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const sortedSpots = useMemo(() => {
    const withDistance = spots.map((spot) => ({
      spot,
      distance: userLocation
        ? calculateDistanceMiles(userLocation.lat, userLocation.lng, spot.lat, spot.lng)
        : null,
    }));

    switch (sortMode) {
      case 'nearest':
        return withDistance.sort((a, b) => {
          if (a.distance === null || b.distance === null) return 0;
          return a.distance - b.distance;
        });
      case 'recent':
        return withDistance.sort((a, b) => {
          const da = a.spot.lastUpdateDate ? new Date(a.spot.lastUpdateDate).getTime() : 0;
          const db = b.spot.lastUpdateDate ? new Date(b.spot.lastUpdateDate).getTime() : 0;
          return db - da;
        });
      case 'alpha':
      default:
        return withDistance.sort((a, b) => a.spot.title.localeCompare(b.spot.title));
    }
  }, [spots, sortMode, userLocation]);

  const getActivityConfig = (type: string) =>
    activities.find((a) => a.name === type);

  if (spots.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="text-center max-w-xs">
          <div className="text-4xl mb-3">🔍</div>
          <p className="text-base font-semibold text-gray-800">
            No {selectedActivity} spots yet
          </p>
          <p className="mt-1 text-sm text-gray-500">
            {selectedArea} is waiting for its first {selectedActivity.toLowerCase()} spot.
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
        <span className="text-xs font-medium text-gray-500">
          {spots.length} spot{spots.length !== 1 ? 's' : ''}
        </span>
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
            <option value="recent">Recently Updated</option>
            {userLocation && <option value="nearest">Nearest</option>}
          </select>
        </div>
      </div>

      {/* Scrollable card list */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {sortedSpots.map(({ spot, distance }) => {
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
                    {spot.status === 'pending' && (
                      <span className="flex-shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                        Pending
                      </span>
                    )}
                  </div>

                  {promoTime && (
                    <p className="mt-0.5 text-xs text-gray-500 truncate">{promoTime}</p>
                  )}

                  {!isExpanded && promoList.length > 0 && (
                    <p className="mt-0.5 text-xs text-gray-400 truncate">
                      {promoList.slice(0, 2).map((item) => {
                        const m = item.match(/^\[([^\]]+)\]\s*(.*)/);
                        return m ? m[2] : item;
                      }).join(' · ')}
                    </p>
                  )}
                </div>

                {/* Right side: distance + chevron */}
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  {distance !== null && (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                      {distance < 0.1
                        ? '<0.1 mi'
                        : distance < 10
                          ? `${distance.toFixed(1)} mi`
                          : `${Math.round(distance)} mi`}
                    </span>
                  )}
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
              </button>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="border-t border-gray-100 px-4 pb-3 pt-2 space-y-2">
                  {/* Schedule */}
                  {promoTime && (
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-0.5">
                        Schedule
                      </div>
                      <div className="space-y-0.5">
                        {promoTime.split(/\s*[•]\s*/).filter(Boolean).map((part, i) => (
                          <div key={i} className="text-xs text-gray-700 leading-snug">{part}</div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Specials */}
                  {promoList.length > 0 && (
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-0.5">
                        {spot.type === 'Brunch' ? 'Brunch Specials' : 'Specials'}
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
                      Show on Map
                    </button>

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
                      onClick={(e) => {
                        e.stopPropagation();
                        const url = `${window.location.origin}?spot=${spot.id}`;
                        if (navigator.share) {
                          navigator.share({ title: spot.title, text: `Check out ${spot.title} on Charleston Finds`, url });
                        } else {
                          navigator.clipboard.writeText(url);
                        }
                      }}
                      className="flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-200 transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                      </svg>
                      Share
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
