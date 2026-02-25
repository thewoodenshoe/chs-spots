import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { venues } from '@/lib/db';

export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!checkRateLimit(`venues-get:${ip}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const areaFilter = searchParams.get('area');

  try {
    const allVenues = areaFilter
      ? venues.getByArea(areaFilter)
      : venues.getAll();

    const transformed = allVenues.map(v => ({
      id: v.id,
      name: v.name,
      lat: v.lat,
      lng: v.lng,
      area: v.area || null,
      address: v.address || null,
      website: v.website || null,
    }));

    return NextResponse.json(transformed);
  } catch (error) {
    console.error('Error reading venues from database:', error);
    return NextResponse.json([]);
  }
}
