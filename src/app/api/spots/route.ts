/* eslint-disable @typescript-eslint/no-explicit-any -- SpotRow transformation maps DB columns to camelCase */
import { NextResponse } from 'next/server';
import { sendApprovalRequest } from '@/lib/telegram';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { isAdminRequest } from '@/lib/auth';
import { createSpotSchema, parseOrError } from '@/lib/validations';
import { spots, venues, type SpotRow, type VenueRow } from '@/lib/db';
import { findMatchingVenue } from '@/lib/venue-match';
import { getCache, setCache, invalidate, safeJsonParse } from '@/lib/cache';

const SPOTS_CACHE_KEY = 'api:spots';
const SPOTS_TTL = 30_000;

function transformSpot(spot: SpotRow, venueMap: Map<string, VenueRow>) {
  const venue = spot.venue_id ? venueMap.get(spot.venue_id) : undefined;
  const transformed: any = {
    id: spot.id,
    lat: venue?.lat ?? spot.lat ?? 0,
    lng: venue?.lng ?? spot.lng ?? 0,
    title: spot.title,
    description: spot.description || '',
    type: spot.type || 'Happy Hour',
    photoUrl: spot.photo_url || venue?.photo_url || undefined,
    source: spot.source || 'automated',
    status: spot.status || 'approved',
    happyHourTime: spot.promotion_time || undefined,
    happyHourList: spot.promotion_list ? safeJsonParse(spot.promotion_list) : undefined,
    sourceUrl: spot.source_url || undefined,
    lastUpdateDate: spot.last_update_date || undefined,
    lastVerifiedDate: spot.updated_at || spot.last_update_date || undefined,
    venueId: spot.venue_id || undefined,
    area: venue?.area || spot.area || undefined,
    submitterName: spot.submitter_name || undefined,
    venuePhone: venue?.phone || undefined,
    venueAddress: venue?.address || undefined,
    venueWebsite: venue?.website || undefined,
    operatingHours: venue?.operating_hours ? safeJsonParse(venue.operating_hours) : undefined,
  };
  return transformed;
}

export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!checkRateLimit(`spots-get:${ip}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const isAdmin = isAdminRequest(request);

  try {
    if (!isAdmin) {
      const cached = getCache<any[]>(SPOTS_CACHE_KEY);
      if (cached) {
        return NextResponse.json(cached, {
          headers: { 'X-Cache': 'HIT' },
        });
      }
    }

    const allSpots = isAdmin
      ? spots.getAll()
      : spots.getAll({ visibleOnly: true });

    const allVenues = venues.getAll();
    const venueMap = new Map<string, VenueRow>();
    for (const v of allVenues) venueMap.set(v.id, v);

    const transformed = allSpots.map(s => transformSpot(s, venueMap));

    if (!isAdmin) {
      setCache(SPOTS_CACHE_KEY, transformed, SPOTS_TTL);
    }

    return NextResponse.json(transformed, {
      headers: { 'X-Cache': 'MISS' },
    });
  } catch (error) {
    console.error('Error reading spots from database:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const clientIp = getClientIp(request);
  if (!checkRateLimit(clientIp, 3, 60_000)) {
    return NextResponse.json(
      { error: 'Too many submissions. Please wait a moment and try again.' },
      { status: 429 },
    );
  }

  try {
    const raw = await request.json();
    const parsed = parseOrError(createSpotSchema, raw);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const spotData = parsed.data;
    const activityType = spotData.type || spotData.activity || 'Happy Hour';

    let resolvedVenueId: string | null = null;
    let resolvedArea: string | null = spotData.area || null;
    let venueName: string | null = null;

    if (spotData.venueId) {
      const venue = venues.getById(spotData.venueId);
      if (!venue) {
        return NextResponse.json({ error: 'Venue not found' }, { status: 400 });
      }
      if (spots.existsForVenue(spotData.venueId, activityType)) {
        return NextResponse.json(
          { error: `This venue already has a ${activityType} listing` },
          { status: 409 },
        );
      }
      resolvedVenueId = venue.id;
      resolvedArea = venue.area || resolvedArea;
      venueName = venue.name;
    } else if (spotData.lat != null && spotData.lng != null) {
      const venueMatch = findMatchingVenue(spotData.title, spotData.lat, spotData.lng);
      if (venueMatch) {
        resolvedVenueId = venueMatch.venueId;
        venueName = venueMatch.venueName;
        const matchedVenue = venues.getById(venueMatch.venueId);
        resolvedArea = matchedVenue?.area || resolvedArea;
      }
    }

    const newId = spots.insert({
      title: spotData.venueId ? (venueName || spotData.title) : spotData.title,
      submitterName: spotData.submitterName,
      description: spotData.description || '',
      type: activityType,
      photoUrl: spotData.photoUrl,
      source: 'manual',
      status: 'pending',
      submittedAt: new Date().toISOString(),
      lat: spotData.lat ?? null,
      lng: spotData.lng ?? null,
      area: resolvedArea,
      venueId: resolvedVenueId,
    });

    const venueLabel = resolvedVenueId
      ? `\n🔗 Venue: ${venueName} (${resolvedVenueId.slice(0, 20)}…)`
      : '';

    try {
      await sendApprovalRequest({
        id: newId,
        title: spotData.venueId ? (venueName || spotData.title) : spotData.title,
        type: activityType,
        lat: spotData.lat ?? 0,
        lng: spotData.lng ?? 0,
        description: `By: ${spotData.submitterName}\n${spotData.description || ''}${venueLabel}`,
      });
    } catch (telegramError) {
      console.warn('Telegram notification failed (spot still saved):', telegramError);
    }

    invalidate(SPOTS_CACHE_KEY);
    return NextResponse.json({
      id: newId,
      title: spotData.venueId ? (venueName || spotData.title) : spotData.title,
      type: activityType,
      venueId: resolvedVenueId,
      area: resolvedArea,
      status: 'pending',
    }, { status: 201 });
  } catch (error) {
    console.error('Error adding spot:', error);
    return NextResponse.json(
      { error: 'Failed to add spot' },
      { status: 500 }
    );
  }
}
