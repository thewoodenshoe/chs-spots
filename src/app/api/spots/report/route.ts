import { NextResponse } from 'next/server';
import { sendSpotReport } from '@/lib/telegram';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { z } from 'zod';
import { parseOrError } from '@/lib/validations';

const reportSchema = z.object({
  spotId: z.number().int().positive(),
  spotTitle: z.string().max(200),
  venueId: z.string().max(100).optional(),
  name: z.string().min(1, 'Name is required').max(100),
  issue: z.string().min(1, 'Please describe the issue').max(1000),
});

export async function POST(request: Request) {
  const clientIp = getClientIp(request);
  if (!checkRateLimit(`report:${clientIp}`, 5, 300_000)) {
    return NextResponse.json(
      { error: 'Too many reports. Please wait a few minutes.' },
      { status: 429 },
    );
  }

  try {
    const raw = await request.json();
    const parsed = parseOrError(reportSchema, raw);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { spotId, spotTitle, venueId, name, issue } = parsed.data;

    await sendSpotReport({
      spotId,
      spotTitle,
      venueId,
      reporterName: name,
      issue,
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Spot report error:', error);
    return NextResponse.json(
      { error: 'Failed to submit report' },
      { status: 500 },
    );
  }
}
