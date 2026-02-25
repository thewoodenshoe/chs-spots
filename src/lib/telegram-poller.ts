/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Telegram Polling Background Service
 *
 * Runs automatically when the Next.js server starts (via instrumentation.ts).
 * Polls the Telegram Bot API every few seconds for callback queries
 * (Approve / Deny button presses) and processes them.
 */

import { answerCallbackQuery, editMessage } from './telegram';
import { spots, activitiesDb, venues, getDb } from './db';

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

    consecutiveErrors = 0;

    for (const update of updates) {
      lastOffset = Math.max(lastOffset, update.update_id);

      if (update.callback_query) {
        await handleCallback(update.callback_query, token);
      }

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
    if (consecutiveErrors <= 3 || consecutiveErrors % 10 === 0) {
      const reason = error?.cause?.code || error?.code || error?.message || 'unknown';
      console.warn(`[Telegram] Poll failed (${reason}) — attempt ${consecutiveErrors}`);
    }
  }
}

async function handleCallback(callbackQuery: any, _token: string): Promise<void> {
  const data = callbackQuery.data as string;
  const chatId = callbackQuery.message?.chat?.id;
  const messageId = callbackQuery.message?.message_id;

  const spotMatch = data.match(/^(approve|deny)_(\d+)$/);
  if (spotMatch) {
    return handleSpotAction(spotMatch[1], parseInt(spotMatch[2], 10), callbackQuery, chatId, messageId);
  }

  const actMatch = data.match(/^(actadd|actdeny)_(.+)$/);
  if (actMatch) {
    return handleActivityAction(actMatch[1], actMatch[2], callbackQuery, chatId, messageId);
  }

  const rptMatch = data.match(/^(rptexcl|rptkeep)_(\d+)$/);
  if (rptMatch) {
    return handleReportAction(rptMatch[1], parseInt(rptMatch[2], 10), callbackQuery, chatId, messageId);
  }

  const edtMatch = data.match(/^(edtappr|edtdeny)_(\d+)$/);
  if (edtMatch) {
    return handleEditAction(edtMatch[1], parseInt(edtMatch[2], 10), callbackQuery, chatId, messageId);
  }

  const delMatch = data.match(/^(delappr|deldeny)_(\d+)$/);
  if (delMatch) {
    return handleDeleteAction(delMatch[1], parseInt(delMatch[2], 10), callbackQuery, chatId, messageId);
  }

  await answerCallbackQuery(callbackQuery.id, 'Unknown action');
}

async function handleSpotAction(action: string, spotId: number, cq: any, chatId: any, messageId: any) {
  const spot = spots.getById(spotId);
  if (!spot) {
    await answerCallbackQuery(cq.id, 'Spot not found');
    if (chatId && messageId) await editMessage(chatId, messageId, `❓ Spot #${spotId} not found.`);
    return;
  }
  const newStatus = action === 'approve' ? 'approved' : 'denied';
  spots.update(spotId, { status: newStatus });
  if (action === 'approve') {
    await answerCallbackQuery(cq.id, `Approved: ${spot.title}`);
    if (chatId && messageId) await editMessage(chatId, messageId, `✅ *Approved*: ${spot.title}\n\nSpot is now visible on the map.`);
  } else {
    await answerCallbackQuery(cq.id, `Denied: ${spot.title}`);
    if (chatId && messageId) await editMessage(chatId, messageId, `❌ *Denied*: ${spot.title}\n\nSpot has been rejected.`);
  }
  console.log(`[Telegram] ${action === 'approve' ? '✅' : '❌'} ${spot.title} (ID: ${spotId})`);
}

async function handleActivityAction(action: string, callbackId: string, cq: any, chatId: any, messageId: any) {
  const activityName = callbackId.replace(/_/g, ' ');
  if (action === 'actdeny') {
    await answerCallbackQuery(cq.id, 'Dismissed');
    if (chatId && messageId) await editMessage(chatId, messageId, `❌ *Dismissed* activity suggestion: ${activityName}`);
    return;
  }
  const activities = activitiesDb.getAll();
  if (activities.some(a => a.name.toLowerCase() === activityName.toLowerCase())) {
    await answerCallbackQuery(cq.id, 'Already exists');
    if (chatId && messageId) await editMessage(chatId, messageId, `⚠️ Activity "${activityName}" already exists.`);
    return;
  }
  getDb().prepare(
    'INSERT INTO activities (name, icon, emoji, color, community_driven) VALUES (?, ?, ?, ?, 1)'
  ).run(activityName, 'Star', '⭐', '#6366f1');
  await answerCallbackQuery(cq.id, `Added: ${activityName}`);
  if (chatId && messageId) await editMessage(chatId, messageId, `✅ *Added activity*: ${activityName}\n\nIt is now available in the filter menu.`);
}

async function handleReportAction(action: string, spotId: number, cq: any, chatId: any, messageId: any) {
  const spot = spots.getById(spotId);
  if (!spot) {
    await answerCallbackQuery(cq.id, 'Spot not found');
    if (chatId && messageId) await editMessage(chatId, messageId, `❓ Spot #${spotId} not found.`);
    return;
  }
  if (action === 'rptkeep') {
    await answerCallbackQuery(cq.id, 'Kept');
    if (chatId && messageId) await editMessage(chatId, messageId, `✅ *Kept*: ${spot.title}\n\nReport dismissed.`);
    return;
  }
  if (spot.venue_id) {
    const venue = venues.getById(spot.venue_id);
    getDb().prepare(
      `INSERT INTO watchlist (venue_id, name, area, status, reason)
       VALUES (?, ?, ?, 'excluded', ?)
       ON CONFLICT(venue_id) DO UPDATE SET
         name = excluded.name, area = excluded.area,
         status = excluded.status, reason = excluded.reason,
         updated_at = datetime('now')`
    ).run(spot.venue_id, spot.title, venue?.area || 'Unknown', `Excluded via user report (spot #${spotId})`);
  }
  spots.delete(spotId);
  await answerCallbackQuery(cq.id, `Excluded: ${spot.title}`);
  const venueNote = spot.venue_id ? `\nVenue \`${spot.venue_id}\` added to watchlist.` : '';
  if (chatId && messageId) await editMessage(chatId, messageId, `🚫 *Excluded*: ${spot.title}${venueNote}`);
}

async function handleEditAction(action: string, spotId: number, cq: any, chatId: any, messageId: any) {
  const spot = spots.getById(spotId);
  if (!spot) {
    await answerCallbackQuery(cq.id, 'Spot not found');
    if (chatId && messageId) await editMessage(chatId, messageId, `❓ Spot #${spotId} not found.`);
    return;
  }
  if (action === 'edtdeny') {
    spots.update(spotId, { pendingEdit: null });
    await answerCallbackQuery(cq.id, 'Edit rejected');
    if (chatId && messageId) await editMessage(chatId, messageId, `❌ *Edit rejected* for: ${spot.title}`);
    return;
  }
  if (!spot.pending_edit) {
    await answerCallbackQuery(cq.id, 'No pending edit');
    if (chatId && messageId) await editMessage(chatId, messageId, `⚠️ No pending edit found for ${spot.title}.`);
    return;
  }
  const edit = JSON.parse(spot.pending_edit);
  spots.update(spotId, {
    title: edit.title,
    description: edit.description,
    type: edit.type,
    photoUrl: edit.photoUrl !== undefined ? edit.photoUrl : spot.photo_url,
    editedAt: new Date().toISOString(),
    pendingEdit: null,
    ...(spot.source === 'automated' ? { manualOverride: 1 } : {}),
  });
  const updatedTitle = edit.title || spot.title;
  await answerCallbackQuery(cq.id, `Approved: ${updatedTitle}`);
  if (chatId && messageId) await editMessage(chatId, messageId, `✅ *Edit approved*: ${updatedTitle}\n\nChanges are now live.`);
  console.log(`[Telegram] ✏️ Edit approved: ${updatedTitle} (ID: ${spotId})`);
}

async function handleDeleteAction(action: string, spotId: number, cq: any, chatId: any, messageId: any) {
  const spot = spots.getById(spotId);
  if (!spot) {
    await answerCallbackQuery(cq.id, 'Spot not found');
    if (chatId && messageId) await editMessage(chatId, messageId, `❓ Spot #${spotId} not found.`);
    return;
  }
  if (action === 'deldeny') {
    spots.update(spotId, { pendingDelete: 0 });
    await answerCallbackQuery(cq.id, 'Delete rejected');
    if (chatId && messageId) await editMessage(chatId, messageId, `❌ *Delete rejected*: ${spot.title}\n\nSpot is kept.`);
    return;
  }
  if (spot.source === 'automated' && spot.venue_id) {
    const venue = venues.getById(spot.venue_id);
    getDb().prepare(
      `INSERT INTO watchlist (venue_id, name, area, status, reason)
       VALUES (?, ?, ?, 'excluded', ?)
       ON CONFLICT(venue_id) DO UPDATE SET
         name = excluded.name, area = excluded.area,
         status = excluded.status, reason = excluded.reason,
         updated_at = datetime('now')`
    ).run(spot.venue_id, spot.title, venue?.area || 'Unknown', `Deleted via user request (spot #${spotId})`);
  }
  spots.delete(spotId);
  await answerCallbackQuery(cq.id, `Deleted: ${spot.title}`);
  const venueNote = (spot.source === 'automated' && spot.venue_id) ? `\nVenue added to watchlist.` : '';
  if (chatId && messageId) await editMessage(chatId, messageId, `🗑 *Deleted*: ${spot.title}${venueNote}`);
  console.log(`[Telegram] 🗑 Deleted: ${spot.title} (ID: ${spotId})`);
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
