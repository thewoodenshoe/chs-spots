/**
 * Lightweight Umami analytics wrapper.
 *
 * All tracking is gated on cookie consent. If the user hasn't opted in,
 * calls are silently no-ops.
 *
 * Umami is loaded with data-auto-track="false" so we manually fire the
 * initial pageview and custom events only after consent is granted.
 */

const CONSENT_KEY = 'analytics_consent';

// ── consent helpers ──────────────────────────────────────────────

export function hasConsent(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(CONSENT_KEY) === 'granted';
}

export function grantConsent(): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(CONSENT_KEY, 'granted');
  // Fire the initial pageview now that consent is given
  trackPageview();
}

export function revokeConsent(): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(CONSENT_KEY, 'denied');
}

export function consentUndecided(): boolean {
  if (typeof window === 'undefined') return true;
  return localStorage.getItem(CONSENT_KEY) === null;
}

// ── tracking helpers ─────────────────────────────────────────────

interface UmamiTracker {
  track: (eventNameOrProps?: string | Record<string, unknown>, eventData?: Record<string, unknown>) => void;
}

function getUmami(): UmamiTracker | null {
  if (typeof window === 'undefined') return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).umami ?? null;
}

/** Track a pageview (call once after consent + on SPA navigations). */
export function trackPageview(): void {
  if (!hasConsent()) return;
  getUmami()?.track();
}

/** Track a named custom event with optional payload. */
export function trackEvent(name: string, data?: Record<string, unknown>): void {
  if (!hasConsent()) return;
  getUmami()?.track(name, data);
}

// ── pre-defined domain events ────────────────────────────────────

export function trackAreaView(area: string): void {
  trackEvent('area-view', { area });
}

export function trackSpotClick(spotId: number, spotName: string, area: string): void {
  trackEvent('spot-click', { spotId, spotName, area });
}

export function trackSpotSubmit(area: string, activity: string): void {
  trackEvent('spot-submit', { area, activity });
}

export function trackActivityFilter(activity: string): void {
  trackEvent('activity-filter', { activity });
}

export function trackVenueToggle(showAll: boolean): void {
  trackEvent('venue-toggle', { showAll });
}
