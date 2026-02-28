'use client';

import React from 'react';
import { Spot } from '@/contexts/SpotsContext';
import { OperatingHours } from '@/contexts/VenuesContext';
import { getFreshness } from '@/utils/time-utils';
import { formatFullWeekHours } from '@/utils/format-hours';
import { formatDescription } from '@/utils/format-description';

export const SPOT_CARD_LAYOUT_VERSION = 2;

interface SpotDetailSectionsProps {
  spot: Spot;
  venuePhone?: string | null;
  venueAddress?: string | null;
  venueHours?: OperatingHours | null;
  venueWebsite?: string | null;
  activityEmoji: string;
  activityColor: string;
  children?: React.ReactNode;
}

function EmptyField({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-gray-300 italic">
      <span className="text-gray-200">—</span> {text}
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">{children}</div>;
}

export default function SpotDetailSections({
  spot,
  venuePhone,
  venueAddress,
  venueHours,
  venueWebsite,
  activityEmoji,
  activityColor,
  children,
}: SpotDetailSectionsProps) {
  const promoTime = spot.promotionTime || spot.happyHourTime;
  const promoList = spot.promotionList ?? spot.happyHourList ?? [];
  const timeParts = promoTime ? promoTime.split(/\s*[•]\s*/).filter(Boolean) : [];
  const hasActivityData = !!(promoTime || promoList.length > 0 || spot.description);
  const hasVenue = !!spot.venueId;

  return (
    <div data-card-version={SPOT_CARD_LAYOUT_VERSION}>
      {/* ─── Activity ─── */}
      <div className="space-y-1.5">
        <SectionHeading>{spot.type}</SectionHeading>

        {promoTime && timeParts.map((part, i) => (
          <div key={i} className="text-xs text-gray-700 leading-snug">{part}</div>
        ))}

        {promoList.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-gray-600 mb-0.5">Specials</div>
            {promoList.map((item, i) => {
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

        {!hasActivityData && <EmptyField text="No activity details" />}

        {spot.sourceUrl ? (
          <a
            href={spot.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-xs font-medium text-teal-600 hover:text-teal-800 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            Visit website
          </a>
        ) : (
          <EmptyField text="No source link" />
        )}
      </div>

      {/* ─── Venue ─── */}
      <div className="mt-3 border-t border-gray-100 pt-2">
        <SectionHeading>Venue</SectionHeading>
        {hasVenue ? (
          <div className="space-y-1.5">
            {venuePhone ? (
              <a href={`tel:${venuePhone}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-teal-700 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                {venuePhone}
              </a>
            ) : (
              <EmptyField text="No phone" />
            )}

            {venueAddress ? (
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(venueAddress)}`}
                target="_blank" rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex items-start gap-1.5 text-xs text-gray-600 hover:text-teal-700 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="leading-snug">{venueAddress.replace(/, United States$/, '')}</span>
              </a>
            ) : (
              <EmptyField text="No address" />
            )}

            {venueWebsite ? (
              <a
                href={venueWebsite}
                target="_blank" rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-teal-700 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                </svg>
                <span className="truncate">{venueWebsite.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</span>
              </a>
            ) : (
              <EmptyField text="No website" />
            )}

            {venueHours ? (
              <div className="pt-1">
                <div className="text-xs font-semibold text-gray-600 mb-0.5">Hours</div>
                {formatFullWeekHours(venueHours).map(({ day, hours: h, isToday }) => (
                  <div key={day} className={`text-xs leading-snug flex gap-2 ${isToday ? 'text-gray-900 font-semibold' : 'text-gray-500'}`}>
                    <span className="w-8">{day}</span>
                    <span>{h}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyField text="Hours not available" />
            )}
          </div>
        ) : (
          <EmptyField text="No venue linked" />
        )}
      </div>

      {/* ─── Listing ─── */}
      <div className="mt-3 border-t border-gray-100 pt-2">
        <SectionHeading>Listing</SectionHeading>

        {(() => {
          const f = getFreshness(spot.lastVerifiedDate, spot.lastUpdateDate);
          const dotColor = f.level === 'fresh' ? 'bg-green-400' : f.level === 'aging' ? 'bg-yellow-400' : f.level === 'stale' ? 'bg-red-400' : 'bg-gray-300';
          return (
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className={`inline-block h-2 w-2 rounded-full ${dotColor}`} />
              <span className="text-[11px] text-gray-500">{f.label}</span>
              {spot.type === 'Live Music' && (
                <span className="text-[10px] text-gray-400 ml-1">· Events daily at 3pm</span>
              )}
            </div>
          );
        })()}

        <div className="flex items-center gap-1.5 mb-2">
          <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: activityColor }}>
            {activityEmoji} {spot.type}
          </span>
          {spot.source === 'manual' && spot.submitterName && (
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-600">
              by {spot.submitterName}
            </span>
          )}
        </div>

        {spot.photoUrl ? (
          <div className="relative h-28 w-full overflow-hidden rounded-lg mb-2 bg-gray-100">
            <img
              src={spot.photoUrl}
              alt={spot.title}
              className="h-full w-full object-cover"
              onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }}
            />
          </div>
        ) : (
          <div className="flex items-center justify-center h-20 w-full rounded-lg bg-gray-50 border border-dashed border-gray-200 mb-2">
            <span className="text-xs text-gray-300 italic">No photo</span>
          </div>
        )}
      </div>

      {children}
    </div>
  );
}
