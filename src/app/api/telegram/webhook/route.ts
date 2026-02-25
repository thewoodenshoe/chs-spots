/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { answerCallbackQuery, editMessage } from '@/lib/telegram';
import { spots, activitiesDb, venues, getDb } from '@/lib/db';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

/**
 * Telegram Bot Webhook
 * 
 * Handles callback queries from inline keyboard buttons (Approve/Deny).
 * Updates spot status in the SQLite database and edits the Telegram message.
 * 
 * To set up the webhook, run:
 *   curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://your-domain/api/telegram/webhook"
 * 
 * For local development, use polling mode instead (see /api/telegram/poll).
 */
export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!checkRateLimit(`tg-webhook:${ip}`, 60, 60_000)) {
    return NextResponse.json({ ok: true }, { status: 429 });
  }

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
    
    if (update.callback_query) {
      const callbackQuery = update.callback_query;
      const data = callbackQuery.data as string;
      const chatId = callbackQuery.message?.chat?.id;
      const messageId = callbackQuery.message?.message_id;

      const spotMatch = data.match(/^(approve|deny)_(\d+)$/);
      if (spotMatch) {
        return handleSpotCallback(spotMatch[1], parseInt(spotMatch[2], 10), callbackQuery, chatId, messageId);
      }

      const actMatch = data.match(/^(actadd|actdeny)_(.+)$/);
      if (actMatch) {
        return handleActivityCallback(actMatch[1], actMatch[2], callbackQuery, chatId, messageId);
      }

      const rptMatch = data.match(/^(rptexcl|rptkeep)_(\d+)$/);
      if (rptMatch) {
        return handleReportCallback(rptMatch[1], parseInt(rptMatch[2], 10), callbackQuery, chatId, messageId);
      }

      const edtMatch = data.match(/^(edtappr|edtdeny)_(\d+)$/);
      if (edtMatch) {
        return handleEditApprovalCallback(edtMatch[1], parseInt(edtMatch[2], 10), callbackQuery, chatId, messageId);
      }

      const delMatch = data.match(/^(delappr|deldeny)_(\d+)$/);
      if (delMatch) {
        return handleDeleteApprovalCallback(delMatch[1], parseInt(delMatch[2], 10), callbackQuery, chatId, messageId);
      }

      await answerCallbackQuery(callbackQuery.id, 'Unknown action');
      return NextResponse.json({ ok: true });
    }
    
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
    return NextResponse.json({ ok: true });
  }
}

function upsertWatchlist(venueId: string, name: string, area: string, reason: string) {
  getDb().prepare(`
    INSERT INTO watchlist (venue_id, name, area, status, reason, updated_at)
    VALUES (?, ?, ?, 'excluded', ?, datetime('now'))
    ON CONFLICT(venue_id) DO UPDATE SET
      name = excluded.name, area = excluded.area, status = excluded.status,
      reason = excluded.reason, updated_at = datetime('now')
  `).run(venueId, name, area, reason);
}

function lookupArea(venueId: string | null): string {
  if (!venueId) return 'Unknown';
  const venue = venues.getById(venueId);
  return venue?.area || 'Unknown';
}

// --- Handler: spot approve/deny ---
async function handleSpotCallback(action: string, spotId: number, callbackQuery: any, chatId: any, messageId: any) {
  const spot = spots.getById(spotId);
  if (!spot) {
    await answerCallbackQuery(callbackQuery.id, 'Spot not found');
    if (chatId && messageId) await editMessage(chatId, messageId, `❓ Spot #${spotId} not found.`);
    return NextResponse.json({ ok: true });
  }

  if (action === 'approve') {
    spots.update(spotId, { status: 'approved' });
    await answerCallbackQuery(callbackQuery.id, `Approved: ${spot.title}`);
    if (chatId && messageId) await editMessage(chatId, messageId, `✅ *Approved*: ${spot.title}\n\nSpot is now visible on the map.`);
  } else {
    spots.update(spotId, { status: 'denied' });
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

  const existing = activitiesDb.getAll();
  if (existing.some(a => a.name.toLowerCase() === activityName.toLowerCase())) {
    await answerCallbackQuery(callbackQuery.id, 'Already exists');
    if (chatId && messageId) await editMessage(chatId, messageId, `⚠️ Activity "${activityName}" already exists.`);
    return NextResponse.json({ ok: true });
  }

  getDb().prepare(
    `INSERT INTO activities (name, icon, emoji, color, community_driven) VALUES (?, ?, ?, ?, ?)`
  ).run(activityName, 'Star', '⭐', '#6366f1', 0);

  await answerCallbackQuery(callbackQuery.id, `Added: ${activityName}`);
  if (chatId && messageId) await editMessage(chatId, messageId, `✅ *Added activity*: ${activityName}\n\nIt is now available in the filter menu.`);
  return NextResponse.json({ ok: true });
}

// --- Handler: spot report exclude/keep ---
async function handleReportCallback(action: string, spotId: number, callbackQuery: any, chatId: any, messageId: any) {
  const spot = spots.getById(spotId);
  if (!spot) {
    await answerCallbackQuery(callbackQuery.id, 'Spot not found');
    if (chatId && messageId) await editMessage(chatId, messageId, `❓ Spot #${spotId} not found.`);
    return NextResponse.json({ ok: true });
  }

  if (action === 'rptkeep') {
    await answerCallbackQuery(callbackQuery.id, 'Kept');
    if (chatId && messageId) await editMessage(chatId, messageId, `✅ *Kept*: ${spot.title}\n\nReport dismissed.`);
    return NextResponse.json({ ok: true });
  }

  if (spot.venue_id) {
    const area = lookupArea(spot.venue_id);
    upsertWatchlist(spot.venue_id, spot.title, area, `Excluded via user report (spot #${spotId})`);
  }

  spots.delete(spotId);

  await answerCallbackQuery(callbackQuery.id, `Excluded: ${spot.title}`);
  if (chatId && messageId) {
    const venueNote = spot.venue_id ? `\nVenue \`${spot.venue_id}\` added to watchlist.` : '';
    await editMessage(chatId, messageId, `🚫 *Excluded*: ${spot.title}${venueNote}`);
  }
  return NextResponse.json({ ok: true });
}

// --- Handler: edit approval ---
async function handleEditApprovalCallback(action: string, spotId: number, callbackQuery: any, chatId: any, messageId: any) {
  const spot = spots.getById(spotId);
  if (!spot) {
    await answerCallbackQuery(callbackQuery.id, 'Spot not found');
    if (chatId && messageId) await editMessage(chatId, messageId, `❓ Spot #${spotId} not found.`);
    return NextResponse.json({ ok: true });
  }

  if (action === 'edtdeny') {
    spots.update(spotId, { pending_edit: null });
    await answerCallbackQuery(callbackQuery.id, 'Edit rejected');
    if (chatId && messageId) await editMessage(chatId, messageId, `❌ *Edit rejected* for: ${spot.title}`);
    return NextResponse.json({ ok: true });
  }

  if (!spot.pending_edit) {
    await answerCallbackQuery(callbackQuery.id, 'No pending edit');
    if (chatId && messageId) await editMessage(chatId, messageId, `⚠️ No pending edit found for ${spot.title}.`);
    return NextResponse.json({ ok: true });
  }

  const edit = JSON.parse(spot.pending_edit);
  const updates: Record<string, any> = {
    title: edit.title,
    description: edit.description,
    type: edit.type,
    edited_at: new Date().toISOString(),
    pending_edit: null,
  };
  if (edit.photoUrl !== undefined) updates.photo_url = edit.photoUrl;
  if (spot.source === 'automated') updates.manual_override = 1;

  spots.update(spotId, updates);

  const newTitle = edit.title || spot.title;
  await answerCallbackQuery(callbackQuery.id, `Approved: ${newTitle}`);
  if (chatId && messageId) await editMessage(chatId, messageId, `✅ *Edit approved*: ${newTitle}\n\nChanges are now live.`);
  return NextResponse.json({ ok: true });
}

// --- Handler: delete approval ---
async function handleDeleteApprovalCallback(action: string, spotId: number, callbackQuery: any, chatId: any, messageId: any) {
  const spot = spots.getById(spotId);
  if (!spot) {
    await answerCallbackQuery(callbackQuery.id, 'Spot not found');
    if (chatId && messageId) await editMessage(chatId, messageId, `❓ Spot #${spotId} not found.`);
    return NextResponse.json({ ok: true });
  }

  if (action === 'deldeny') {
    spots.update(spotId, { pending_delete: 0 });
    await answerCallbackQuery(callbackQuery.id, 'Delete rejected');
    if (chatId && messageId) await editMessage(chatId, messageId, `❌ *Delete rejected*: ${spot.title}\n\nSpot is kept.`);
    return NextResponse.json({ ok: true });
  }

  if (spot.source === 'automated' && spot.venue_id) {
    const area = lookupArea(spot.venue_id);
    upsertWatchlist(spot.venue_id, spot.title, area, `Deleted via user request (spot #${spotId})`);
  }

  spots.delete(spotId);

  await answerCallbackQuery(callbackQuery.id, `Deleted: ${spot.title}`);
  const venueNote = (spot.source === 'automated' && spot.venue_id) ? `\nVenue added to watchlist.` : '';
  if (chatId && messageId) await editMessage(chatId, messageId, `🗑 *Deleted*: ${spot.title}${venueNote}`);
  return NextResponse.json({ ok: true });
}

// GET endpoint for webhook verification
export async function GET() {
  return NextResponse.json({ status: 'Telegram webhook is active' });
}
