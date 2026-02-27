/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { answerCallbackQuery } from '@/lib/telegram';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import {
  handleSpotAction,
  handleActivityAction,
  handleReportAction,
  handleEditAction,
  handleDeleteAction,
  handleTextCommand,
  routeCallbackData,
} from '@/lib/telegram-actions';

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!checkRateLimit(`tg-webhook:${ip}`, 60, 60_000)) {
    return NextResponse.json({ ok: true }, { status: 429 });
  }

  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('[Telegram] TELEGRAM_WEBHOOK_SECRET not configured — rejecting all webhook requests');
    return NextResponse.json({ ok: false }, { status: 503 });
  }
  const headerSecret = request.headers.get('x-telegram-bot-api-secret-token');
  if (headerSecret !== webhookSecret) {
    console.warn('[Telegram] Webhook request with invalid/missing secret token');
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  try {
    const update = await request.json();

    if (update.callback_query) {
      const callbackQuery = update.callback_query;
      const data = callbackQuery.data as string;
      const chatId = callbackQuery.message?.chat?.id;
      const messageId = callbackQuery.message?.message_id;

      const route = routeCallbackData(data);
      if (!route) {
        await answerCallbackQuery(callbackQuery.id, 'Unknown action');
        return NextResponse.json({ ok: true });
      }

      const handlers: Record<string, (action: string, id: any, cq: any, chatId: any, messageId: any) => Promise<void>> = {
        spot: handleSpotAction,
        activity: handleActivityAction,
        report: handleReportAction,
        edit: handleEditAction,
        delete: handleDeleteAction,
      };

      const handler = handlers[route.handler];
      if (handler) {
        await handler(route.args[0], route.args[1], callbackQuery, chatId, messageId);
      }

      return NextResponse.json({ ok: true });
    }

    if (update.message?.text) {
      const chatId = update.message.chat.id;
      const text = update.message.text.trim();

      if (text === '/start') {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (token) {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: `👋 Charleston Finds Admin Bot\n\nYour chat ID is: \`${chatId}\`\n\nAdd this as TELEGRAM_ADMIN_CHAT_ID in your .env.local file.`,
              parse_mode: 'Markdown',
            }),
          });
        }
      } else {
        await handleTextCommand(text, chatId);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Telegram webhook error:', error);
    return NextResponse.json({ ok: true });
  }
}

export async function GET() {
  return NextResponse.json({ status: 'Telegram webhook is active' });
}
