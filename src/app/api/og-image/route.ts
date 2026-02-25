import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!checkRateLimit(`og-image:${ip}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  const imagePath = path.join(process.cwd(), 'public', 'og-image.jpg');
  
  if (!fs.existsSync(imagePath)) {
    return NextResponse.json({ error: 'Image not found' }, { status: 404 });
  }

  const imageBuffer = fs.readFileSync(imagePath);
  
  return new NextResponse(imageBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
