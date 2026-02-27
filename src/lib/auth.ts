/**
 * Server-side admin authentication.
 *
 * Write operations (PUT, DELETE on spots) require admin auth.
 * Set ADMIN_API_KEY in .env.local to a strong random string. No fallback.
 *
 * Supported methods (checked in order):
 *   1. Authorization: Bearer <ADMIN_API_KEY>
 *   2. x-admin-key: <ADMIN_API_KEY>
 */

function getAdminSecret(): string {
  return process.env.ADMIN_API_KEY || '';
}

export function isAdminRequest(request: Request): boolean {
  const secret = getAdminSecret();
  if (!secret) return false;

  const authHeader = request.headers.get('authorization');
  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (token === secret) return true;
  }

  const keyHeader = request.headers.get('x-admin-key');
  if (keyHeader === secret) return true;

  return false;
}

export function unauthorizedResponse() {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
