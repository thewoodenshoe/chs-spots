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
 *
 * Only trusts X-Forwarded-For / X-Real-IP when behind our own Nginx
 * reverse proxy, which always sets X-Real-IP to the true client IP
 * and overwrites X-Forwarded-For. When those headers are absent
 * (direct access), we fall back to "unknown" — Nginx should be the
 * only entry point in production.
 */
export function getClientIp(request: Request): string {
  // Prefer X-Real-IP: Nginx sets this to the actual remote addr and
  // it cannot be spoofed through Nginx (proxy_set_header X-Real-IP $remote_addr).
  const xri = request.headers.get('x-real-ip');
  if (xri) return xri.trim();

  // Fall back to X-Forwarded-For last entry (closest proxy hop).
  // The *last* entry is the one added by our trusted Nginx, whereas
  // the first entry can be spoofed by the client.
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map(s => s.trim()).filter(Boolean);
    return parts[parts.length - 1];
  }

  return 'unknown';
}
