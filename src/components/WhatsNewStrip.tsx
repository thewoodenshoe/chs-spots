'use client';

import { useState } from 'react';
import { Spot } from '@/contexts/SpotsContext';
import { Activity } from '@/utils/activities';

const SESSION_KEY = 'chs-finds-whats-new-dismissed';

interface WhatsNewStripProps {
  spots: Spot[];
  activities: Activity[];
  onSelect: (spot: Spot) => void;
}

export default function WhatsNewStrip({ spots, activities, onSelect }: WhatsNewStripProps) {
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return sessionStorage.getItem(SESSION_KEY) === '1';
  });
  const [expanded, setExpanded] = useState(false);

  if (dismissed || spots.length === 0) return null;

  const dismiss = () => {
    sessionStorage.setItem(SESSION_KEY, '1');
    setDismissed(true);
  };

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="flex w-full items-center gap-2 border-b border-amber-100 bg-amber-50/60 px-4 py-2 text-left transition-colors hover:bg-amber-50"
      >
        <span className="text-amber-500 text-sm">&#9660;</span>
        <span className="flex-1 text-xs font-semibold text-amber-700">
          See the new venues in Charleston!
        </span>
        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-600">
          {spots.length}
        </span>
      </button>
    );
  }

  return (
    <div className="border-b border-gray-200 bg-white">
      <div className="flex items-center justify-between px-4 pt-2 pb-1">
        <button
          onClick={() => setExpanded(false)}
          className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-500 hover:text-gray-700 transition-colors"
        >
          <span className="text-amber-500 text-[10px]">&#9650;</span>
          What&apos;s New
        </button>
        <button
          onClick={dismiss}
          className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="Dismiss"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="flex gap-2 overflow-x-auto px-4 pb-3 scrollbar-hide">
        {spots.map(spot => {
          const cfg = activities.find(a => a.name === spot.type);
          const isComingSoon = spot.type === 'Coming Soon';
          return (
            <button
              key={spot.id}
              onClick={() => onSelect(spot)}
              className="flex-shrink-0 w-[140px] rounded-xl overflow-hidden border border-gray-100 bg-gray-50 hover:bg-gray-100 transition-colors active:scale-[0.97] touch-manipulation text-left"
            >
              {spot.photoUrl ? (
                <img
                  src={spot.photoUrl}
                  alt={spot.title}
                  className="h-20 w-full object-cover"
                  onError={(e) => {
                    const el = e.currentTarget;
                    el.style.display = 'none';
                    const next = el.nextElementSibling as HTMLElement;
                    if (next) next.style.display = 'flex';
                  }}
                />
              ) : null}
              <div
                className={`${spot.photoUrl ? 'hidden' : 'flex'} h-20 w-full items-center justify-center text-2xl`}
                style={{ backgroundColor: (cfg?.color || '#0d9488') + '15' }}
              >
                {cfg?.emoji || '📍'}
              </div>
              <div className="p-2">
                <div className="text-[11px] font-semibold text-gray-900 truncate">{spot.title}</div>
                <div className="flex items-center gap-1 mt-0.5">
                  <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                    isComingSoon
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-green-100 text-green-700'
                  }`}>
                    {isComingSoon ? 'Soon' : 'New'}
                  </span>
                  {spot.area && (
                    <span className="text-[9px] text-gray-400 truncate">{spot.area}</span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
