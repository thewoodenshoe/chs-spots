'use client';

import { useState } from 'react';
import { VenueSearchResult } from '@/hooks/useSpotFiltering';
import { OperatingHours } from '@/contexts/VenuesContext';
import { getOpenStatus } from '@/utils/active-status';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const DAY_LABELS: Record<string, string> = {
  sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat',
};

function formatTime12(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m ? `${h12}:${String(m).padStart(2, '0')}${ampm}` : `${h12}${ampm}`;
}

function formatFullWeekHours(hours: OperatingHours | null): { day: string; hours: string; isToday: boolean }[] {
  if (!hours) return [];
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const todayIdx = now.getDay();
  return DAY_KEYS.map((key, idx) => {
    const entry = hours[key];
    const h = !entry || entry === 'closed' ? 'Closed' : `${formatTime12(entry.open)} - ${formatTime12(entry.close)}`;
    return { day: DAY_LABELS[key], hours: h, isToday: idx === todayIdx };
  });
}

const ACTIVITY_COLORS: Record<string, string> = {
  'Happy Hour': '#0d9488',
  'Brunch': '#d97706',
  'Live Music': '#e11d48',
  'Coffee Shops': '#92400e',
  'Rooftop Bars': '#be185d',
  'Dog-Friendly': '#16a34a',
  'Landmarks & Attractions': '#8b5cf6',
};

interface VenueCardProps {
  result: VenueSearchResult;
  isExpanded: boolean;
  onToggle: () => void;
}

export default function VenueCard({ result, isExpanded, onToggle }: VenueCardProps) {
  const { venue, distance, activityTypes } = result;
  const openStatus = getOpenStatus(venue.operatingHours);

  return (
    <div className="rounded-xl bg-white shadow-sm border border-gray-100">
      <button
        onClick={onToggle}
        className="flex w-full items-start gap-3 p-3 text-left"
      >
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-lg">
          📍
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-900 text-sm truncate">{venue.name}</span>
            {venue.area && (
              <span className="flex-shrink-0 rounded-full bg-teal-50 px-1.5 py-0.5 text-[10px] font-medium text-teal-600">
                {venue.area}
              </span>
            )}
          </div>
          {venue.address && (
            <p className="mt-0.5 text-xs text-gray-400 truncate">
              {venue.address.replace(/, United States$/, '').replace(/, USA$/, '')}
            </p>
          )}
          {activityTypes.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {activityTypes.map(type => (
                <span
                  key={type}
                  className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold text-white"
                  style={{ backgroundColor: ACTIVITY_COLORS[type] || '#6366f1' }}
                >
                  {type}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          {openStatus && openStatus.label && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${
              openStatus.isOpen ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'
            }`}>
              {openStatus.label === 'Closing soon'
                ? `Closes ${openStatus.closesAt}`
                : openStatus.isOpen ? `Open til ${openStatus.closesAt}` : 'Closed'}
            </span>
          )}
          {distance !== null && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600 whitespace-nowrap">
              {distance < 0.1 ? '<0.1 mi' : distance < 10 ? `${distance.toFixed(1)} mi` : `${Math.round(distance)} mi`}
            </span>
          )}
          <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-gray-100 px-4 pb-3 pt-2 space-y-2">
          {venue.phone && (
            <a
              href={`tel:${venue.phone}`}
              className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-teal-700 transition-colors"
            >
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
              <span className="leading-snug">{venue.address.replace(/, United States$/, '').replace(/, USA$/, '')}</span>
            </a>
          )}
          {venue.website && (
            <a
              href={venue.website}
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
          {venue.operatingHours && (
            <div className="pt-1">
              <div className="text-xs font-bold text-gray-700 mb-0.5">Opening Hours</div>
              {formatFullWeekHours(venue.operatingHours).map(({ day, hours: h, isToday }) => (
                <div key={day} className={`text-xs leading-snug flex gap-2 ${isToday ? 'text-gray-900 font-semibold' : 'text-gray-500'}`}>
                  <span className="w-8">{day}</span>
                  <span>{h}</span>
                </div>
              ))}
            </div>
          )}
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${venue.lat},${venue.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 transition-colors mt-1"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Directions
          </a>
        </div>
      )}
    </div>
  );
}
