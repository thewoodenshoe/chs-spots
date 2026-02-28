'use client';

import React, { useState, useMemo } from 'react';
import { Spot } from '@/contexts/SpotsContext';
import { useVenues } from '@/contexts/VenuesContext';
import { isSpotActiveNow } from '@/utils/time-utils';
import { getOpenStatus } from '@/utils/active-status';
import { shareSpot } from '@/utils/share';
import SpotDetailSections from '@/components/SpotDetailSections';

interface SpotInfoWindowProps {
  spot: Spot;
  activities: Array<{ name: string; emoji: string; color: string }>;
  onEdit?: (spot: Spot) => void;
  onReport?: (spot: Spot) => void;
  onClose: () => void;
}

export default function SpotInfoWindow({ spot, activities, onEdit, onClose }: SpotInfoWindowProps) {
  const [shareCopied, setShareCopied] = useState(false);
  const { venues } = useVenues();
  const venue = useMemo(() => {
    return spot.venueId ? venues.find(v => v.id === spot.venueId) : undefined;
  }, [spot.venueId, venues]);
  const openStatus = useMemo(() => {
    return venue ? getOpenStatus(venue.operatingHours) : null;
  }, [venue]);

  const cfg = activities.find(a => a.name === spot.type);
  const emoji = cfg?.emoji || '📍';
  const color = cfg?.color || '#0d9488';

  return (
    <div className="text-sm min-w-[220px] max-w-[300px]">
      {/* ── Title + Status ── */}
      <div className="font-bold text-gray-900 text-base">{spot.title}</div>
      <div className="mt-1 flex flex-wrap gap-1 mb-2">
        {isSpotActiveNow(spot) && (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-700">Active Now</span>
        )}
        {openStatus && openStatus.label && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
            openStatus.isOpen ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'
          }`}>
            {openStatus.isOpen
              ? openStatus.label === 'Closing soon' ? `Closing soon · til ${openStatus.closesAt}` : `Open · til ${openStatus.closesAt}`
              : openStatus.opensAt ? `Closed · opens ${openStatus.opensAt}` : 'Closed'}
          </span>
        )}
        {spot.status === 'pending' && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">Pending</span>
        )}
      </div>

      {/* ── Shared sections: Activity → Venue → Listing ── */}
      <SpotDetailSections
        spot={spot}
        venuePhone={venue?.phone}
        venueAddress={venue?.address}
        venueHours={venue?.operatingHours}
        venueWebsite={venue?.website}
        activityEmoji={emoji}
        activityColor={color}
      >
        {/* ── Actions ── */}
        <div className="flex gap-2 mt-3">
          {onEdit && (
            <button
              onClick={() => { onEdit(spot); onClose(); }}
              className="flex-1 rounded-lg bg-teal-600 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-700 transition-colors touch-manipulation"
            >
              Suggest Edit
            </button>
          )}
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${spot.lat},${spot.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-indigo-100 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-200 transition-colors touch-manipulation"
            title="Get directions"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </a>
          <button
            onClick={async () => {
              const result = await shareSpot(spot.title, spot.id, spot.type, spot.area);
              if (result === 'copied' || result === 'shared') {
                setShareCopied(true);
                setTimeout(() => setShareCopied(false), 2000);
              }
            }}
            className="rounded-lg bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-200 transition-colors touch-manipulation"
            title="Share this spot"
          >
            {shareCopied ? (
              <span className="text-xs font-semibold text-teal-600">Copied!</span>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
            )}
          </button>
        </div>
      </SpotDetailSections>
    </div>
  );
}
