/**
 * Simple in-memory rate limiter for API routes.
 *
 * Uses a sliding window approach keyed by IP address.
 * This supplements Nginx rate limiting as defense-in-depth.
 */

interface RateLimitEntry {
  timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();

// Clean up old entries every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 120_000; // 2 min retention
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
    if (entry.timestamps.length === 0) store.delete(key);
  }
}, 300_000);

/**
 * Check whether the given key (usually an IP) exceeds the rate limit.
 *
 * @param key   – identifier (IP address)
 * @param limit – max requests allowed in the window
 * @param windowMs – window duration in milliseconds
 * @returns true if within limit, false if rate-limited
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const cutoff = now - windowMs;

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  // Remove timestamps outside the window
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

  if (entry.timestamps.length >= limit) {
    return false; // rate-limited
  }

  entry.timestamps.push(now);
  return true; // allowed
}

/**
 * Extract client IP from request headers.
 * Respects X-Forwarded-For (set by Nginx) or X-Real-IP.
 */
export function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const xri = request.headers.get('x-real-ip');
  if (xri) return xri;
  return 'unknown';
}
