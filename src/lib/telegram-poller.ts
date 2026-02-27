/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Telegram Polling Background Service
 *
 * Runs automatically when the Next.js server starts (via instrumentation.ts).
 * Polls the Telegram Bot API every few seconds for callback queries
 * (Approve / Deny button presses) and processes them.
 */

import { answerCallbackQuery } from './telegram';
import {
  handleSpotAction,
  handleActivityAction,
  handleReportAction,
  handleEditAction,
  handleDeleteAction,
  handleTextCommand,
  routeCallbackData,
} from './telegram-actions';

let lastOffset = 0;
let intervalId: ReturnType<typeof setInterval> | null = null;
let consecutiveErrors = 0;

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function pollOnce(): Promise<void> {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return;

    const response = await fetchWithTimeout(
      `https://api.telegram.org/bot${token}/getUpdates?offset=${lastOffset + 1}&timeout=0`,
      { cache: 'no-store' },
      10000
    );

    if (!response.ok) return;

    const data = await response.json();
    const updates = data.result || [];

    consecutiveErrors = 0;

    for (const update of updates) {
      lastOffset = Math.max(lastOffset, update.update_id);

      if (update.callback_query) {
        await handleCallback(update.callback_query);
      }

      if (update.message?.text) {
        const chatId = update.message.chat.id;
        const text = update.message.text.trim();

        if (text === '/start') {
          await fetchWithTimeout(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: `👋 CHS Finds Admin Bot\n\nYour chat ID is: \`${chatId}\`\n\nAdd this as TELEGRAM_ADMIN_CHAT_ID in your .env.local file.`,
              parse_mode: 'Markdown',
            }),
          });
        } else {
          await handleTextCommand(text, chatId);
        }
      }
    }
  } catch (error: any) {
    consecutiveErrors++;
    if (consecutiveErrors <= 3 || consecutiveErrors % 10 === 0) {
      const reason = error?.cause?.code || error?.code || error?.message || 'unknown';
      console.warn(`[Telegram] Poll failed (${reason}) — attempt ${consecutiveErrors}`);
    }
  }
}

async function handleCallback(callbackQuery: any): Promise<void> {
  const data = callbackQuery.data as string;
  const chatId = callbackQuery.message?.chat?.id;
  const messageId = callbackQuery.message?.message_id;

  const route = routeCallbackData(data);
  if (!route) {
    await answerCallbackQuery(callbackQuery.id, 'Unknown action');
    return;
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
}

export function startTelegramPolling(intervalMs = 5000): void {
  if (intervalId) return;

  const pollingEnabled = process.env.TELEGRAM_POLLING_ENABLED === 'true';
  if (!pollingEnabled) {
    console.log('[Telegram] Polling disabled (set TELEGRAM_POLLING_ENABLED=true to enable).');
    return;
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log('[Telegram] No TELEGRAM_BOT_TOKEN set, polling disabled.');
    return;
  }

  console.log(`[Telegram] Polling started (every ${intervalMs / 1000}s)`);
  intervalId = setInterval(pollOnce, intervalMs);

  pollOnce();
}

export function stopTelegramPolling(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[Telegram] Polling stopped.');
  }
}
