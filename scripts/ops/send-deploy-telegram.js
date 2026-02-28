#!/usr/bin/env node
/**
 * Sends a Telegram notification after deployment.
 * Reads TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID from .env.local
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env.local') });
const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
if (!token || !chatId) {
  console.error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_ADMIN_CHAT_ID');
  process.exit(1);
}
const text = process.argv[2] || 'CHS Finds deployed';
fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
})
  .then((r) => r.json())
  .then((d) => {
    if (!d.ok) {
      console.error('Telegram error:', d);
      process.exit(1);
    }
    console.log('Telegram sent');
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
