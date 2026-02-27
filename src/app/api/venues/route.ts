import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { venues } from '@/lib/db';
import { getCache, setCache } from '@/lib/cache';

const VENUES_TTL = 300_000; // 5 minutes

function safeJsonParse(value: string): unknown {
  try { return JSON.parse(value); }
  catch { return null; }
}

export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!checkRateLimit(`venues-get:${ip}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const areaFilter = searchParams.get('area');
  const cacheKey = `api:venues:${areaFilter || 'all'}`;

  try {
    const cached = getCache<unknown[]>(cacheKey);
    if (cached) {
      return NextResponse.json(cached, { headers: { 'X-Cache': 'HIT' } });
    }

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
      operatingHours: v.operating_hours ? safeJsonParse(v.operating_hours) : null,
    }));

    setCache(cacheKey, transformed, VENUES_TTL);
    return NextResponse.json(transformed, { headers: { 'X-Cache': 'MISS' } });
  } catch (error) {
    console.error('Error reading venues from database:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
