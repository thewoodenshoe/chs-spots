/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { sendApprovalRequest } from '@/lib/telegram';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { isAdminRequest } from '@/lib/auth';
import { createSpotSchema, parseOrError } from '@/lib/validations';
import { spots, venues, type SpotRow, type VenueRow } from '@/lib/db';

function transformSpot(spot: SpotRow, venueMap: Map<string, VenueRow>) {
  const venue = spot.venue_id ? venueMap.get(spot.venue_id) : undefined;
  const transformed: any = {
    id: spot.id,
    lat: venue?.lat ?? 0,
    lng: venue?.lng ?? 0,
    title: spot.title,
    description: spot.description || '',
    type: spot.type || 'Happy Hour',
    photoUrl: spot.photo_url || undefined,
    source: spot.source || 'automated',
    status: spot.status || 'approved',
    happyHourTime: spot.promotion_time || undefined,
    happyHourList: spot.promotion_list ? JSON.parse(spot.promotion_list) : undefined,
    sourceUrl: spot.source_url || undefined,
    lastUpdateDate: spot.last_update_date || undefined,
    venueId: spot.venue_id || undefined,
    area: venue?.area || undefined,
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
    const allSpots = isAdmin
      ? spots.getAll()
      : spots.getAll({ visibleOnly: true });

    const allVenues = venues.getAll();
    const venueMap = new Map<string, VenueRow>();
    for (const v of allVenues) venueMap.set(v.id, v);

    const transformed = allSpots.map(s => transformSpot(s, venueMap));
    return NextResponse.json(transformed);
  } catch (error) {
    console.error('Error reading spots from database:', error);
    return NextResponse.json([]);
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

    const newId = spots.insert({
      title: spotData.title,
      submitterName: spotData.submitterName,
      description: spotData.description || '',
      type: spotData.type || spotData.activity || 'Happy Hour',
      photoUrl: spotData.photoUrl,
      source: 'manual',
      status: 'pending',
      submittedAt: new Date().toISOString(),
    });

    const newSpot = {
      id: newId,
      title: spotData.title,
      submitterName: spotData.submitterName,
      description: spotData.description || '',
      lat: spotData.lat,
      lng: spotData.lng,
      activity: spotData.type || spotData.activity || 'Happy Hour',
      type: spotData.type || spotData.activity || 'Happy Hour',
      photoUrl: spotData.photoUrl,
      area: spotData.area,
      source: 'manual',
      status: 'pending',
      submittedAt: new Date().toISOString(),
    };

    try {
      await sendApprovalRequest({
        id: newId,
        title: newSpot.title,
        type: newSpot.type,
        lat: newSpot.lat,
        lng: newSpot.lng,
        description: `By: ${newSpot.submitterName}\n${newSpot.description}`,
      });
    } catch (telegramError) {
      console.warn('Telegram notification failed (spot still saved):', telegramError);
    }

    return NextResponse.json(newSpot, { status: 201 });
  } catch (error) {
    console.error('Error adding spot:', error);
    return NextResponse.json(
      { error: 'Failed to add spot' },
      { status: 500 }
    );
  }
}
