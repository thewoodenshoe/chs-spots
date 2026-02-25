import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { areasDb } from '@/lib/db';

export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!checkRateLimit(`areas-get:${ip}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    const areaNames = areasDb.getNames();
    return NextResponse.json(areaNames);
  } catch (error) {
    console.error('Error reading areas from database:', error);
    return NextResponse.json({ error: 'Failed to load areas' }, { status: 500 });
  }
}
