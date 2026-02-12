import { NextResponse } from 'next/server';
import { sendNotification, escapeMarkdown } from '@/lib/telegram';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { feedbackSchema, parseOrError } from '@/lib/validations';

export async function POST(request: Request) {
  // Rate limit: 2 feedback messages per minute per IP
  const clientIp = getClientIp(request);
  if (!checkRateLimit(clientIp, 2, 60_000)) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a moment.' },
      { status: 429 },
    );
  }

  try {
    const raw = await request.json();
    const parsed = parseOrError(feedbackSchema, raw);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const { name, email, message } = parsed.data;

    const text = [
      '💬 *User Feedback*',
      '',
      `👤 Name: ${escapeMarkdown(name || 'Anonymous')}`,
      `📧 Email: ${escapeMarkdown(email || 'Not provided')}`,
      '',
      `📝 ${escapeMarkdown(message)}`,
    ].join('\n');

    await sendNotification(text);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Feedback submission error:', error);
    return NextResponse.json(
      { error: 'Failed to submit feedback' },
      { status: 500 },
    );
  }
}
