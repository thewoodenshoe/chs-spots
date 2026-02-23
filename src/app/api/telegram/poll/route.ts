/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import fs from 'fs';
import { answerCallbackQuery, editMessage } from '@/lib/telegram';
import { atomicWriteFileSync } from '@/lib/atomic-write';
import { reportingPath } from '@/lib/data-dir';

/**
 * Telegram Polling Endpoint
 * 
 * Alternative to webhooks — useful when the server isn't publicly accessible.
 * Call this endpoint periodically (e.g., every 5 seconds via cron or a simple script)
 * to check for new Telegram updates and process approval/denial actions.
 * 
 * Usage: GET /api/telegram/poll
 * 
 * For production, set up the webhook instead:
 *   curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://your-domain/api/telegram/webhook"
 */

// Store the last update offset to avoid processing duplicates
let lastOffset = 0;

export async function GET(request: Request) {
  // Protect poll endpoint with admin auth
  const { isAdminRequest, unauthorizedResponse } = await import('@/lib/auth');
  if (!isAdminRequest(request)) return unauthorizedResponse();

  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN not configured' }, { status: 500 });
    }

    // Get updates from Telegram
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
        const spotsPath = reportingPath('spots.json');

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
          atomicWriteFileSync(spotsPath, JSON.stringify(spots, null, 2));
          await answerCallbackQuery(callbackQuery.id, `Approved: ${spot.title}`);
          if (chatId && messageId) {
            await editMessage(chatId, messageId, `✅ *Approved*: ${spot.title}\n\nSpot is now visible on the map.`);
          }
        } else {
          spots[spotIndex] = { ...spot, status: 'denied' };
          atomicWriteFileSync(spotsPath, JSON.stringify(spots, null, 2));
          await answerCallbackQuery(callbackQuery.id, `Denied: ${spot.title}`);
          if (chatId && messageId) {
            await editMessage(chatId, messageId, `❌ *Denied*: ${spot.title}\n\nSpot has been rejected.`);
          }
        }

        processed++;
      }

      // Handle /start command — reply with chat ID
      if (update.message?.text === '/start') {
        const chatId = update.message.chat.id;
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `👋 CHS Finds Admin Bot\n\nYour chat ID is: \`${chatId}\`\n\nAdd this as TELEGRAM_ADMIN_CHAT_ID in your .env.local file.`,
            parse_mode: 'Markdown',
          }),
        });
        processed++;
      }
    }

    return NextResponse.json({
      ok: true,
      updates: updates.length,
      processed,
      lastOffset,
    });
  } catch (error) {
    console.error('Telegram polling error:', error);
    return NextResponse.json({ error: 'Polling failed' }, { status: 500 });
  }
}
