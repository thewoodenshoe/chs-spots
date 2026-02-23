/**
 * Telegram Bot API helper
 * 
 * Sends messages to the admin's Telegram chat for spot approval.
 * Uses the Telegram Bot API directly (no external library needed).
 * 
 * Required env vars:
 *   TELEGRAM_BOT_TOKEN - Bot token from BotFather
 *   TELEGRAM_ADMIN_CHAT_ID - Your personal chat ID (get via @userinfobot)
 */

const TELEGRAM_API = 'https://api.telegram.org/bot';

function getBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN not set in environment variables');
  }
  return token;
}

function getAdminChatId(): string {
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!chatId) {
    throw new Error('TELEGRAM_ADMIN_CHAT_ID not set in environment variables');
  }
  return chatId;
}

/**
 * Send a message to the admin with inline keyboard buttons
 */
export async function sendApprovalRequest(spot: {
  id: number;
  title: string;
  type: string;
  lat: number;
  lng: number;
  description?: string;
}): Promise<boolean> {
  try {
    const token = getBotToken();
    const chatId = getAdminChatId();
    
    const mapLink = `https://www.google.com/maps?q=${spot.lat},${spot.lng}`;
    const message = [
      `🆕 *New Spot Submission*`,
      ``,
      `📍 *${escapeMarkdown(spot.title)}*`,
      `🏷 Type: ${escapeMarkdown(spot.type)}`,
      `📝 ${spot.description ? escapeMarkdown(spot.description.substring(0, 200)) : 'No description'}`,
      `🗺 [View on Map](${mapLink})`,
      ``,
      `ID: \`${spot.id}\``,
    ].join('\n');

    const response = await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Approve', callback_data: `approve_${spot.id}` },
              { text: '❌ Deny', callback_data: `deny_${spot.id}` },
            ],
          ],
        },
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('Telegram API error:', errorData);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Failed to send Telegram approval request:', error);
    return false;
  }
}

/**
 * Send an activity suggestion to admin with Approve/Deny buttons
 */
export async function sendActivityApproval(suggestion: {
  name: string;
  activityName: string;
  description?: string;
}): Promise<boolean> {
  try {
    const token = getBotToken();
    const chatId = getAdminChatId();

    const safeActivity = suggestion.activityName.replace(/[^a-zA-Z0-9 ]/g, '').substring(0, 40);
    const callbackId = safeActivity.replace(/\s+/g, '_');

    const message = [
      `💡 *Activity Suggestion*`,
      ``,
      `👤 From: ${escapeMarkdown(suggestion.name)}`,
      `🏷 Activity: *${escapeMarkdown(suggestion.activityName)}*`,
      suggestion.description ? `📝 ${escapeMarkdown(suggestion.description)}` : '',
    ].filter(Boolean).join('\n');

    const response = await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Add Activity', callback_data: `actadd_${callbackId}` },
              { text: '❌ Dismiss', callback_data: `actdeny_${callbackId}` },
            ],
          ],
        },
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('Telegram API error (activity suggestion):', errorData);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Failed to send activity approval:', error);
    return false;
  }
}

/**
 * Send a spot report to admin with Exclude/Dismiss buttons
 */
export async function sendSpotReport(report: {
  spotId: number;
  spotTitle: string;
  venueId?: string;
  reporterName: string;
  issue: string;
}): Promise<boolean> {
  try {
    const token = getBotToken();
    const chatId = getAdminChatId();

    const message = [
      `🚩 *Spot Issue Report*`,
      ``,
      `📍 Spot: *${escapeMarkdown(report.spotTitle)}* (ID: \`${report.spotId}\`)`,
      report.venueId ? `🔑 Venue: \`${report.venueId}\`` : '',
      `👤 Reporter: ${escapeMarkdown(report.reporterName)}`,
      `📝 Issue: ${escapeMarkdown(report.issue)}`,
    ].filter(Boolean).join('\n');

    const response = await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🚫 Exclude Venue', callback_data: `rptexcl_${report.spotId}` },
              { text: '✅ Keep Spot', callback_data: `rptkeep_${report.spotId}` },
            ],
          ],
        },
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('Telegram API error (spot report):', errorData);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Failed to send spot report:', error);
    return false;
  }
}

/**
 * Send an edit approval request to admin
 */
export async function sendEditApproval(edit: {
  id: number;
  title: string;
  type: string;
  changes: string[];
  lat: number;
  lng: number;
}): Promise<boolean> {
  try {
    const token = getBotToken();
    const chatId = getAdminChatId();
    const mapLink = `https://www.google.com/maps?q=${edit.lat},${edit.lng}`;

    const message = [
      `✏️ *Edit Request*`,
      ``,
      `📍 *${escapeMarkdown(edit.title)}*`,
      `🏷 New type: ${escapeMarkdown(edit.type)}`,
      ``,
      `*Changes:*`,
      ...edit.changes.map(c => `• ${escapeMarkdown(c)}`),
      ``,
      `🗺 [View on Map](${mapLink})`,
      `ID: \`${edit.id}\``,
    ].join('\n');

    const response = await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Approve Edit', callback_data: `edtappr_${edit.id}` },
            { text: '❌ Reject', callback_data: `edtdeny_${edit.id}` },
          ]],
        },
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('Telegram API error (edit approval):', errorData);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Failed to send edit approval:', error);
    return false;
  }
}

/**
 * Send a delete approval request to admin
 */
export async function sendDeleteApproval(spot: {
  id: number;
  title: string;
  type: string;
  source?: string;
  venueId?: string;
}): Promise<boolean> {
  try {
    const token = getBotToken();
    const chatId = getAdminChatId();

    const message = [
      `🗑 *Delete Request*`,
      ``,
      `📍 *${escapeMarkdown(spot.title)}*`,
      `🏷 Type: ${escapeMarkdown(spot.type)}`,
      `📦 Source: ${spot.source || 'unknown'}`,
      spot.venueId ? `🔑 Venue: \`${spot.venueId}\`` : '',
      `ID: \`${spot.id}\``,
    ].filter(Boolean).join('\n');

    const response = await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Delete It', callback_data: `delappr_${spot.id}` },
            { text: '❌ Keep It', callback_data: `deldeny_${spot.id}` },
          ]],
        },
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('Telegram API error (delete approval):', errorData);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Failed to send delete approval:', error);
    return false;
  }
}

/**
 * Send a simple notification to admin
 */
export async function sendNotification(text: string): Promise<boolean> {
  try {
    const token = getBotToken();
    const chatId = getAdminChatId();

    const response = await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
      }),
    });

    return response.ok;
  } catch (error) {
    console.error('Failed to send Telegram notification:', error);
    return false;
  }
}

/**
 * Answer a callback query (acknowledge button press)
 */
export async function answerCallbackQuery(callbackQueryId: string, text: string): Promise<boolean> {
  try {
    const token = getBotToken();

    const response = await fetch(`${TELEGRAM_API}${token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text,
      }),
    });

    return response.ok;
  } catch (error) {
    console.error('Failed to answer callback query:', error);
    return false;
  }
}

/**
 * Edit the original message after approval/denial
 */
export async function editMessage(chatId: string | number, messageId: number, newText: string): Promise<boolean> {
  try {
    const token = getBotToken();

    const response = await fetch(`${TELEGRAM_API}${token}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text: newText,
        parse_mode: 'Markdown',
      }),
    });

    return response.ok;
  } catch (error) {
    console.error('Failed to edit Telegram message:', error);
    return false;
  }
}

/**
 * Escape special characters for Telegram MarkdownV1 (exported for use in feedback etc.)
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}
