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

export type Area = 'Daniel Island' | 'Mount Pleasant' | 'Downtown Charleston' | 'Sullivan\'s Island';

interface FilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedArea: Area;
  onAreaChange: (area: Area) => void;
  selectedTypes: SpotType[];
  onTypesChange: (types: SpotType[]) => void;
}

const AREAS: Area[] = ['Daniel Island', 'Mount Pleasant', 'Downtown Charleston', 'Sullivan\'s Island'];

const SPOT_TYPES: SpotType[] = [
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
  selectedArea,
  onAreaChange,
  selectedTypes,
  onTypesChange,
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

  const handleTypeToggle = (type: SpotType) => {
    if (selectedTypes.includes(type)) {
      onTypesChange(selectedTypes.filter((t) => t !== type));
    } else {
      onTypesChange([...selectedTypes, type]);
    }
  };

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
            <h2 className="text-2xl font-bold text-gray-800">Filter Spots</h2>
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

          {/* Area Dropdown */}
          <div className="mb-8">
            <label className="mb-3 block text-sm font-semibold text-gray-700">
              Area
            </label>
            <select
              value={selectedArea}
              onChange={(e) => onAreaChange(e.target.value as Area)}
              className="w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-base text-gray-800 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
            >
              {AREAS.map((area) => (
                <option key={area} value={area}>
                  {area}
                </option>
              ))}
            </select>
          </div>

          {/* Spot Types */}
          <div className="mb-6">
            <label className="mb-3 block text-sm font-semibold text-gray-700">
              Types
            </label>
            <div className="space-y-3">
              {SPOT_TYPES.map((type) => (
                <label
                  key={type}
                  className="flex cursor-pointer items-center rounded-xl border-2 border-gray-200 bg-gray-50 p-4 transition-all hover:border-teal-300 hover:bg-teal-50"
                >
                  <input
                    type="checkbox"
                    checked={selectedTypes.includes(type)}
                    onChange={() => handleTypeToggle(type)}
                    className="h-5 w-5 cursor-pointer rounded border-gray-300 text-teal-600 focus:ring-2 focus:ring-teal-500 focus:ring-offset-2"
                  />
                  <span className="ml-3 text-base font-medium text-gray-800">
                    {type}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Clear Filters Button */}
          {selectedTypes.length > 0 && (
            <button
              onClick={() => onTypesChange([])}
              className="w-full rounded-xl border-2 border-gray-300 bg-white px-4 py-3 text-base font-semibold text-gray-700 transition-colors hover:bg-gray-50"
            >
              Clear All Filters
            </button>
          )}
        </div>
      </div>
    </>
  );
}

