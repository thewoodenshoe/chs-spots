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
    type LookupCb = (err: Error | null, address: string, family: number) => void;
    undici.setGlobalDispatcher(new undici.Agent({
      connect: {
        lookup: (hostname: string, _options: unknown, cb: LookupCb) => {
          dns.lookup(hostname, { family: 4 }, (err: Error | null, address: string) => {
            cb(err, address, 4);
          });
        },
      },
    }));

    const { startTelegramPolling } = await import('./lib/telegram-poller');
    startTelegramPolling(5000);
  }
}
