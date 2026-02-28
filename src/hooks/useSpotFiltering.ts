import { useMemo } from 'react';
import { Spot } from '@/contexts/SpotsContext';
import { Venue } from '@/contexts/VenuesContext';
import { NEAR_ME } from '@/components/AreaSelector';
import { getAreaFromCoordinates } from '@/utils/area';
import { calculateDistanceMiles } from '@/utils/distance';

export const ALL_VENUES = 'All Venues';

const AREA_BYPASS_ACTIVITIES = ['Recently Opened', 'Coming Soon', ALL_VENUES];

interface FilterParams {
  spots: Spot[];
  selectedArea: string;
  selectedActivity: string;
  searchQuery: string;
  userLocation: { lat: number; lng: number } | null;
  venueAreaById: Map<string, string>;
}

export function useFilteredSpots({
  spots, selectedArea, selectedActivity, searchQuery, userLocation, venueAreaById,
}: FilterParams): Spot[] {
  const isNearMe = selectedArea === NEAR_ME;
  const isAllVenues = selectedActivity === ALL_VENUES;
  const isAreaBypass = AREA_BYPASS_ACTIVITIES.includes(selectedActivity);

  return useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    let results = spots.filter((spot) => {
      if (spot.lat === 0 && spot.lng === 0) return false;
      const activityMatch = isAllVenues || spot.type === selectedActivity;
      if (query) {
        const searchMatch = spot.title.toLowerCase().includes(query)
          || (spot.description || '').toLowerCase().includes(query);
        return activityMatch && searchMatch;
      }
      if (isNearMe || isAreaBypass) return activityMatch;
      const spotArea = spot.area
        || (spot.venueId ? venueAreaById.get(spot.venueId) : undefined)
        || getAreaFromCoordinates(spot.lat, spot.lng);
      return spotArea === selectedArea && activityMatch;
    });

    if (isNearMe && userLocation && !query) {
      results.sort((a, b) => {
        const da = (a.lat - userLocation.lat) ** 2 + (a.lng - userLocation.lng) ** 2;
        const db = (b.lat - userLocation.lat) ** 2 + (b.lng - userLocation.lng) ** 2;
        return da - db;
      });
      results = results.slice(0, 50);
    }

    return results;
  }, [spots, selectedArea, selectedActivity, venueAreaById, searchQuery, isNearMe, isAllVenues, isAreaBypass, userLocation]);
}

export interface VenueSearchResult {
  venue: Venue;
  distance: number | null;
  activityTypes: string[];
}

export function useVenueSearchResults(
  venues: Venue[],
  searchQuery: string,
  spots: Spot[],
  userLocation: { lat: number; lng: number } | null,
  selectedActivity: string,
): VenueSearchResult[] {
  return useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    const isAllVenuesBrowse = selectedActivity === ALL_VENUES;
    if (query.length < 2 && !isAllVenuesBrowse) return [];

    const spotVenueIds = new Set(spots.map(s => s.venueId).filter(Boolean));
    const venueActivityMap = new Map<string, Set<string>>();
    for (const s of spots) {
      if (!s.venueId) continue;
      const set = venueActivityMap.get(s.venueId) || new Set();
      set.add(s.type);
      venueActivityMap.set(s.venueId, set);
    }

    const matched = venues.filter(v => {
      if (v.lat === 0 && v.lng === 0) return false;
      if (spotVenueIds.has(v.id)) return false;
      if (query) return v.name.toLowerCase().includes(query);
      return true;
    });

    const results: VenueSearchResult[] = matched.map(v => ({
      venue: v,
      distance: userLocation
        ? calculateDistanceMiles(userLocation.lat, userLocation.lng, v.lat, v.lng)
        : null,
      activityTypes: Array.from(venueActivityMap.get(v.id) || []),
    }));

    results.sort((a, b) => {
      if (a.distance !== null && b.distance !== null) return a.distance - b.distance;
      if (a.distance !== null) return -1;
      if (b.distance !== null) return 1;
      return a.venue.name.localeCompare(b.venue.name);
    });

    return results.slice(0, 50);
  }, [venues, searchQuery, spots, userLocation, selectedActivity]);
}

/**
 * Builds a map of venue ID -> area for fast lookups.
 */
export function useVenueAreaMap(venues: { id: string; area: string | null }[]): Map<string, string> {
  return useMemo(() => {
    const m = new Map<string, string>();
    for (const v of venues) {
      if (v.id && v.area) m.set(v.id, v.area);
    }
    return m;
  }, [venues]);
}

/**
 * Computes spot counts per activity type for the filter badge.
 */
export function useSpotCounts(spots: Spot[]): Record<string, number> {
  return useMemo(() => {
    const counts: Record<string, number> = {};
    for (const spot of spots) {
      if (spot.lat === 0 && spot.lng === 0) continue;
      counts[spot.type] = (counts[spot.type] || 0) + 1;
    }
    return counts;
  }, [spots]);
}
