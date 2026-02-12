/**
 * Next.js Instrumentation
 *
 * This file runs once when the Next.js server starts.
 * We use it to kick off background services like Telegram polling.
 *
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only run on the server (not during build or in Edge runtime)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startTelegramPolling } = await import('./lib/telegram-poller');
    startTelegramPolling(5000);
  }
}
