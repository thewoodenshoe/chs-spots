import { NextResponse } from 'next/server';
import fs from 'fs';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { configPath } from '@/lib/data-dir';

export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!checkRateLimit(`activities-get:${ip}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  const activitiesPath = configPath('activities.json');
  
  try {
    if (fs.existsSync(activitiesPath)) {
      const content = fs.readFileSync(activitiesPath, 'utf8');
      const activities = JSON.parse(content);
      return NextResponse.json(activities);
    }
  } catch (error) {
    console.error('Error reading activities.json:', error);
  }

  return NextResponse.json([
    { name: 'Happy Hour', icon: 'Martini', emoji: '🍹', color: '#0d9488' },
    { name: 'Brunch', icon: 'Coffee', emoji: '🥞', color: '#d97706' },
    { name: 'Fishing Spots', icon: 'Fish', emoji: '🎣', color: '#0284c7', communityDriven: true },
    { name: 'Must-See Spots', icon: 'Compass', emoji: '⭐', color: '#8b5cf6', communityDriven: true },
  ]);
}
