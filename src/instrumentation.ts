/**
 * Next.js Instrumentation
 *
 * This file runs once when the Next.js server starts.
 * We use it to kick off background services like Telegram polling.
 *
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const dns = await import('node:dns');
    dns.setDefaultResultOrder('ipv4first');

    const undici = await import('undici');
    undici.setGlobalDispatcher(new undici.Agent({
      connect: { autoSelectFamily: false },
      allowH2: false,
    }));

    const { startTelegramPolling } = await import('./lib/telegram-poller');
    startTelegramPolling(5000);
  }
}
