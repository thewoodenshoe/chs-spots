'use client';

import React, { useState, useMemo } from 'react';
import { Spot } from '@/contexts/SpotsContext';
import { useVenues } from '@/contexts/VenuesContext';
import { isSpotActiveNow } from '@/utils/time-utils';
import { getOpenStatus } from '@/utils/active-status';
import { shareSpot } from '@/utils/share';
import { formatDescription } from '@/utils/format-description';

interface SpotInfoWindowProps {
  spot: Spot;
  activities: Array<{ name: string; emoji: string; color: string }>;
  onEdit?: (spot: Spot) => void;
  onReport?: (spot: Spot) => void;
  onClose: () => void;
}

export default function SpotInfoWindow({ spot, activities, onEdit, onReport, onClose }: SpotInfoWindowProps) {
  const [shareCopied, setShareCopied] = useState(false);
  const { venues } = useVenues();
  const openStatus = useMemo(() => {
    const venue = spot.venueId ? venues.find(v => v.id === spot.venueId) : undefined;
    return venue ? getOpenStatus(venue.operatingHours) : null;
  }, [spot.venueId, venues]);

  return (
    <div className="text-sm min-w-[200px] max-w-[300px]">
      <div className="font-bold text-gray-900 mb-1 text-base">{spot.title}</div>

      {/* Status badges */}
      <div className="mb-2 flex flex-wrap gap-1">
        {isSpotActiveNow(spot) && (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-700">
            Active Now
          </span>
        )}
        {openStatus && openStatus.label && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
            openStatus.isOpen
              ? 'bg-emerald-50 text-emerald-600'
              : 'bg-gray-100 text-gray-500'
          }`}>
            {openStatus.isOpen
              ? openStatus.label === 'Closing soon'
                ? `Closing soon · til ${openStatus.closesAt}`
                : `Open · til ${openStatus.closesAt}`
              : openStatus.opensAt
                ? `Closed · opens ${openStatus.opensAt}`
                : 'Closed'}
          </span>
        )}
        {spot.status === 'pending' && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
            Pending Approval
          </span>
        )}
        {spot.source === 'manual' && spot.submitterName && (
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
            Added by {spot.submitterName}
          </span>
        )}
      </div>

      {/* Schedule / Time */}
      {(spot.promotionTime || spot.happyHourTime) && (() => {
        const raw = spot.promotionTime || spot.happyHourTime || '';
        const parts = raw.split(/\s*[•]\s*/).map((p: string) => p.trim()).filter(Boolean);
        return (
          <div className="mb-2">
            <div className="font-semibold text-gray-700 mb-0.5 text-xs uppercase tracking-wide">Schedule</div>
            <div className="space-y-0.5">
              {parts.map((part: string, idx: number) => (
                <div key={idx} className="text-xs text-gray-800 leading-snug">{part}</div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Specials list */}
      {((spot.promotionList && spot.promotionList.length > 0) || (spot.happyHourList && spot.happyHourList.length > 0)) && (() => {
        const items: string[] = spot.promotionList ?? spot.happyHourList ?? [];
        const groups: { label: string; entries: string[] }[] = [];
        const groupMap: Record<string, string[]> = {};
        const order: string[] = [];
        items.forEach((item: string) => {
          const match = item.match(/^\[([^\]]+)\]\s*(.*)/);
          const label = match ? match[1] : '';
          const text = match ? match[2] : item;
          if (!text.trim()) return;
          if (!groupMap[label]) { groupMap[label] = []; order.push(label); }
          groupMap[label].push(text.trim());
        });
        order.forEach(label => groups.push({ label, entries: groupMap[label] }));

        return (
          <div className="mb-2">
            <div className="font-semibold text-gray-700 mb-1 text-xs uppercase tracking-wide">
              Specials
            </div>
            <div className="space-y-1.5">
              {groups.map((g, gIdx) => (
                <div key={gIdx}>
                  {g.label && <div className="text-xs font-semibold text-gray-700">{g.label}</div>}
                  {g.entries.map((entry, eIdx) => (
                    <div key={eIdx} className="text-xs text-gray-600 pl-2">
                      {entry}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {spot.sourceUrl && (
        <div className="mb-2">
          <a
            href={spot.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline text-sm font-medium"
          >
            Website
          </a>
        </div>
      )}

      {spot.lastUpdateDate && (
        <div className="mb-2">
          <span className="font-semibold text-gray-700">Last Update Date: </span>
          <span className="text-gray-800 text-xs">
            {new Date(spot.lastUpdateDate).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric'
            })}
          </span>
        </div>
      )}

      {/* Fallback description */}
      {!spot.promotionTime && !spot.happyHourTime && !spot.promotionList && !spot.happyHourList && spot.description && (
        <div className="mb-3">
          {formatDescription(spot.description)}
        </div>
      )}

      <div className="mt-2 flex items-center gap-2 mb-2">
        <span className="text-base">
          {activities.find(a => a.name === spot.type)?.emoji || '📍'}
        </span>
        <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-medium text-teal-800">
          {spot.type}
        </span>
      </div>
      {/* next/image doesn't work inside Google Maps InfoWindow DOM */}
      { }
      {spot.photoUrl && (
        <img
          src={spot.photoUrl}
          alt={spot.title}
          className="mt-2 h-32 w-full rounded-lg object-cover"
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
      )}
      {/* Action buttons */}
      <div className="mt-3 flex gap-2">
        {onEdit && (
          <button
            onClick={() => {
              onEdit(spot);
              onClose();
            }}
            className="flex-1 rounded-lg bg-teal-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-teal-700 touch-manipulation"
          >
            Edit
          </button>
        )}
        <a
          href={`https://www.google.com/maps/dir/?api=1&destination=${spot.lat},${spot.lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg bg-indigo-100 px-3 py-2 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-200 touch-manipulation"
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
          className="rounded-lg bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-200 touch-manipulation"
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
      {onReport && spot.source === 'automated' && (
        <button
          onClick={() => {
            onReport(spot);
            onClose();
          }}
          className="mt-1.5 w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100 touch-manipulation"
        >
          Something wrong? Suggest an edit, or provide feedback
        </button>
      )}
    </div>
  );
}
