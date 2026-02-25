import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { spots, venues } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!checkRateLimit(`health-get:${ip}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  // 1. App is running (always true if we get here)
  checks.app = { ok: true };

  // 2. Spots table
  try {
    const count = spots.count();
    checks.spots = { ok: true, detail: `${count} spots` };
  } catch (err) {
    checks.spots = { ok: false, detail: String(err) };
  }

  // 3. Venues table
  try {
    const count = venues.getAll().length;
    checks.venues = { ok: true, detail: `${count} venues` };
  } catch (err) {
    checks.venues = { ok: false, detail: String(err) };
  }

  // 4. Disk writable (logs dir)
  try {
    const logsDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    const testFile = path.join(logsDir, '.health-check');
    fs.writeFileSync(testFile, new Date().toISOString());
    fs.unlinkSync(testFile);
    checks.disk = { ok: true };
  } catch (err) {
    checks.disk = { ok: false, detail: String(err) };
  }

  // 5. Environment keys present
  const requiredEnvKeys = ['NEXT_PUBLIC_GOOGLE_MAPS_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_ADMIN_CHAT_ID'];
  const missingKeys = requiredEnvKeys.filter(k => !process.env[k]);
  checks.env = missingKeys.length === 0
    ? { ok: true, detail: `${requiredEnvKeys.length} keys present` }
    : { ok: false, detail: `missing: ${missingKeys.join(', ')}` };

  const allOk = Object.values(checks).every(c => c.ok);

  return NextResponse.json(
    {
      ok: allOk,
      service: 'chs-finds',
      timestamp: new Date().toISOString(),
      checks,
    },
    {
      status: allOk ? 200 : 503,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      },
    }
  );
}
