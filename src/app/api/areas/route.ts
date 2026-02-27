import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { areasDb } from '@/lib/db';
import { getCache, setCache } from '@/lib/cache';

const CACHE_KEY = 'api:areas';
const CACHE_TTL = 600_000;

export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!checkRateLimit(`areas-get:${ip}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const cached = getCache<string[]>(CACHE_KEY);
  if (cached) {
    return NextResponse.json(cached, { headers: { 'X-Cache': 'HIT' } });
  }

  try {
    const areaNames = areasDb.getNames();
    setCache(CACHE_KEY, areaNames, CACHE_TTL);
    return NextResponse.json(areaNames, { headers: { 'X-Cache': 'MISS' } });
  } catch (error) {
    console.error('Error reading areas from database:', error);
    return NextResponse.json({ error: 'Failed to load areas' }, { status: 500 });
  }
}
