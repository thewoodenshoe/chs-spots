import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { areasDb } from '@/lib/db';
import { getCache, setCache } from '@/lib/cache';

const CACHE_KEY = 'api:areas:config';
const CACHE_TTL = 600_000;

export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!checkRateLimit(`areas-config-get:${ip}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const cached = getCache<unknown[]>(CACHE_KEY);
  if (cached) {
    return NextResponse.json(cached, { headers: { 'X-Cache': 'HIT' } });
  }

  try {
    const rows = areasDb.getAll();
    const areas = rows.map(r => ({
      name: r.name,
      displayName: r.display_name,
      description: r.description,
      center: r.center_lat != null ? { lat: r.center_lat, lng: r.center_lng } : undefined,
      radiusMeters: r.radius_meters,
      bounds: r.bounds ? JSON.parse(r.bounds) : undefined,
      zipCodes: r.zip_codes ? JSON.parse(r.zip_codes) : undefined,
    }));
    setCache(CACHE_KEY, areas, CACHE_TTL);
    return NextResponse.json(areas, { headers: { 'X-Cache': 'MISS' } });
  } catch (error) {
    console.error('Error reading areas config from database:', error);
    return NextResponse.json({ error: 'Failed to load areas configuration' }, { status: 500 });
  }
}
