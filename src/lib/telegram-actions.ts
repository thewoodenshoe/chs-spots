/* eslint-disable @typescript-eslint/no-explicit-any */
import { answerCallbackQuery, editMessage } from './telegram';
import { spots, activitiesDb, venues, ideas, getDb } from './db';
import { invalidate } from './cache';

function upsertWatchlist(venueId: string, name: string, area: string, reason: string) {
  getDb().prepare(`
    INSERT INTO watchlist (venue_id, name, area, status, reason, updated_at)
    VALUES (?, ?, ?, 'excluded', ?, datetime('now'))
    ON CONFLICT(venue_id) DO UPDATE SET
      name = excluded.name, area = excluded.area, status = excluded.status,
      reason = excluded.reason, updated_at = datetime('now')
  `).run(venueId, name, area, reason);
}

function clearConfidenceReviews(venueId: string) {
  getDb().prepare('DELETE FROM confidence_reviews WHERE venue_id = ?').run(venueId);
}

function lookupArea(venueId: string | null): string {
  if (!venueId) return 'Unknown';
  const venue = venues.getById(venueId);
  return venue?.area || 'Unknown';
}

export async function handleSpotAction(action: string, spotId: number, cq: any, chatId: any, messageId: any): Promise<void> {
  const spot = spots.getById(spotId);
  if (!spot) {
    await answerCallbackQuery(cq.id, 'Spot not found');
    if (chatId && messageId) await editMessage(chatId, messageId, `❓ Spot #${spotId} not found.`);
    return;
  }
  const newStatus = action === 'approve' ? 'approved' : 'denied';
  spots.update(spotId, { status: newStatus });
  invalidate('api:spots');
  if (action === 'approve') {
    await answerCallbackQuery(cq.id, `Approved: ${spot.title}`);
    if (chatId && messageId) await editMessage(chatId, messageId, `✅ *Approved*: ${spot.title}\n\nSpot is now visible on the map.`);
  } else {
    await answerCallbackQuery(cq.id, `Denied: ${spot.title}`);
    if (chatId && messageId) await editMessage(chatId, messageId, `❌ *Denied*: ${spot.title}\n\nSpot has been rejected.`);
  }
}

export async function handleActivityAction(action: string, callbackId: string, cq: any, chatId: any, messageId: any): Promise<void> {
  const activityName = callbackId.replace(/_/g, ' ');
  if (action === 'actdeny') {
    await answerCallbackQuery(cq.id, 'Dismissed');
    if (chatId && messageId) await editMessage(chatId, messageId, `❌ *Dismissed* activity suggestion: ${activityName}`);
    return;
  }
  const existing = activitiesDb.getAll();
  if (existing.some(a => a.name.toLowerCase() === activityName.toLowerCase())) {
    await answerCallbackQuery(cq.id, 'Already exists');
    if (chatId && messageId) await editMessage(chatId, messageId, `⚠️ Activity "${activityName}" already exists.`);
    return;
  }
  getDb().prepare(
    `INSERT INTO activities (name, icon, emoji, color, community_driven) VALUES (?, ?, ?, ?, ?)`
  ).run(activityName, 'Star', '⭐', '#6366f1', 0);
  await answerCallbackQuery(cq.id, `Added: ${activityName}`);
  if (chatId && messageId) await editMessage(chatId, messageId, `✅ *Added activity*: ${activityName}\n\nIt is now available in the filter menu.`);
}

export async function handleReportAction(action: string, spotId: number, cq: any, chatId: any, messageId: any): Promise<void> {
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
    const area = lookupArea(spot.venue_id);
    upsertWatchlist(spot.venue_id, spot.title, area, `Excluded via user report (spot #${spotId})`);
    clearConfidenceReviews(spot.venue_id);
  }
  spots.delete(spotId);
  invalidate('api:spots');
  await answerCallbackQuery(cq.id, `Excluded: ${spot.title}`);
  if (chatId && messageId) {
    const venueNote = spot.venue_id ? `\nVenue \`${spot.venue_id}\` added to watchlist.` : '';
    await editMessage(chatId, messageId, `🚫 *Excluded*: ${spot.title}${venueNote}`);
  }
}

export async function handleEditAction(action: string, spotId: number, cq: any, chatId: any, messageId: any): Promise<void> {
  const spot = spots.getById(spotId);
  if (!spot) {
    await answerCallbackQuery(cq.id, 'Spot not found');
    if (chatId && messageId) await editMessage(chatId, messageId, `❓ Spot #${spotId} not found.`);
    return;
  }
  if (action === 'edtdeny') {
    spots.update(spotId, { pending_edit: null });
    await answerCallbackQuery(cq.id, 'Edit rejected');
    if (chatId && messageId) await editMessage(chatId, messageId, `❌ *Edit rejected* for: ${spot.title}`);
    return;
  }
  if (!spot.pending_edit) {
    await answerCallbackQuery(cq.id, 'No pending edit');
    if (chatId && messageId) await editMessage(chatId, messageId, `⚠️ No pending edit found for ${spot.title}.`);
    return;
  }
  let edit: any;
  try {
    edit = JSON.parse(spot.pending_edit);
  } catch {
    await answerCallbackQuery(cq.id, 'Corrupt edit data');
    if (chatId && messageId) await editMessage(chatId, messageId, `⚠️ Corrupt pending edit data for ${spot.title}.`);
    return;
  }
  const updates: Record<string, any> = {
    title: edit.title,
    description: edit.description,
    type: edit.type,
    edited_at: new Date().toISOString(),
    pending_edit: null,
  };
  if (edit.photoUrl !== undefined) updates.photo_url = edit.photoUrl;
  if (edit.lat != null) updates.lat = edit.lat;
  if (edit.lng != null) updates.lng = edit.lng;
  if (edit.area != null) updates.area = edit.area;
  if (spot.source === 'automated') updates.manual_override = 1;
  spots.update(spotId, updates);
  invalidate('api:spots');
  const newTitle = edit.title || spot.title;
  await answerCallbackQuery(cq.id, `Approved: ${newTitle}`);
  if (chatId && messageId) await editMessage(chatId, messageId, `✅ *Edit approved*: ${newTitle}\n\nChanges are now live.`);
}

export async function handleDeleteAction(action: string, spotId: number, cq: any, chatId: any, messageId: any): Promise<void> {
  const spot = spots.getById(spotId);
  if (!spot) {
    await answerCallbackQuery(cq.id, 'Spot not found');
    if (chatId && messageId) await editMessage(chatId, messageId, `❓ Spot #${spotId} not found.`);
    return;
  }
  if (action === 'deldeny') {
    spots.update(spotId, { pending_delete: 0 });
    await answerCallbackQuery(cq.id, 'Delete rejected');
    if (chatId && messageId) await editMessage(chatId, messageId, `❌ *Delete rejected*: ${spot.title}\n\nSpot is kept.`);
    return;
  }
  if (spot.source === 'automated' && spot.venue_id) {
    const area = lookupArea(spot.venue_id);
    upsertWatchlist(spot.venue_id, spot.title, area, `Deleted via user request (spot #${spotId})`);
    clearConfidenceReviews(spot.venue_id);
  }
  spots.delete(spotId);
  invalidate('api:spots');
  await answerCallbackQuery(cq.id, `Deleted: ${spot.title}`);
  const venueNote = (spot.source === 'automated' && spot.venue_id) ? `\nVenue added to watchlist.` : '';
  if (chatId && messageId) await editMessage(chatId, messageId, `🗑 *Deleted*: ${spot.title}${venueNote}`);
}

export async function handleTextCommand(text: string, chatId: string | number): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;

  const send = async (msg: string) => {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'Markdown' }),
    });
  };

  if (text === '/help' || text === '/start') {
    await send([
      `📖 *Charleston Finds — Bot Commands*`,
      ``,
      `/idea <text> — Save an idea to the backlog`,
      `/ideas — List all open ideas`,
      `/info <id> — Show full spot details`,
      `/delete <id> — Delete a spot (adds venue to watchlist)`,
      `/help — Show this message`,
    ].join('\n'));
    return true;
  }

  const deleteMatch = text.match(/^\/delete\s+(\d+)$/i);
  if (deleteMatch) {
    const spotId = parseInt(deleteMatch[1], 10);
    const spot = spots.getById(spotId);
    if (!spot) {
      await send(`❓ Spot #${spotId} not found.`);
      return true;
    }
    if (spot.source === 'automated' && spot.venue_id) {
      const area = lookupArea(spot.venue_id);
      upsertWatchlist(spot.venue_id, spot.title, area, `Deleted via /delete command (spot #${spotId})`);
      clearConfidenceReviews(spot.venue_id);
    }
    spots.delete(spotId);
    invalidate('api:spots');
    const venueNote = (spot.source === 'automated' && spot.venue_id) ? `\nVenue \`${spot.venue_id}\` added to watchlist.` : '';
    await send(`🗑 *Deleted*: ${spot.title} (ID: ${spotId})${venueNote}`);
    return true;
  }

  const ideaMatch = text.match(/^\/idea\s+([\s\S]+)$/i);
  if (ideaMatch) {
    const ideaText = ideaMatch[1].trim();
    if (!ideaText) {
      await send('Usage: `/idea your idea here`');
      return true;
    }
    const idea = ideas.add(ideaText);
    await send(`💡 *Idea #${idea.id} saved*\n\n${ideaText}`);
    return true;
  }

  if (text === '/ideas') {
    const open = ideas.getOpen();
    if (open.length === 0) {
      await send('📭 No open ideas. Use `/idea your text` to add one.');
      return true;
    }
    const lines = open.map((i) => {
      const date = new Date(i.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `#${i.id} — ${i.text} _(${date})_`;
    });
    await send(`💡 *Open Ideas (${open.length})*\n\n${lines.join('\n\n')}`);
    return true;
  }

  const infoMatch = text.match(/^\/info\s+(\d+)$/i);
  if (infoMatch) {
    const spotId = parseInt(infoMatch[1], 10);
    const spot = spots.getById(spotId);
    if (!spot) {
      await send(`❓ Spot #${spotId} not found.`);
      return true;
    }
    const mapLink = `https://www.google.com/maps?q=${spot.lat},${spot.lng}`;
    const lines = [
      `📍 *${spot.title}* (ID: \`${spotId}\`)`,
      `🏷 Type: ${spot.type || 'N/A'}`,
      `📦 Source: ${spot.source || 'N/A'}`,
      `📌 Status: ${spot.status || 'N/A'}`,
      `🗺 Area: ${spot.area || 'N/A'}`,
      `📍 Coords: ${spot.lat}, ${spot.lng}`,
      spot.venue_id ? `🔑 Venue ID: \`${spot.venue_id}\`` : '',
      spot.promotion_time ? `⏰ Time: ${spot.promotion_time}` : '',
      spot.promotion_list ? `📋 Promos: ${spot.promotion_list.substring(0, 300)}` : '',
      spot.source_url ? `🔗 URL: ${spot.source_url}` : '',
      spot.photo_url ? `🖼 Photo: ${spot.photo_url}` : '',
      spot.last_update_date ? `📅 Updated: ${spot.last_update_date}` : '',
      spot.description ? `📝 ${spot.description.substring(0, 300)}` : '',
      `🗺 [View on Map](${mapLink})`,
    ].filter(Boolean);
    await send(lines.join('\n'));
    return true;
  }

  return false;
}

export function routeCallbackData(data: string): { handler: string; args: [string, string | number] } | null {
  const spotMatch = data.match(/^(approve|deny)_(\d+)$/);
  if (spotMatch) return { handler: 'spot', args: [spotMatch[1], parseInt(spotMatch[2], 10)] };

  const actMatch = data.match(/^(actadd|actdeny)_(.+)$/);
  if (actMatch) return { handler: 'activity', args: [actMatch[1], actMatch[2]] };

  const rptMatch = data.match(/^(rptexcl|rptkeep)_(\d+)$/);
  if (rptMatch) return { handler: 'report', args: [rptMatch[1], parseInt(rptMatch[2], 10)] };

  const edtMatch = data.match(/^(edtappr|edtdeny)_(\d+)$/);
  if (edtMatch) return { handler: 'edit', args: [edtMatch[1], parseInt(edtMatch[2], 10)] };

  const delMatch = data.match(/^(delappr|deldeny)_(\d+)$/);
  if (delMatch) return { handler: 'delete', args: [delMatch[1], parseInt(delMatch[2], 10)] };

  return null;
}
