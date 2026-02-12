/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Telegram Polling Background Service
 *
 * Runs automatically when the Next.js server starts (via instrumentation.ts).
 * Polls the Telegram Bot API every few seconds for callback queries
 * (Approve / Deny button presses) and processes them.
 */

import fs from 'fs';
import path from 'path';
import { answerCallbackQuery, editMessage } from './telegram';

let lastOffset = 0;
let intervalId: ReturnType<typeof setInterval> | null = null;

async function pollOnce(): Promise<void> {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return; // Silently skip if not configured

    const response = await fetch(
      `https://api.telegram.org/bot${token}/getUpdates?offset=${lastOffset + 1}&timeout=1`,
      { cache: 'no-store' }
    );

    if (!response.ok) return;

    const data = await response.json();
    const updates = data.result || [];

    for (const update of updates) {
      lastOffset = Math.max(lastOffset, update.update_id);

      // Handle callback query (inline keyboard button press)
      if (update.callback_query) {
        const callbackQuery = update.callback_query;
        const callbackData = callbackQuery.data as string;
        const chatId = callbackQuery.message?.chat?.id;
        const messageId = callbackQuery.message?.message_id;

        const match = callbackData.match(/^(approve|deny)_(\d+)$/);
        if (!match) {
          await answerCallbackQuery(callbackQuery.id, 'Invalid action');
          continue;
        }

        const action = match[1];
        const spotId = parseInt(match[2], 10);

        // Update spot status
        const reportingDir = path.join(process.cwd(), 'data', 'reporting');
        const spotsPath = path.join(reportingDir, 'spots.json');

        let spots: any[] = [];
        if (fs.existsSync(spotsPath)) {
          try {
            spots = JSON.parse(fs.readFileSync(spotsPath, 'utf8'));
            if (!Array.isArray(spots)) spots = [];
          } catch {
            spots = [];
          }
        }

        const spotIndex = spots.findIndex((s: any) => s.id === spotId);

        if (spotIndex === -1) {
          await answerCallbackQuery(callbackQuery.id, 'Spot not found');
          if (chatId && messageId) {
            await editMessage(chatId, messageId, `❓ Spot #${spotId} not found.`);
          }
          continue;
        }

        const spot = spots[spotIndex];

        if (action === 'approve') {
          spots[spotIndex] = { ...spot, status: 'approved' };
          fs.writeFileSync(spotsPath, JSON.stringify(spots, null, 2), 'utf8');
          await answerCallbackQuery(callbackQuery.id, `Approved: ${spot.title}`);
          if (chatId && messageId) {
            await editMessage(chatId, messageId, `✅ *Approved*: ${spot.title}\n\nSpot is now visible on the map.`);
          }
        } else {
          spots[spotIndex] = { ...spot, status: 'denied' };
          fs.writeFileSync(spotsPath, JSON.stringify(spots, null, 2), 'utf8');
          await answerCallbackQuery(callbackQuery.id, `Denied: ${spot.title}`);
          if (chatId && messageId) {
            await editMessage(chatId, messageId, `❌ *Denied*: ${spot.title}\n\nSpot has been rejected.`);
          }
        }

        console.log(`[Telegram] ${action === 'approve' ? '✅' : '❌'} ${spot.title} (ID: ${spotId})`);
      }

      // Handle /start command
      if (update.message?.text === '/start') {
        const chatId = update.message.chat.id;
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `👋 Charleston Hotspots Admin Bot\n\nYour chat ID is: \`${chatId}\`\n\nAdd this as TELEGRAM_ADMIN_CHAT_ID in your .env.local file.`,
            parse_mode: 'Markdown',
          }),
        });
      }
    }
  } catch (error) {
    // Log but don't crash — we'll retry on next interval
    console.error('[Telegram] Polling error:', error);
  }
}

export function startTelegramPolling(intervalMs = 5000): void {
  if (intervalId) return; // Already running

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log('[Telegram] No TELEGRAM_BOT_TOKEN set, polling disabled.');
    return;
  }

  console.log(`[Telegram] Polling started (every ${intervalMs / 1000}s)`);
  intervalId = setInterval(pollOnce, intervalMs);

  // Run once immediately
  pollOnce();
}

export function stopTelegramPolling(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[Telegram] Polling stopped.');
  }
}
