import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { venues, spots } from '@/lib/db';
import { safeJsonParse } from '@/lib/cache';

export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!checkRateLimit(`venues-search:${ip}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') || '').trim();
  const lat = parseFloat(searchParams.get('lat') || '');
  const lng = parseFloat(searchParams.get('lng') || '');
  const activityType = searchParams.get('activity') || '';

  try {
    const allVenues = q.length >= 2
      ? venues.search(q, 100)
      : venues.getAll();

    const results = allVenues.map(v => {
      const dist = !isNaN(lat) && !isNaN(lng)
        ? Math.round(haversineMeters(lat, lng, v.lat, v.lng))
        : null;

      const duplicate = activityType && v.id
        ? spots.existsForVenue(v.id, activityType)
        : false;

      return {
        id: v.id,
        name: v.name,
        lat: v.lat,
        lng: v.lng,
        area: v.area || null,
        address: v.address || null,
        phone: v.phone || null,
        website: v.website || null,
        operatingHours: v.operating_hours ? safeJsonParse(v.operating_hours) : null,
        distance: dist,
        hasActivity: duplicate,
      };
    });

    if (!isNaN(lat) && !isNaN(lng)) {
      results.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
    }

    const limited = results.slice(0, 50);

    return NextResponse.json(limited);
  } catch (error) {
    console.error('Error searching venues:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
