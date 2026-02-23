import { NextResponse } from 'next/server';
import { sendActivityApproval } from '@/lib/telegram';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { z } from 'zod';
import { parseOrError } from '@/lib/validations';

const suggestSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  activityName: z.string().min(1, 'Activity name is required').max(80),
  description: z.string().max(500).default(''),
});

export async function POST(request: Request) {
  const clientIp = getClientIp(request);
  if (!checkRateLimit(`suggest:${clientIp}`, 3, 300_000)) {
    return NextResponse.json(
      { error: 'Too many suggestions. Please wait a few minutes.' },
      { status: 429 },
    );
  }

  try {
    const raw = await request.json();
    const parsed = parseOrError(suggestSchema, raw);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { name, activityName, description } = parsed.data;

    await sendActivityApproval({
      name,
      activityName,
      description: description || undefined,
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Activity suggestion error:', error);
    return NextResponse.json(
      { error: 'Failed to submit suggestion' },
      { status: 500 },
    );
  }
}
