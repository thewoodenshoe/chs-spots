import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!checkRateLimit(`areas-get:${ip}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    const areasPath = path.join(process.cwd(), 'data', 'config', 'areas.json');
    const areasContents = fs.readFileSync(areasPath, 'utf8');
    const areas = JSON.parse(areasContents);
    
    // Return array of area names from the config
    const areaNames = areas.map((area: any) => area.name);
    
    return NextResponse.json(areaNames);
  } catch (error) {
    console.error('Error reading areas.json:', error);
    return NextResponse.json({ error: 'Failed to load areas' }, { status: 500 });
  }
}
