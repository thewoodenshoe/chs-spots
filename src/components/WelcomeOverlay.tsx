'use client';

import { useState, useMemo } from 'react';
import { Spot } from '@/contexts/SpotsContext';
import { isSpotActiveNow, getSpotStartMinutes, extractCompactTime } from '@/utils/time-utils';

const STORAGE_KEY = 'chs-finds-welcomed';

interface WelcomeOverlayProps {
  onComplete: () => void;
  spots: Spot[];
}

export function hasSeenWelcome(): boolean {
  if (typeof window === 'undefined') return true;
  return localStorage.getItem(STORAGE_KEY) === '1';
}

function formatMinutesUntil(targetMinutes: number): string {
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  let diff = targetMinutes - nowMinutes;
  if (diff <= 0) diff += 24 * 60;
  const hours = Math.floor(diff / 60);
  const mins = diff % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

export default function WelcomeOverlay({ onComplete, spots }: WelcomeOverlayProps) {
  const [dismissed, setDismissed] = useState(() => hasSeenWelcome());
  const [dontShowAgain, setDontShowAgain] = useState(true);

  const { activeSpots, nextSpot, nextTimeLabel } = useMemo(() => {
    const timeBasedSpots = spots.filter(
      s => (s.type === 'Happy Hour' || s.type === 'Brunch' || s.type === 'Live Music')
        && s.lat !== 0 && s.lng !== 0
    );

    const active = timeBasedSpots
      .filter(s => isSpotActiveNow(s))
      .slice(0, 3);

    if (active.length > 0) {
      return { activeSpots: active, nextSpot: null, nextTimeLabel: null };
    }

    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    let bestSpot: Spot | null = null;
    let bestDiff = Infinity;

    for (const s of timeBasedSpots) {
      const start = getSpotStartMinutes(s);
      if (start === null) continue;
      let diff = start - nowMinutes;
      if (diff <= 0) diff += 24 * 60;
      if (diff < bestDiff) {
        bestDiff = diff;
        bestSpot = s;
      }
    }

    const startMin = bestSpot ? getSpotStartMinutes(bestSpot) : null;
    return {
      activeSpots: [],
      nextSpot: bestSpot,
      nextTimeLabel: startMin !== null ? formatMinutesUntil(startMin) : null,
    };
  }, [spots]);

  if (dismissed) return null;

  const dismiss = () => {
    if (dontShowAgain) {
      localStorage.setItem(STORAGE_KEY, '1');
    }
    setDismissed(true);
    onComplete();
  };

  const hasData = activeSpots.length > 0 || nextSpot;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-5">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={dismiss} />

      <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="bg-gradient-to-br from-teal-600 to-teal-700 px-6 pt-7 pb-5 text-center text-white">
          <h2 className="text-xl font-bold leading-tight">
            Charleston happy hours,<br />updated every night
          </h2>
          <p className="mt-2 text-sm text-teal-100 leading-relaxed">
            We scan 700+ restaurant websites daily for the latest happy hours, brunch deals, and new openings.
          </p>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div className="flex items-start gap-3">
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-teal-50 text-base">🍹</span>
            <div>
              <div className="text-sm font-semibold text-gray-900">Real-time happy hours</div>
              <div className="text-xs text-gray-500">See what&apos;s active right now with actual prices and times</div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-amber-50 text-base">🆕</span>
            <div>
              <div className="text-sm font-semibold text-gray-900">New restaurant alerts</div>
              <div className="text-xs text-gray-500">Coming soon &amp; recently opened spots, found automatically</div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-green-50 text-base">✅</span>
            <div>
              <div className="text-sm font-semibold text-gray-900">Verified from the source</div>
              <div className="text-xs text-gray-500">Not crowdsourced reviews — data pulled directly from venue sites</div>
            </div>
          </div>
        </div>

        {hasData && (
          <div className="border-t border-gray-100 px-5 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
              {activeSpots.length > 0 ? 'Active right now' : 'Coming up next'}
            </p>
            {activeSpots.length > 0 ? (
              activeSpots.slice(0, 2).map(spot => (
                <div key={spot.id} className="flex items-center gap-3 rounded-lg bg-green-50 p-2 mb-1.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-100 text-sm flex-shrink-0">🍹</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-gray-900 text-xs truncate">{spot.title}</div>
                    <div className="text-[10px] text-green-700 font-medium">
                      Active Now {extractCompactTime(spot) && `· ${extractCompactTime(spot)}`}
                    </div>
                  </div>
                </div>
              ))
            ) : nextSpot && (
              <div className="flex items-center gap-3 rounded-lg bg-amber-50 p-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-sm flex-shrink-0">⏳</span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-gray-900 text-xs truncate">{nextSpot.title}</div>
                  <div className="text-[10px] text-amber-700 font-medium">Starts in {nextTimeLabel}</div>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between px-6 pb-2">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-gray-300 text-teal-500 focus:ring-teal-500"
            />
            <span className="text-[11px] text-gray-400">Don&apos;t show again</span>
          </label>
        </div>

        <div className="flex justify-center px-6 pb-5">
          <button
            onClick={dismiss}
            className="w-full rounded-full bg-teal-500 px-6 py-3 text-sm font-semibold text-white shadow-md hover:bg-teal-600 transition-colors active:scale-95"
          >
            {activeSpots.length > 0 ? `See ${activeSpots.length} active now` : 'Show me deals'}
          </button>
        </div>
      </div>
    </div>
  );
}
