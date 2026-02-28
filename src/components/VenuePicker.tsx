'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface VenueSearchResult {
  id: string;
  name: string;
  lat: number;
  lng: number;
  area: string | null;
  address: string | null;
  distance: number | null;
  hasActivity: boolean;
}

interface VenuePickerProps {
  activityType: string;
  userLocation: { lat: number; lng: number } | null;
  onSelect: (venue: VenueSearchResult) => void;
  onCannotFind: () => void;
}

export default function VenuePicker({
  activityType,
  userLocation,
  onSelect,
  onCannotFind,
}: VenuePickerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<VenueSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  const fetchVenues = useCallback(async (searchQuery: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ activity: activityType });
      if (searchQuery.length >= 2) params.set('q', searchQuery);
      if (userLocation) {
        params.set('lat', String(userLocation.lat));
        params.set('lng', String(userLocation.lng));
      }
      const res = await fetch(`/api/venues/search?${params}`);
      if (!res.ok) return;
      const data: VenueSearchResult[] = await res.json();
      setResults(data);
    } catch {
      console.error('[VenuePicker] Search failed');
    } finally {
      setLoading(false);
    }
  }, [activityType, userLocation]);

  useEffect(() => {
    fetchVenues('');
    if (inputRef.current) inputRef.current.focus();
  }, [fetchVenues]);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchVenues(value), 250);
  };

  function formatDistance(meters: number | null): string {
    if (meters == null) return '';
    if (meters < 1000) return `${meters}m`;
    return `${(meters / 1000).toFixed(1)}km`;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 px-1 pb-3">
        <div className="relative">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Search venues by name..."
            className="w-full rounded-xl border-2 border-gray-200 bg-white pl-10 pr-4 py-3 text-sm text-gray-800 placeholder-gray-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto -mx-1 px-1 min-h-0">
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-3 border-gray-200 border-t-teal-500" />
          </div>
        ) : results.length === 0 ? (
          <div className="text-center py-8 text-sm text-gray-400">
            No venues found{query ? ` for "${query}"` : ''}
          </div>
        ) : (
          <div className="space-y-1.5">
            {results.map((venue) => (
              <button
                key={venue.id}
                onClick={() => !venue.hasActivity && onSelect(venue)}
                disabled={venue.hasActivity}
                className={`w-full text-left rounded-xl border px-3 py-2.5 transition-all ${
                  venue.hasActivity
                    ? 'border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed'
                    : 'border-gray-200 bg-white hover:border-teal-300 hover:shadow-sm active:scale-[0.99]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-gray-800 truncate">
                      {venue.name}
                    </div>
                    <div className="text-xs text-gray-400 truncate mt-0.5">
                      {venue.area || venue.address || 'Charleston, SC'}
                    </div>
                  </div>
                  <div className="flex flex-col items-end flex-shrink-0 gap-0.5">
                    {venue.distance != null && (
                      <span className="text-[10px] text-gray-400 font-medium">
                        {formatDistance(venue.distance)}
                      </span>
                    )}
                    {venue.hasActivity && (
                      <span className="text-[9px] text-amber-600 font-semibold bg-amber-50 rounded-full px-1.5 py-0.5">
                        Already listed
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-shrink-0 pt-3 border-t border-gray-100 mt-2">
        <button
          onClick={onCannotFind}
          className="w-full text-center text-xs text-teal-600 font-medium hover:text-teal-800 transition-colors py-2"
        >
          Can&apos;t find your venue? Add a new place →
        </button>
      </div>
    </div>
  );
}
