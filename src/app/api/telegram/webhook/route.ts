/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import fs from 'fs';
import { answerCallbackQuery, editMessage } from '@/lib/telegram';
import { atomicWriteFileSync } from '@/lib/atomic-write';
import { reportingPath, configPath } from '@/lib/data-dir';

/**
 * Telegram Bot Webhook
 * 
 * Handles callback queries from inline keyboard buttons (Approve/Deny).
 * Updates the spot status in spots.json and edits the Telegram message.
 * 
 * To set up the webhook, run:
 *   curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://your-domain/api/telegram/webhook"
 * 
 * For local development, use polling mode instead (see /api/telegram/poll).
 */
export async function POST(request: Request) {
  // Verify the request came from Telegram using the secret_token
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (webhookSecret) {
    const headerSecret = request.headers.get('x-telegram-bot-api-secret-token');
    if (headerSecret !== webhookSecret) {
      console.warn('[Telegram] Webhook request with invalid/missing secret token');
      return NextResponse.json({ ok: false }, { status: 403 });
    }
  }

  try {
    const update = await request.json();
    
    // Handle callback query (inline keyboard button press)
    if (update.callback_query) {
      const callbackQuery = update.callback_query;
      const data = callbackQuery.data as string;
      const chatId = callbackQuery.message?.chat?.id;
      const messageId = callbackQuery.message?.message_id;

      // --- Spot approve/deny: "approve_123" or "deny_123" ---
      const spotMatch = data.match(/^(approve|deny)_(\d+)$/);
      if (spotMatch) {
        return handleSpotCallback(spotMatch[1], parseInt(spotMatch[2], 10), callbackQuery, chatId, messageId);
      }

      // --- Activity suggestion: "actadd_Name" or "actdeny_Name" ---
      const actMatch = data.match(/^(actadd|actdeny)_(.+)$/);
      if (actMatch) {
        return handleActivityCallback(actMatch[1], actMatch[2], callbackQuery, chatId, messageId);
      }

      // --- Spot report: "rptexcl_123" or "rptkeep_123" ---
      const rptMatch = data.match(/^(rptexcl|rptkeep)_(\d+)$/);
      if (rptMatch) {
        return handleReportCallback(rptMatch[1], parseInt(rptMatch[2], 10), callbackQuery, chatId, messageId);
      }

      // --- Edit approval: "edtappr_123" or "edtdeny_123" ---
      const edtMatch = data.match(/^(edtappr|edtdeny)_(\d+)$/);
      if (edtMatch) {
        return handleEditApprovalCallback(edtMatch[1], parseInt(edtMatch[2], 10), callbackQuery, chatId, messageId);
      }

      // --- Delete approval: "delappr_123" or "deldeny_123" ---
      const delMatch = data.match(/^(delappr|deldeny)_(\d+)$/);
      if (delMatch) {
        return handleDeleteApprovalCallback(delMatch[1], parseInt(delMatch[2], 10), callbackQuery, chatId, messageId);
      }

      await answerCallbackQuery(callbackQuery.id, 'Unknown action');
      return NextResponse.json({ ok: true });
    }
    
    // Handle regular messages (e.g., /start command)
    if (update.message?.text === '/start') {
      const chatId = update.message.chat.id;
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
    }
    
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Telegram webhook error:', error);
    return NextResponse.json({ ok: true }); // Always return 200 to Telegram
  }
}

// --- Handler: spot approve/deny ---
async function handleSpotCallback(action: string, spotId: number, callbackQuery: any, chatId: any, messageId: any) {
  const spotsPath = reportingPath('spots.json');
  let spots: any[] = [];
  if (fs.existsSync(spotsPath)) {
    try { spots = JSON.parse(fs.readFileSync(spotsPath, 'utf8')); if (!Array.isArray(spots)) spots = []; } catch { spots = []; }
  }

  const spotIndex = spots.findIndex((s: any) => s.id === spotId);
  if (spotIndex === -1) {
    await answerCallbackQuery(callbackQuery.id, 'Spot not found');
    if (chatId && messageId) await editMessage(chatId, messageId, `❓ Spot #${spotId} not found.`);
    return NextResponse.json({ ok: true });
  }

  const spot = spots[spotIndex];
  if (action === 'approve') {
    spots[spotIndex] = { ...spot, status: 'approved' };
    atomicWriteFileSync(spotsPath, JSON.stringify(spots, null, 2));
    await answerCallbackQuery(callbackQuery.id, `Approved: ${spot.title}`);
    if (chatId && messageId) await editMessage(chatId, messageId, `✅ *Approved*: ${spot.title}\n\nSpot is now visible on the map.`);
  } else {
    spots[spotIndex] = { ...spot, status: 'denied' };
    atomicWriteFileSync(spotsPath, JSON.stringify(spots, null, 2));
    await answerCallbackQuery(callbackQuery.id, `Denied: ${spot.title}`);
    if (chatId && messageId) await editMessage(chatId, messageId, `❌ *Denied*: ${spot.title}\n\nSpot has been rejected.`);
  }
  return NextResponse.json({ ok: true });
}

// --- Handler: activity suggestion approve/deny ---
async function handleActivityCallback(action: string, callbackId: string, callbackQuery: any, chatId: any, messageId: any) {
  const activityName = callbackId.replace(/_/g, ' ');

  if (action === 'actdeny') {
    await answerCallbackQuery(callbackQuery.id, 'Dismissed');
    if (chatId && messageId) await editMessage(chatId, messageId, `❌ *Dismissed* activity suggestion: ${activityName}`);
    return NextResponse.json({ ok: true });
  }

  // Approve: add to activities.json
  const activitiesPath = configPath('activities.json');
  let activities: any[] = [];
  if (fs.existsSync(activitiesPath)) {
    try { activities = JSON.parse(fs.readFileSync(activitiesPath, 'utf8')); if (!Array.isArray(activities)) activities = []; } catch { activities = []; }
  }

  // Avoid duplicates
  if (activities.some((a: any) => a.name.toLowerCase() === activityName.toLowerCase())) {
    await answerCallbackQuery(callbackQuery.id, 'Already exists');
    if (chatId && messageId) await editMessage(chatId, messageId, `⚠️ Activity "${activityName}" already exists.`);
    return NextResponse.json({ ok: true });
  }

  activities.push({
    name: activityName,
    icon: 'Star',
    emoji: '⭐',
    color: '#6366f1',
  });
  atomicWriteFileSync(activitiesPath, JSON.stringify(activities, null, 2));

  await answerCallbackQuery(callbackQuery.id, `Added: ${activityName}`);
  if (chatId && messageId) await editMessage(chatId, messageId, `✅ *Added activity*: ${activityName}\n\nIt is now available in the filter menu.`);
  return NextResponse.json({ ok: true });
}

// --- Handler: spot report exclude/keep ---
async function handleReportCallback(action: string, spotId: number, callbackQuery: any, chatId: any, messageId: any) {
  const spotsPath = reportingPath('spots.json');
  let spots: any[] = [];
  if (fs.existsSync(spotsPath)) {
    try { spots = JSON.parse(fs.readFileSync(spotsPath, 'utf8')); if (!Array.isArray(spots)) spots = []; } catch { spots = []; }
  }

  const spotIndex = spots.findIndex((s: any) => s.id === spotId);
  if (spotIndex === -1) {
    await answerCallbackQuery(callbackQuery.id, 'Spot not found');
    if (chatId && messageId) await editMessage(chatId, messageId, `❓ Spot #${spotId} not found.`);
    return NextResponse.json({ ok: true });
  }

  const spot = spots[spotIndex];

  if (action === 'rptkeep') {
    await answerCallbackQuery(callbackQuery.id, 'Kept');
    if (chatId && messageId) await editMessage(chatId, messageId, `✅ *Kept*: ${spot.title}\n\nReport dismissed.`);
    return NextResponse.json({ ok: true });
  }

  // Exclude: add venueId to watchlist and remove the spot
  if (spot.venueId) {
    const watchlistPath = configPath('venue-watchlist.json');
    let watchlist: any = { updatedAt: '', venues: {} };
    if (fs.existsSync(watchlistPath)) {
      try { watchlist = JSON.parse(fs.readFileSync(watchlistPath, 'utf8')); } catch { /* use default */ }
    }
    watchlist.updatedAt = new Date().toISOString().split('T')[0];
    watchlist.venues[spot.venueId] = {
      name: spot.title,
      area: spot.area || 'Unknown',
      status: 'excluded',
      reason: `Excluded via user report (spot #${spotId})`,
    };
    atomicWriteFileSync(watchlistPath, JSON.stringify(watchlist, null, 2));
  }

  // Remove the spot
  spots.splice(spotIndex, 1);
  atomicWriteFileSync(spotsPath, JSON.stringify(spots, null, 2));

  await answerCallbackQuery(callbackQuery.id, `Excluded: ${spot.title}`);
  if (chatId && messageId) {
    const venueNote = spot.venueId ? `\nVenue \`${spot.venueId}\` added to watchlist.` : '';
    await editMessage(chatId, messageId, `🚫 *Excluded*: ${spot.title}${venueNote}`);
  }
  return NextResponse.json({ ok: true });
}

// --- Handler: edit approval ---
async function handleEditApprovalCallback(action: string, spotId: number, callbackQuery: any, chatId: any, messageId: any) {
  const spotsPath = reportingPath('spots.json');
  let spots: any[] = [];
  if (fs.existsSync(spotsPath)) {
    try { spots = JSON.parse(fs.readFileSync(spotsPath, 'utf8')); if (!Array.isArray(spots)) spots = []; } catch { spots = []; }
  }

  const spotIndex = spots.findIndex((s: any) => s.id === spotId);
  if (spotIndex === -1) {
    await answerCallbackQuery(callbackQuery.id, 'Spot not found');
    if (chatId && messageId) await editMessage(chatId, messageId, `❓ Spot #${spotId} not found.`);
    return NextResponse.json({ ok: true });
  }

  const spot = spots[spotIndex];

  if (action === 'edtdeny') {
    // Reject: clear the pending edit
    const { pendingEdit: _removed, ...clean } = spot;
    spots[spotIndex] = clean;
    atomicWriteFileSync(spotsPath, JSON.stringify(spots, null, 2));
    await answerCallbackQuery(callbackQuery.id, 'Edit rejected');
    if (chatId && messageId) await editMessage(chatId, messageId, `❌ *Edit rejected* for: ${spot.title}`);
    return NextResponse.json({ ok: true });
  }

  // Approve: apply the pending edit
  if (!spot.pendingEdit) {
    await answerCallbackQuery(callbackQuery.id, 'No pending edit');
    if (chatId && messageId) await editMessage(chatId, messageId, `⚠️ No pending edit found for ${spot.title}.`);
    return NextResponse.json({ ok: true });
  }

  const edit = spot.pendingEdit;
  const { pendingEdit: _removed, ...base } = spot;
  const updated = {
    ...base,
    title: edit.title,
    description: edit.description,
    lat: edit.lat,
    lng: edit.lng,
    type: edit.type,
    activity: edit.type,
    photoUrl: edit.photoUrl !== undefined ? edit.photoUrl : base.photoUrl,
    area: edit.area !== undefined ? edit.area : base.area,
    editedAt: new Date().toISOString(),
    ...(base.source === 'automated' ? { manualOverride: true } : {}),
  };
  spots[spotIndex] = updated;
  atomicWriteFileSync(spotsPath, JSON.stringify(spots, null, 2));

  await answerCallbackQuery(callbackQuery.id, `Approved: ${updated.title}`);
  if (chatId && messageId) await editMessage(chatId, messageId, `✅ *Edit approved*: ${updated.title}\n\nChanges are now live.`);
  return NextResponse.json({ ok: true });
}

// --- Handler: delete approval ---
async function handleDeleteApprovalCallback(action: string, spotId: number, callbackQuery: any, chatId: any, messageId: any) {
  const spotsPath = reportingPath('spots.json');
  let spots: any[] = [];
  if (fs.existsSync(spotsPath)) {
    try { spots = JSON.parse(fs.readFileSync(spotsPath, 'utf8')); if (!Array.isArray(spots)) spots = []; } catch { spots = []; }
  }

  const spotIndex = spots.findIndex((s: any) => s.id === spotId);
  if (spotIndex === -1) {
    await answerCallbackQuery(callbackQuery.id, 'Spot not found');
    if (chatId && messageId) await editMessage(chatId, messageId, `❓ Spot #${spotId} not found.`);
    return NextResponse.json({ ok: true });
  }

  const spot = spots[spotIndex];

  if (action === 'deldeny') {
    // Reject: clear pendingDelete flag
    const { pendingDelete: _removed, ...clean } = spot;
    spots[spotIndex] = clean;
    atomicWriteFileSync(spotsPath, JSON.stringify(spots, null, 2));
    await answerCallbackQuery(callbackQuery.id, 'Delete rejected');
    if (chatId && messageId) await editMessage(chatId, messageId, `❌ *Delete rejected*: ${spot.title}\n\nSpot is kept.`);
    return NextResponse.json({ ok: true });
  }

  // Approve: delete the spot; if automated, add to watchlist
  if (spot.source === 'automated' && spot.venueId) {
    const watchlistPath = configPath('venue-watchlist.json');
    let watchlist: any = { updatedAt: '', venues: {} };
    if (fs.existsSync(watchlistPath)) {
      try { watchlist = JSON.parse(fs.readFileSync(watchlistPath, 'utf8')); } catch { /* use default */ }
    }
    watchlist.updatedAt = new Date().toISOString().split('T')[0];
    watchlist.venues[spot.venueId] = {
      name: spot.title,
      area: spot.area || 'Unknown',
      status: 'excluded',
      reason: `Deleted via user request (spot #${spotId})`,
    };
    atomicWriteFileSync(watchlistPath, JSON.stringify(watchlist, null, 2));
  }

  spots.splice(spotIndex, 1);
  atomicWriteFileSync(spotsPath, JSON.stringify(spots, null, 2));

  await answerCallbackQuery(callbackQuery.id, `Deleted: ${spot.title}`);
  const venueNote = (spot.source === 'automated' && spot.venueId) ? `\nVenue added to watchlist.` : '';
  if (chatId && messageId) await editMessage(chatId, messageId, `🗑 *Deleted*: ${spot.title}${venueNote}`);
  return NextResponse.json({ ok: true });
}

// GET endpoint for webhook verification
export async function GET() {
  return NextResponse.json({ status: 'Telegram webhook is active' });
}
