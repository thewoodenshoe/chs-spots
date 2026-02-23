import { NextResponse } from 'next/server';
import fs from 'fs';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { configPath } from '@/lib/data-dir';

export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!checkRateLimit(`areas-config-get:${ip}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  try {
    const areasPath = configPath('areas.json');
    const areasContents = fs.readFileSync(areasPath, 'utf8');
    const areas = JSON.parse(areasContents);
    
    // Return full area configuration objects
    return NextResponse.json(areas);
  } catch (error) {
    console.error('Error reading areas.json:', error);
    return NextResponse.json({ error: 'Failed to load areas configuration' }, { status: 500 });
  }
}
