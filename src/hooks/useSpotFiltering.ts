import { useMemo } from 'react';
import { Spot } from '@/contexts/SpotsContext';
import { NEAR_ME } from '@/components/AreaSelector';
import { getAreaFromCoordinates } from '@/utils/area';

const AREA_BYPASS_ACTIVITIES = ['Recently Opened', 'Coming Soon'];

interface FilterParams {
  spots: Spot[];
  selectedArea: string;
  selectedActivity: string;
  searchQuery: string;
  userLocation: { lat: number; lng: number } | null;
  venueAreaById: Map<string, string>;
}

/**
 * Filters spots by area, activity, and search query.
 * Near Me mode sorts by distance and caps at 30 results.
 */
export function useFilteredSpots({
  spots, selectedArea, selectedActivity, searchQuery, userLocation, venueAreaById,
}: FilterParams): Spot[] {
  const isNearMe = selectedArea === NEAR_ME;
  const isAreaBypass = AREA_BYPASS_ACTIVITIES.includes(selectedActivity);

  return useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    let results = spots.filter((spot) => {
      if (spot.lat === 0 && spot.lng === 0) return false;
      const activityMatch = spot.type === selectedActivity;
      if (query) {
        const searchMatch = spot.title.toLowerCase().includes(query) || (spot.description || '').toLowerCase().includes(query);
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
      results = results.slice(0, 30);
    }

    return results;
  }, [spots, selectedArea, selectedActivity, venueAreaById, searchQuery, isNearMe, isAreaBypass, userLocation]);
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
