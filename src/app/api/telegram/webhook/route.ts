/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { answerCallbackQuery, editMessage } from '@/lib/telegram';
import { atomicWriteFileSync } from '@/lib/atomic-write';

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
      
      // Parse callback data: "approve_123" or "deny_123"
      const match = data.match(/^(approve|deny)_(\d+)$/);
      if (!match) {
        await answerCallbackQuery(callbackQuery.id, 'Invalid action');
        return NextResponse.json({ ok: true });
      }
      
      const action = match[1]; // 'approve' or 'deny'
      const spotId = parseInt(match[2], 10);
      
      // Update spot status in spots.json
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
          await editMessage(chatId, messageId, `❓ Spot #${spotId} not found (may have been deleted).`);
        }
        return NextResponse.json({ ok: true });
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
        // Deny — remove the spot entirely (soft delete)
        spots[spotIndex] = { ...spot, status: 'denied' };
        atomicWriteFileSync(spotsPath, JSON.stringify(spots, null, 2));
        
        await answerCallbackQuery(callbackQuery.id, `Denied: ${spot.title}`);
        if (chatId && messageId) {
          await editMessage(chatId, messageId, `❌ *Denied*: ${spot.title}\n\nSpot has been rejected.`);
        }
      }
      
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
            text: `👋 CHS Finds Admin Bot\n\nYour chat ID is: \`${chatId}\`\n\nAdd this as TELEGRAM_ADMIN_CHAT_ID in your .env.local file.`,
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

// GET endpoint for webhook verification
export async function GET() {
  return NextResponse.json({ status: 'Telegram webhook is active' });
}
