/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Telegram Polling Background Service
 *
 * Runs automatically when the Next.js server starts (via instrumentation.ts).
 * Polls the Telegram Bot API every few seconds for callback queries
 * (Approve / Deny button presses) and processes them.
 */

import fs from 'fs';
import { answerCallbackQuery, editMessage } from './telegram';
import { atomicWriteFileSync } from './atomic-write';
import { reportingPath } from './data-dir';

let lastOffset = 0;
let intervalId: ReturnType<typeof setInterval> | null = null;
let consecutiveErrors = 0;

/** Fetch with a hard timeout so we never hang indefinitely. */
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
    if (!token) return; // Silently skip if not configured

    const response = await fetchWithTimeout(
      `https://api.telegram.org/bot${token}/getUpdates?offset=${lastOffset + 1}&timeout=0`,
      { cache: 'no-store' },
      10000
    );

    if (!response.ok) return;

    const data = await response.json();
    const updates = data.result || [];

    // Reset error counter on success
    consecutiveErrors = 0;

    for (const update of updates) {
      lastOffset = Math.max(lastOffset, update.update_id);

      // Handle callback query (inline keyboard button press)
      if (update.callback_query) {
        await handleCallback(update.callback_query, token);
      }

      // Handle /start command
      if (update.message?.text === '/start') {
        const chatId = update.message.chat.id;
        await fetchWithTimeout(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `👋 CHS Finds Admin Bot\n\nYour chat ID is: \`${chatId}\`\n\nAdd this as TELEGRAM_ADMIN_CHAT_ID in your .env.local file.`,
            parse_mode: 'Markdown',
          }),
        });
      }
    }
  } catch (error: any) {
    consecutiveErrors++;
    // Only log every few failures to avoid spamming the console
    if (consecutiveErrors <= 3 || consecutiveErrors % 10 === 0) {
      const reason = error?.cause?.code || error?.code || error?.message || 'unknown';
      console.warn(`[Telegram] Poll failed (${reason}) — attempt ${consecutiveErrors}`);
    }
  }
}

async function handleCallback(callbackQuery: any, token: string): Promise<void> {
  const callbackData = callbackQuery.data as string;
  const chatId = callbackQuery.message?.chat?.id;
  const messageId = callbackQuery.message?.message_id;

  const match = callbackData.match(/^(approve|deny)_(\d+)$/);
  if (!match) {
    await answerCallbackQuery(callbackQuery.id, 'Invalid action');
    return;
  }

  const action = match[1];
  const spotId = parseInt(match[2], 10);

  // Read spots from disk
  const spotsPath = reportingPath('spots.json');

  let spots: any[] = [];
  if (fs.existsSync(spotsPath)) {
    try {
      spots = JSON.parse(fs.readFileSync(spotsPath, 'utf8'));
      if (!Array.isArray(spots)) spots = [];
    } catch (err) {
      console.error('[Telegram] Failed to read spots.json:', err);
      spots = [];
    }
  } else {
    console.error(`[Telegram] spots.json not found at: ${spotsPath}`);
  }

  // Use loose equality (==) so string/number mismatches don't cause failures
  const spotIndex = spots.findIndex((s: any) => s.id == spotId);

  if (spotIndex === -1) {
    console.error(`[Telegram] Spot #${spotId} not found. Total spots: ${spots.length}, cwd: ${process.cwd()}, path: ${spotsPath}`);
    await answerCallbackQuery(callbackQuery.id, 'Spot not found');
    if (chatId && messageId) {
      await editMessage(chatId, messageId, `❓ Spot #${spotId} not found.`);
    }
    return;
  }

  const spot = spots[spotIndex];
  const newStatus = action === 'approve' ? 'approved' : 'denied';
  spots[spotIndex] = { ...spot, status: newStatus };

  try {
    atomicWriteFileSync(spotsPath, JSON.stringify(spots, null, 2));
  } catch (err) {
    console.error('[Telegram] Failed to write spots.json:', err);
    await answerCallbackQuery(callbackQuery.id, 'Error saving — try again');
    return;
  }

  if (action === 'approve') {
    await answerCallbackQuery(callbackQuery.id, `Approved: ${spot.title}`);
    if (chatId && messageId) {
      await editMessage(chatId, messageId, `✅ *Approved*: ${spot.title}\n\nSpot is now visible on the map.`);
    }
  } else {
    await answerCallbackQuery(callbackQuery.id, `Denied: ${spot.title}`);
    if (chatId && messageId) {
      await editMessage(chatId, messageId, `❌ *Denied*: ${spot.title}\n\nSpot has been rejected.`);
    }
  }

  console.log(`[Telegram] ${action === 'approve' ? '✅' : '❌'} ${spot.title} (ID: ${spotId})`);
}

export function startTelegramPolling(intervalMs = 5000): void {
  if (intervalId) return; // Already running

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
