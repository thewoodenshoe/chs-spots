import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { activitiesDb } from '@/lib/db';
import { getCache, setCache } from '@/lib/cache';

const DEFAULT_ACTIVITIES = [
  { name: 'Happy Hour', icon: 'Martini', emoji: '🍹', color: '#0d9488' },
  { name: 'Brunch', icon: 'Coffee', emoji: '🥞', color: '#d97706' },
  { name: 'Must-Do Spots', icon: 'Compass', emoji: '⭐', color: '#8b5cf6', communityDriven: true },
  { name: 'Recently Opened', icon: 'Sparkles', emoji: '🆕', color: '#16a34a' },
  { name: 'Coming Soon', icon: 'Clock', emoji: '🔜', color: '#7c3aed' },
];

const CACHE_KEY = 'api:activities';
const CACHE_TTL = 600_000; // 10 minutes

export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!checkRateLimit(`activities-get:${ip}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const cached = getCache<unknown[]>(CACHE_KEY);
  if (cached) {
    return NextResponse.json(cached, { headers: { 'X-Cache': 'HIT' } });
  }

  try {
    const rows = activitiesDb.getAll();
    if (rows.length > 0) {
      const activities = rows
        .filter(r => !r.hidden)
        .map(r => ({
          name: r.name,
          icon: r.icon,
          emoji: r.emoji,
          color: r.color,
          ...(r.community_driven ? { communityDriven: true } : {}),
        }));
      setCache(CACHE_KEY, activities, CACHE_TTL);
      return NextResponse.json(activities, { headers: { 'X-Cache': 'MISS' } });
    }
  } catch (error) {
    console.error('Error reading activities from database:', error);
  }

  return NextResponse.json(DEFAULT_ACTIVITIES);
}
