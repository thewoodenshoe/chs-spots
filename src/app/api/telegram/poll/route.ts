 
import { NextResponse } from 'next/server';
import { answerCallbackQuery } from '@/lib/telegram';

/**
 * Telegram Polling Endpoint
 * 
 * Alternative to webhooks — useful when the server isn't publicly accessible.
 * Delegates callback handling to the webhook POST handler which already
 * supports all action types (approve, deny, edtappr, edtdeny, delappr, deldeny, etc.).
 * 
 * Usage: GET /api/telegram/poll
 */

let lastOffset = 0;

export async function GET(request: Request) {
  const { isAdminRequest, unauthorizedResponse } = await import('@/lib/auth');
  if (!isAdminRequest(request)) return unauthorizedResponse();

  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN not configured' }, { status: 500 });
    }

    const response = await fetch(
      `https://api.telegram.org/bot${token}/getUpdates?offset=${lastOffset + 1}&timeout=1`,
      { cache: 'no-store' }
    );

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch updates' }, { status: 500 });
    }

    const data = await response.json();
    const updates = data.result || [];
    let processed = 0;

    for (const update of updates) {
      lastOffset = Math.max(lastOffset, update.update_id);

      if (update.callback_query) {
        const { POST } = await import('@/app/api/telegram/webhook/route');
        const fakeRequest = new Request('http://localhost/api/telegram/webhook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(update),
        });
        await POST(fakeRequest);
        processed++;
      }

      if (update.message?.text === '/start') {
        const chatId = update.message.chat.id;
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `👋 Charleston Finds Admin Bot\n\nYour chat ID is: \`${chatId}\`\n\nAdd this as TELEGRAM_ADMIN_CHAT_ID in your .env.local file.`,
            parse_mode: 'Markdown',
          }),
        });
        processed++;
      }
    }

    return NextResponse.json({ ok: true, updates: updates.length, processed, lastOffset });
  } catch (error) {
    console.error('Telegram polling error:', error);
    return NextResponse.json({ error: 'Polling failed' }, { status: 500 });
  }
}
