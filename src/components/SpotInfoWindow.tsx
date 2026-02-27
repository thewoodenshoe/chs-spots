'use client';

import React, { useState, useMemo } from 'react';
import { Spot } from '@/contexts/SpotsContext';
import { useVenues, OperatingHours } from '@/contexts/VenuesContext';
import { isSpotActiveNow, getFreshness } from '@/utils/time-utils';
import { getOpenStatus } from '@/utils/active-status';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const DAY_LABELS: Record<string, string> = {
  sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat',
};
function fmt12(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'pm' : 'am';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m ? `${h12}:${String(m).padStart(2, '0')}${ap}` : `${h12}${ap}`;
}
function weekHours(hours: OperatingHours | null) {
  if (!hours) return [];
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const todayIdx = now.getDay();
  return DAY_KEYS.map((key, idx) => {
    const e = hours[key];
    return { day: DAY_LABELS[key], h: !e || e === 'closed' ? 'Closed' : `${fmt12(e.open)} - ${fmt12(e.close)}`, isToday: idx === todayIdx };
  });
}
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
  const venue = useMemo(() => {
    return spot.venueId ? venues.find(v => v.id === spot.venueId) : undefined;
  }, [spot.venueId, venues]);
  const openStatus = useMemo(() => {
    return venue ? getOpenStatus(venue.operatingHours) : null;
  }, [venue]);

  const cfg = activities.find(a => a.name === spot.type);
  const emoji = cfg?.emoji || '📍';
  const color = cfg?.color || '#0d9488';
  const promoTime = spot.promotionTime || spot.happyHourTime;
  const promoList: string[] = spot.promotionList ?? spot.happyHourList ?? [];
  const timeParts = promoTime ? promoTime.split(/\s*[•]\s*/).filter(Boolean) : [];

  return (
    <div className="text-sm min-w-[220px] max-w-[300px]">
      {/* ── Title + Status ── */}
      <div className="font-bold text-gray-900 text-base">{spot.title}</div>
      <div className="mt-1 flex flex-wrap gap-1">
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

      {/* ── Section 1: Activity ── */}
      <div className="mt-2 space-y-1.5">
        {promoTime && (
          <div>
            <div className="text-xs font-bold text-gray-700 mb-0.5">{spot.type}</div>
            {timeParts.map((part: string, i: number) => (
              <div key={i} className="text-xs text-gray-800 leading-snug">{part}</div>
            ))}
          </div>
        )}

        {promoList.length > 0 && (
          <div>
            <div className="text-xs font-bold text-gray-700 mb-0.5">Specials</div>
            {promoList.map((item: string, i: number) => {
              const m = item.match(/^\[([^\]]+)\]\s*(.*)/);
              const label = m ? m[1] : null;
              const text = m ? m[2] : item;
              if (!text.trim()) return null;
              return (
                <div key={i} className="text-xs text-gray-600">
                  {label && <span className="font-semibold text-gray-700">{label}: </span>}
                  {text}
                </div>
              );
            })}
          </div>
        )}

        {!promoTime && promoList.length === 0 && spot.description && (
          <div>{formatDescription(spot.description)}</div>
        )}

        {spot.sourceUrl && (
          <a
            href={spot.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-teal-600 hover:text-teal-800 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            Visit website
          </a>
        )}
      </div>

      {/* ── Section 2: Venue Info ── */}
      {(venue?.phone || venue?.address || venue?.operatingHours) && (
        <div className="mt-2.5 border-t border-gray-100 pt-2">
          <div className="text-xs font-bold text-gray-700 mb-1">Venue Info</div>
          <div className="space-y-1">
            {venue.phone && (
              <a href={`tel:${venue.phone}`} className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-teal-700 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                {venue.phone}
              </a>
            )}
            {venue.address && (
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(venue.address)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-1.5 text-xs text-gray-600 hover:text-teal-700 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="leading-snug">{venue.address.replace(/, United States$/, '')}</span>
              </a>
            )}
            {venue.operatingHours && (
              <div className="pt-1">
                <div className="text-xs font-bold text-gray-700 mb-0.5">Opening Hours</div>
                {weekHours(venue.operatingHours).map(({ day, h, isToday }) => (
                  <div key={day} className={`text-xs leading-snug flex gap-2 ${isToday ? 'text-gray-900 font-bold' : 'text-gray-600'}`}>
                    <span className="w-8">{day}</span>
                    <span>{h}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Section 3: Listing ── */}
      <div className="mt-2.5 border-t border-gray-100 pt-2">
        <div className="text-xs font-bold text-gray-700 mb-1.5">Listing</div>

        {(() => {
          const f = getFreshness(spot.lastVerifiedDate, spot.lastUpdateDate);
          const dotColor = f.level === 'fresh' ? 'bg-green-400' : f.level === 'aging' ? 'bg-yellow-400' : f.level === 'stale' ? 'bg-red-400' : 'bg-gray-300';
          return (
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className={`inline-block h-2 w-2 rounded-full ${dotColor}`} />
              <span className="text-[11px] text-gray-500">{f.label}</span>
            </div>
          );
        })()}

        <div className="flex items-center gap-1.5 mb-2">
          <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: color }}>
            {emoji} {spot.type}
          </span>
          {spot.source === 'manual' && spot.submitterName && (
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-600">
              by {spot.submitterName}
            </span>
          )}
        </div>

        {spot.photoUrl && (
          <img
            src={spot.photoUrl}
            alt={spot.title}
            className="h-28 w-full rounded-lg object-cover mb-2"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        )}

        <div className="flex gap-2">
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
      </div>
    </div>
  );
}
