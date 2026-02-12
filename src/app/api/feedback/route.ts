import { NextResponse } from 'next/server';
import { sendNotification } from '@/lib/telegram';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

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
    const { name, email, message } = await request.json();

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 },
      );
    }

    const text = [
      '💬 *User Feedback*',
      '',
      `👤 Name: ${name || 'Anonymous'}`,
      `📧 Email: ${email || 'Not provided'}`,
      '',
      `📝 ${message.substring(0, 1000)}`,
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
