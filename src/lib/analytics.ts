/**
 * Lightweight Umami analytics wrapper.
 *
 * Tracking is always enabled — no consent gate required since Umami is
 * privacy-first (no cookies, no personal data, GDPR-compliant by default).
 */

// ── tracking helpers ─────────────────────────────────────────────

interface UmamiTracker {
  track: (eventNameOrProps?: string | Record<string, unknown>, eventData?: Record<string, unknown>) => void;
}

function getUmami(): UmamiTracker | null {
  if (typeof window === 'undefined') return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).umami ?? null;
}

/** Track a pageview. */
export function trackPageview(): void {
  getUmami()?.track();
}

/** Track a named custom event with optional payload. */
export function trackEvent(name: string, data?: Record<string, unknown>): void {
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

export function trackFeedbackSubmit(): void {
  trackEvent('feedback-submit');
}

export function trackSpotDetailsView(spotId: number, spotName: string, area: string): void {
  trackEvent('spot-details-view', { spotId, spotName, area });
}

export function trackSearchFilter(query: string): void {
  trackEvent('search-filter', { query });
}
