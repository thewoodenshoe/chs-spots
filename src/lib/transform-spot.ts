/**
 * Unified spot transformation — single source of truth for converting
 * DB rows (SpotRow + VenueRow) into API/SSR response objects.
 *
 * Used by: GET /api/spots, explore/[slug], spots/[id], homepage.
 * Replaces 4 duplicate transformSpot implementations.
 */

import type { SpotRow, VenueRow } from './db';

export interface TransformedSpot {
  id: number;
  lat: number;
  lng: number;
  title: string;
  description: string;
  type: string;
  photoUrl?: string;
  source: string;
  status: string;
  promotionTime?: string;
  promotionList?: unknown;
  timeStart?: string;
  timeEnd?: string;
  days?: number[];
  specificDate?: string;
  sourceUrl?: string;
  lastUpdateDate?: string;
  lastVerifiedDate?: string;
  venueId?: string;
  area?: string;
  submitterName?: string;
  venuePhone?: string;
  venueAddress?: string;
  venueWebsite?: string;
  operatingHours?: unknown;
  venueStatus?: string;
  venueAddedAt?: string;
  expectedOpenDate?: string;
}

export function safeJsonParse(value: string | null | undefined): unknown {
  if (!value) return undefined;
  try { return JSON.parse(value); }
  catch { return undefined; }
}

export function transformSpot(
  spot: SpotRow,
  venueMap: Map<string, VenueRow>,
): TransformedSpot {
  const venue = spot.venue_id ? venueMap.get(spot.venue_id) : undefined;
  return {
    id: spot.id,
    lat: venue?.lat ?? 0,
    lng: venue?.lng ?? 0,
    title: spot.title,
    description: spot.description || '',
    type: spot.type || 'Happy Hour',
    photoUrl: spot.photo_url || venue?.photo_url || undefined,
    source: spot.source || 'automated',
    status: spot.status || 'approved',
    promotionTime: spot.promotion_time || undefined,
    promotionList: spot.promotion_list ? safeJsonParse(spot.promotion_list) : undefined,
    timeStart: spot.time_start || undefined,
    timeEnd: spot.time_end || undefined,
    days: spot.days ? spot.days.split(',').map(Number) : undefined,
    specificDate: spot.specific_date || undefined,
    sourceUrl: spot.source_url || undefined,
    lastUpdateDate: spot.last_update_date || undefined,
    lastVerifiedDate: spot.updated_at || spot.last_update_date || undefined,
    venueId: spot.venue_id || undefined,
    area: venue?.area || undefined,
    submitterName: spot.submitter_name || undefined,
    venuePhone: venue?.phone || undefined,
    venueAddress: venue?.address || undefined,
    venueWebsite: venue?.website || undefined,
    operatingHours: venue?.operating_hours ? safeJsonParse(venue.operating_hours) : undefined,
    venueStatus: venue?.venue_status || undefined,
    venueAddedAt: venue?.venue_added_at || undefined,
    expectedOpenDate: venue?.expected_open_date || undefined,
  };
}

const STATUS_DISPLAY: Record<string, string> = {
  coming_soon: 'Coming Soon',
  recently_opened: 'Recently Opened',
};

function hashVenueId(venueId: string): number {
  let hash = 5381;
  for (let i = 0; i < venueId.length; i++) {
    hash = ((hash << 5) + hash + venueId.charCodeAt(i)) | 0;
  }
  return -(Math.abs(hash) || 1);
}

export function venueToSpot(venue: VenueRow): TransformedSpot {
  return {
    id: hashVenueId(venue.id),
    lat: venue.lat,
    lng: venue.lng,
    title: venue.name,
    description: venue.description || '',
    type: STATUS_DISPLAY[venue.venue_status] || 'Coming Soon',
    photoUrl: venue.photo_url || undefined,
    source: 'automated',
    status: 'approved',
    venueId: venue.id,
    area: venue.area || undefined,
    venuePhone: venue.phone || undefined,
    venueAddress: venue.address || undefined,
    venueWebsite: venue.website || undefined,
    operatingHours: venue.operating_hours ? safeJsonParse(venue.operating_hours) : undefined,
    venueStatus: venue.venue_status,
    venueAddedAt: venue.venue_added_at || undefined,
    expectedOpenDate: venue.expected_open_date || undefined,
  };
}

export function buildVenueMap(allVenues: VenueRow[]): Map<string, VenueRow> {
  const map = new Map<string, VenueRow>();
  for (const v of allVenues) map.set(v.id, v);
  return map;
}
