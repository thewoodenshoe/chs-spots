'use client';

import React from 'react';

interface VenuesToggleProps {
  showVenues: boolean;
  onToggle: () => void;
}

export default function VenuesToggle({ showVenues, onToggle }: VenuesToggleProps) {
  return (
    <button
      onClick={onToggle}
      className={`flex min-h-[48px] min-w-[48px] items-center gap-2 rounded-full px-4 py-3 text-sm font-semibold text-white shadow-2xl transition-all hover:scale-105 active:scale-95 touch-manipulation ${
        showVenues 
          ? 'bg-red-600 hover:bg-red-700' 
          : 'bg-gray-600 hover:bg-gray-700'
      }`}
      aria-label={showVenues ? 'Hide all venues' : 'Show all venues'}
      aria-pressed={showVenues}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.5}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
        />
      </svg>
      <span className="hidden sm:inline">{showVenues ? 'Hide Venues' : 'Show Venues'}</span>
    </button>
  );
}
