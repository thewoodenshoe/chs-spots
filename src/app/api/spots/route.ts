/* eslint-disable @typescript-eslint/no-explicit-any -- SpotRow transformation maps DB columns to camelCase */
import { NextResponse } from 'next/server';
import { sendApprovalRequest } from '@/lib/telegram';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { isAdminRequest } from '@/lib/auth';
import { createSpotSchema, parseOrError } from '@/lib/validations';
import { spots, venues, generateVenueId, setAuditContext, type VenueRow } from '@/lib/db';
import { findMatchingVenue } from '@/lib/venue-match';
import { getCache, setCache, invalidate } from '@/lib/cache';
import { transformSpot, venueToSpot, buildVenueMap } from '@/lib/transform-spot';

const SPOTS_CACHE_KEY = 'api:spots';
const SPOTS_TTL = 30_000;

function synthesizeStatusSpots(allVenues: VenueRow[]) {
  return allVenues
    .filter(v => v.venue_status === 'coming_soon' || v.venue_status === 'recently_opened')
    .map(v => venueToSpot(v));
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
      if (cached) return NextResponse.json(cached, { headers: { 'X-Cache': 'HIT' } });
    }

    const allSpots = isAdmin ? spots.getAll() : spots.getAll({ visibleOnly: true });
    const allVenues = venues.getAll();
    const venueMap = buildVenueMap(allVenues);

    const statusTypes = new Set(['Coming Soon', 'Recently Opened']);
    const transformed = allSpots
      .filter(s => !statusTypes.has(s.type))
      .map(s => transformSpot(s, venueMap));

    const statusSpots = synthesizeStatusSpots(allVenues);
    const result = [...transformed, ...statusSpots];

    if (!isAdmin) setCache(SPOTS_CACHE_KEY, result, SPOTS_TTL);
    return NextResponse.json(result, { headers: { 'X-Cache': 'MISS' } });
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

    setAuditContext('manual', 'api-spots-post');

    let resolvedVenueId: string | null = null;
    let resolvedArea: string | null = spotData.area || null;
    let venueName: string | null = null;
    let isNewVenue = false;

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
    } else if (spotData.newVenue) {
      const newVenueId = generateVenueId();
      venues.upsert({
        id: newVenueId,
        name: spotData.newVenue.name,
        address: spotData.newVenue.address || undefined,
        website: spotData.newVenue.website || undefined,
        lat: spotData.lat ?? 0,
        lng: spotData.lng ?? 0,
        area: resolvedArea,
        submitter_name: spotData.submitterName,
      });
      resolvedVenueId = newVenueId;
      venueName = spotData.newVenue.name;
      isNewVenue = true;
      console.log(`[POST /api/spots] Created new venue ${newVenueId} "${spotData.newVenue.name}" via user submission`);
    } else if (spotData.lat != null && spotData.lng != null) {
      const venueMatch = findMatchingVenue(spotData.title, spotData.lat, spotData.lng);
      if (venueMatch) {
        resolvedVenueId = venueMatch.venueId;
        venueName = venueMatch.venueName;
        resolvedArea = venues.getById(venueMatch.venueId)?.area || resolvedArea;
      } else {
        const pinVenueId = generateVenueId();
        venues.upsert({
          id: pinVenueId,
          name: spotData.title,
          lat: spotData.lat,
          lng: spotData.lng,
          area: resolvedArea,
        });
        resolvedVenueId = pinVenueId;
        venueName = spotData.title;
      }
    }

    const spotTitle = resolvedVenueId ? (venueName || spotData.title) : spotData.title;

    const newId = spots.insert({
      title: spotTitle,
      submitterName: spotData.submitterName,
      description: spotData.description || '',
      type: activityType,
      photoUrl: spotData.photoUrl,
      source: 'manual',
      status: 'pending',
      submittedAt: new Date().toISOString(),
      venueId: resolvedVenueId,
      timeStart: spotData.timeStart || null,
      timeEnd: spotData.timeEnd || null,
      days: spotData.days ? spotData.days.join(',') : null,
      specificDate: spotData.specificDate || null,
      promotionList: spotData.promotionList || null,
    });

    const venueLabel = resolvedVenueId
      ? `\n🔗 Venue: ${venueName} (${resolvedVenueId})`
      : '';
    const newVenueLabel = isNewVenue ? '\n🆕 NEW VENUE (needs enrichment)' : '';

    try {
      await sendApprovalRequest({
        id: newId,
        title: spotTitle,
        type: activityType,
        lat: spotData.lat ?? 0,
        lng: spotData.lng ?? 0,
        description: `By: ${spotData.submitterName}\n${spotData.description || ''}${venueLabel}${newVenueLabel}`,
      });
    } catch (telegramError) {
      console.warn('Telegram notification failed (spot still saved):', telegramError);
    }

    invalidate(SPOTS_CACHE_KEY);
    return NextResponse.json({
      id: newId, title: spotTitle, type: activityType,
      venueId: resolvedVenueId, area: resolvedArea, status: 'pending',
    }, { status: 201 });
  } catch (error) {
    console.error('Error adding spot:', error);
    return NextResponse.json({ error: 'Failed to add spot' }, { status: 500 });
  }
}
