'use client';

import { useState } from 'react';

interface CommunityBannerProps {
  activityName: string;
  onDismiss: () => void;
}

const STORAGE_KEY = 'chs-community-banner-dismissed';

function getDismissed(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function setDismissed(dismissed: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...dismissed]));
  } catch { /* localStorage unavailable */ }
}

export function shouldShowBanner(activityName: string): boolean {
  return !getDismissed().has(activityName);
}

export function dismissBanner(activityName: string) {
  const d = getDismissed();
  d.add(activityName);
  setDismissed(d);
}

export default function CommunityBanner({ activityName, onDismiss }: CommunityBannerProps) {
  const [dontShowAgain, setDontShowAgain] = useState(true);
  const [closing, setClosing] = useState(false);

  const handleClose = () => {
    if (dontShowAgain) {
      dismissBanner(activityName);
    }
    setClosing(true);
    setTimeout(onDismiss, 200);
  };

  return (
    <div
      className={`absolute left-3 right-3 z-30 transition-all duration-200 ${closing ? 'opacity-0 -translate-y-2' : 'animate-fade-in-down'}`}
      style={{ top: '174px' }}
      role="alert"
      data-testid="community-banner"
    >
      <div className="rounded-2xl bg-white/95 shadow-xl backdrop-blur-sm border border-gray-200 p-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 mt-0.5 text-2xl">🤝</div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-gray-900 text-sm">Community-Powered Spots</h3>
            <p className="text-gray-600 text-xs mt-1 leading-relaxed">
              <strong>{activityName}</strong> are added by locals like you! Know a great spot?
              Tap <strong>&quot;Add Spot&quot;</strong> in the footer to share it with the community.
            </p>
            <label className="flex items-center gap-2 mt-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={dontShowAgain}
                onChange={(e) => setDontShowAgain(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                data-testid="dont-show-checkbox"
              />
              <span className="text-xs text-gray-500">Don&apos;t show this again</span>
            </label>
          </div>
          <button
            onClick={handleClose}
            className="flex-shrink-0 p-1 text-gray-400 hover:text-gray-600 transition-colors rounded-full hover:bg-gray-100"
            aria-label="Close banner"
            data-testid="close-banner"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
