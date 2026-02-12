/**
 * Server-side admin authentication.
 *
 * Write operations (PUT, DELETE on spots) require admin auth.
 * Supported methods (checked in order):
 *   1. `Authorization: Bearer <ADMIN_API_KEY>` header
 *   2. `x-admin-key: <ADMIN_API_KEY>` header
 *   3. `?admin=<ADMIN_SECRET>` query param (for backwards compat with frontend)
 *
 * The secret is stored in ADMIN_API_KEY env var. Falls back to the legacy
 * hardcoded value for backwards compatibility, but should be overridden in
 * production via .env.local.
 */

const LEGACY_SECRET = 'amsterdam';

function getAdminSecret(): string {
  return process.env.ADMIN_API_KEY || LEGACY_SECRET;
}

export function isAdminRequest(request: Request): boolean {
  const secret = getAdminSecret();

  // 1. Bearer token
  const authHeader = request.headers.get('authorization');
  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (token === secret) return true;
  }

  // 2. Custom header
  const keyHeader = request.headers.get('x-admin-key');
  if (keyHeader === secret) return true;

  // 3. Query param (legacy frontend compat)
  try {
    const url = new URL(request.url);
    if (url.searchParams.get('admin') === secret) return true;
  } catch {
    // Ignore URL parse errors
  }

  return false;
}

export function unauthorizedResponse() {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
