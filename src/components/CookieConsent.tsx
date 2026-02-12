'use client';

import { useState, useEffect, useCallback } from 'react';
import { consentUndecided, grantConsent, revokeConsent, hasConsent, trackPageview } from '@/lib/analytics';

/**
 * Small banner that appears at the bottom of the screen when the user
 * hasn't yet decided on analytics cookies.  Choosing "Accept" enables
 * Umami tracking; "Decline" keeps it off.  Either way the banner
 * dismisses permanently (stored in localStorage).
 */
export default function CookieConsent() {
  // Initialise visibility based on consent status (no effect needed)
  const [visible, setVisible] = useState(() => {
    if (typeof window === 'undefined') return false;
    return consentUndecided();
  });

  // Fire initial pageview for returning users who already consented
  const firePageview = useCallback(() => {
    if (hasConsent()) trackPageview();
  }, []);

  useEffect(() => {
    firePageview();
  }, [firePageview]);

  if (!visible) return null;

  const accept = () => {
    grantConsent();
    setVisible(false);
  };

  const decline = () => {
    revokeConsent();
    setVisible(false);
  };

  return (
    <div className="fixed bottom-14 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-xl bg-white/95 p-4 text-sm shadow-xl ring-1 ring-black/10 backdrop-blur-lg safe-area-bottom">
      <p className="mb-3 text-gray-700">
        We use cookies to understand how people use this app (anonymous analytics).
        No personal data is collected. Simply put, to understand what&#39;s used and how to improve this app.
      </p>
      <div className="flex gap-2">
        <button
          onClick={accept}
          className="flex-1 rounded-lg bg-teal-600 px-3 py-2 font-medium text-white transition-colors hover:bg-teal-700"
        >
          Accept
        </button>
        <button
          onClick={decline}
          className="flex-1 rounded-lg bg-gray-200 px-3 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-300"
        >
          Decline
        </button>
      </div>
    </div>
  );
}
