import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { activitiesDb } from '@/lib/db';

const DEFAULT_ACTIVITIES = [
  { name: 'Happy Hour', icon: 'Martini', emoji: '🍹', color: '#0d9488' },
  { name: 'Brunch', icon: 'Coffee', emoji: '🥞', color: '#d97706' },
  { name: 'Fishing Spots', icon: 'Fish', emoji: '🎣', color: '#0284c7', communityDriven: true },
  { name: 'Must-Do Spots', icon: 'Compass', emoji: '⭐', color: '#8b5cf6', communityDriven: true },
];

export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!checkRateLimit(`activities-get:${ip}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    const rows = activitiesDb.getAll();
    if (rows.length > 0) {
      const activities = rows.map(r => ({
        name: r.name,
        icon: r.icon,
        emoji: r.emoji,
        color: r.color,
        ...(r.community_driven ? { communityDriven: true } : {}),
      }));
      return NextResponse.json(activities);
    }
  } catch (error) {
    console.error('Error reading activities from database:', error);
  }

  return NextResponse.json(DEFAULT_ACTIVITIES);
}
