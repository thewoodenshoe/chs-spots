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
import { reportingPath, configPath } from './data-dir';

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

async function handleCallback(callbackQuery: any, _token: string): Promise<void> {
  const data = callbackQuery.data as string;
  const chatId = callbackQuery.message?.chat?.id;
  const messageId = callbackQuery.message?.message_id;

  // --- Spot approve/deny ---
  const spotMatch = data.match(/^(approve|deny)_(\d+)$/);
  if (spotMatch) {
    return handleSpotAction(spotMatch[1], parseInt(spotMatch[2], 10), callbackQuery, chatId, messageId);
  }

  // --- Activity suggestion ---
  const actMatch = data.match(/^(actadd|actdeny)_(.+)$/);
  if (actMatch) {
    return handleActivityAction(actMatch[1], actMatch[2], callbackQuery, chatId, messageId);
  }

  // --- Spot report ---
  const rptMatch = data.match(/^(rptexcl|rptkeep)_(\d+)$/);
  if (rptMatch) {
    return handleReportAction(rptMatch[1], parseInt(rptMatch[2], 10), callbackQuery, chatId, messageId);
  }

  // --- Edit approval ---
  const edtMatch = data.match(/^(edtappr|edtdeny)_(\d+)$/);
  if (edtMatch) {
    return handleEditAction(edtMatch[1], parseInt(edtMatch[2], 10), callbackQuery, chatId, messageId);
  }

  // --- Delete approval ---
  const delMatch = data.match(/^(delappr|deldeny)_(\d+)$/);
  if (delMatch) {
    return handleDeleteAction(delMatch[1], parseInt(delMatch[2], 10), callbackQuery, chatId, messageId);
  }

  await answerCallbackQuery(callbackQuery.id, 'Unknown action');
}

function readSpots(): { spots: any[]; path: string } {
  const spotsPath = reportingPath('spots.json');
  let spots: any[] = [];
  if (fs.existsSync(spotsPath)) {
    try { spots = JSON.parse(fs.readFileSync(spotsPath, 'utf8')); if (!Array.isArray(spots)) spots = []; }
    catch { spots = []; }
  }
  return { spots, path: spotsPath };
}

async function handleSpotAction(action: string, spotId: number, cq: any, chatId: any, messageId: any) {
  const { spots, path } = readSpots();
  const idx = spots.findIndex((s: any) => s.id == spotId);
  if (idx === -1) {
    await answerCallbackQuery(cq.id, 'Spot not found');
    if (chatId && messageId) await editMessage(chatId, messageId, `❓ Spot #${spotId} not found.`);
    return;
  }
  const spot = spots[idx];
  spots[idx] = { ...spot, status: action === 'approve' ? 'approved' : 'denied' };
  atomicWriteFileSync(path, JSON.stringify(spots, null, 2));
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
  const activitiesPath = configPath('activities.json');
  let activities: any[] = [];
  if (fs.existsSync(activitiesPath)) {
    try { activities = JSON.parse(fs.readFileSync(activitiesPath, 'utf8')); if (!Array.isArray(activities)) activities = []; } catch { activities = []; }
  }
  if (activities.some((a: any) => a.name.toLowerCase() === activityName.toLowerCase())) {
    await answerCallbackQuery(cq.id, 'Already exists');
    if (chatId && messageId) await editMessage(chatId, messageId, `⚠️ Activity "${activityName}" already exists.`);
    return;
  }
  activities.push({ name: activityName, icon: 'Star', emoji: '⭐', color: '#6366f1' });
  atomicWriteFileSync(activitiesPath, JSON.stringify(activities, null, 2));
  await answerCallbackQuery(cq.id, `Added: ${activityName}`);
  if (chatId && messageId) await editMessage(chatId, messageId, `✅ *Added activity*: ${activityName}\n\nIt is now available in the filter menu.`);
}

async function handleReportAction(action: string, spotId: number, cq: any, chatId: any, messageId: any) {
  const { spots, path } = readSpots();
  const idx = spots.findIndex((s: any) => s.id == spotId);
  if (idx === -1) {
    await answerCallbackQuery(cq.id, 'Spot not found');
    if (chatId && messageId) await editMessage(chatId, messageId, `❓ Spot #${spotId} not found.`);
    return;
  }
  const spot = spots[idx];
  if (action === 'rptkeep') {
    await answerCallbackQuery(cq.id, 'Kept');
    if (chatId && messageId) await editMessage(chatId, messageId, `✅ *Kept*: ${spot.title}\n\nReport dismissed.`);
    return;
  }
  if (spot.venueId) {
    const watchlistPath = configPath('venue-watchlist.json');
    let watchlist: any = { updatedAt: '', venues: {} };
    if (fs.existsSync(watchlistPath)) { try { watchlist = JSON.parse(fs.readFileSync(watchlistPath, 'utf8')); } catch { /* use default */ } }
    watchlist.updatedAt = new Date().toISOString().split('T')[0];
    watchlist.venues[spot.venueId] = { name: spot.title, area: spot.area || 'Unknown', status: 'excluded', reason: `Excluded via user report (spot #${spotId})` };
    atomicWriteFileSync(watchlistPath, JSON.stringify(watchlist, null, 2));
  }
  spots.splice(idx, 1);
  atomicWriteFileSync(path, JSON.stringify(spots, null, 2));
  await answerCallbackQuery(cq.id, `Excluded: ${spot.title}`);
  const venueNote = spot.venueId ? `\nVenue \`${spot.venueId}\` added to watchlist.` : '';
  if (chatId && messageId) await editMessage(chatId, messageId, `🚫 *Excluded*: ${spot.title}${venueNote}`);
}

async function handleEditAction(action: string, spotId: number, cq: any, chatId: any, messageId: any) {
  const { spots, path } = readSpots();
  const idx = spots.findIndex((s: any) => s.id == spotId);
  if (idx === -1) {
    await answerCallbackQuery(cq.id, 'Spot not found');
    if (chatId && messageId) await editMessage(chatId, messageId, `❓ Spot #${spotId} not found.`);
    return;
  }
  const spot = spots[idx];
  if (action === 'edtdeny') {
    const { pendingEdit: _, ...clean } = spot;
    spots[idx] = clean;
    atomicWriteFileSync(path, JSON.stringify(spots, null, 2));
    await answerCallbackQuery(cq.id, 'Edit rejected');
    if (chatId && messageId) await editMessage(chatId, messageId, `❌ *Edit rejected* for: ${spot.title}`);
    return;
  }
  if (!spot.pendingEdit) {
    await answerCallbackQuery(cq.id, 'No pending edit');
    if (chatId && messageId) await editMessage(chatId, messageId, `⚠️ No pending edit found for ${spot.title}.`);
    return;
  }
  const edit = spot.pendingEdit;
  const { pendingEdit: _, ...base } = spot;
  const updated = {
    ...base,
    title: edit.title, description: edit.description,
    lat: edit.lat, lng: edit.lng, type: edit.type, activity: edit.type,
    photoUrl: edit.photoUrl !== undefined ? edit.photoUrl : base.photoUrl,
    area: edit.area !== undefined ? edit.area : base.area,
    editedAt: new Date().toISOString(),
    ...(base.source === 'automated' ? { manualOverride: true } : {}),
  };
  spots[idx] = updated;
  atomicWriteFileSync(path, JSON.stringify(spots, null, 2));
  await answerCallbackQuery(cq.id, `Approved: ${updated.title}`);
  if (chatId && messageId) await editMessage(chatId, messageId, `✅ *Edit approved*: ${updated.title}\n\nChanges are now live.`);
  console.log(`[Telegram] ✏️ Edit approved: ${updated.title} (ID: ${spotId})`);
}

async function handleDeleteAction(action: string, spotId: number, cq: any, chatId: any, messageId: any) {
  const { spots, path } = readSpots();
  const idx = spots.findIndex((s: any) => s.id == spotId);
  if (idx === -1) {
    await answerCallbackQuery(cq.id, 'Spot not found');
    if (chatId && messageId) await editMessage(chatId, messageId, `❓ Spot #${spotId} not found.`);
    return;
  }
  const spot = spots[idx];
  if (action === 'deldeny') {
    const { pendingDelete: _, ...clean } = spot;
    spots[idx] = clean;
    atomicWriteFileSync(path, JSON.stringify(spots, null, 2));
    await answerCallbackQuery(cq.id, 'Delete rejected');
    if (chatId && messageId) await editMessage(chatId, messageId, `❌ *Delete rejected*: ${spot.title}\n\nSpot is kept.`);
    return;
  }
  if (spot.source === 'automated' && spot.venueId) {
    const watchlistPath = configPath('venue-watchlist.json');
    let watchlist: any = { updatedAt: '', venues: {} };
    if (fs.existsSync(watchlistPath)) { try { watchlist = JSON.parse(fs.readFileSync(watchlistPath, 'utf8')); } catch { /* use default */ } }
    watchlist.updatedAt = new Date().toISOString().split('T')[0];
    watchlist.venues[spot.venueId] = { name: spot.title, area: spot.area || 'Unknown', status: 'excluded', reason: `Deleted via user request (spot #${spotId})` };
    atomicWriteFileSync(watchlistPath, JSON.stringify(watchlist, null, 2));
  }
  spots.splice(idx, 1);
  atomicWriteFileSync(path, JSON.stringify(spots, null, 2));
  await answerCallbackQuery(cq.id, `Deleted: ${spot.title}`);
  const venueNote = (spot.source === 'automated' && spot.venueId) ? `\nVenue added to watchlist.` : '';
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
