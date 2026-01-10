'use client';

import { useEffect, useRef } from 'react';

export type SpotType = 
  | 'Christmas Spots'
  | 'Happy Hour'
  | 'Fishing Spots'
  | 'Sunset Spots'
  | 'Pickleball Games'
  | 'Bike Routes'
  | 'Golf Cart Hacks';

// Area type - should match names in data/areas.json
// All areas from areas.json: Daniel Island, Mount Pleasant, Downtown Charleston, Sullivan's Island, Park Circle, North Charleston, West Ashley, James Island
export type Area = 'Daniel Island' | 'Mount Pleasant' | 'James Island' | 'Downtown Charleston' | 'Sullivan\'s Island' | 'Park Circle' | 'North Charleston' | 'West Ashley';

interface FilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedActivity: SpotType | null;
  onActivityChange: (activity: SpotType | null) => void;
}

const ACTIVITIES: SpotType[] = [
  'Christmas Spots',
  'Happy Hour',
  'Fishing Spots',
  'Sunset Spots',
  'Pickleball Games',
  'Bike Routes',
  'Golf Cart Hacks',
];

export default function FilterModal({
  isOpen,
  onClose,
  selectedActivity,
  onActivityChange,
}: FilterModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  // Close on backdrop click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Bottom Sheet */}
      <div
        ref={modalRef}
        className="fixed bottom-0 left-0 right-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-3xl bg-white shadow-2xl safe-area-bottom animate-slide-up"
      >
        {/* Handle */}
        <div className="sticky top-0 z-10 flex justify-center bg-white pt-4 pb-2">
          <div className="h-1 w-12 rounded-full bg-gray-300" />
        </div>

        <div className="px-6 pb-6">
          {/* Header */}
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-800">Select Activity</h2>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-600 transition-colors hover:bg-gray-200"
              aria-label="Close filter"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Activity Selection - Radio Buttons */}
          <div className="mb-6">
            <label className="mb-3 block text-sm font-semibold text-gray-700">
              Activity
            </label>
            <div className="space-y-3">
              {/* All Activities option */}
              <label
                className="flex cursor-pointer items-center rounded-xl border-2 border-gray-200 bg-gray-50 p-4 transition-all hover:border-teal-300 hover:bg-teal-50"
              >
                <input
                  type="radio"
                  name="activity"
                  checked={selectedActivity === null}
                  onChange={() => onActivityChange(null)}
                  className="h-5 w-5 cursor-pointer border-gray-300 text-teal-600 focus:ring-2 focus:ring-teal-500 focus:ring-offset-2"
                />
                <span className="ml-3 text-base font-medium text-gray-800">
                  All Activities
                </span>
              </label>
              {ACTIVITIES.map((activity) => (
                <label
                  key={activity}
                  className="flex cursor-pointer items-center rounded-xl border-2 border-gray-200 bg-gray-50 p-4 transition-all hover:border-teal-300 hover:bg-teal-50"
                >
                  <input
                    type="radio"
                    name="activity"
                    checked={selectedActivity === activity}
                    onChange={() => onActivityChange(activity)}
                    className="h-5 w-5 cursor-pointer border-gray-300 text-teal-600 focus:ring-2 focus:ring-teal-500 focus:ring-offset-2"
                  />
                  <span className="ml-3 text-base font-medium text-gray-800">
                    {activity}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

