'use client';

import { SpotType } from './FilterModal';

interface FilterChipsProps {
  selectedTypes: SpotType[];
  onRemove: (type: SpotType) => void;
}

// Emoji/icons for each spot type
const typeIcons: Record<SpotType, string> = {
  'Christmas Spots': '🎄',
  'Happy Hour': '🍹',
  'Fishing Spots': '🎣',
  'Sunset Spots': '🌅',
  'Pickleball Games': '🏓',
  'Bike Routes': '🚴',
  'Golf Cart Hacks': '🛺',
};

export default function FilterChips({ selectedTypes, onRemove }: FilterChipsProps) {
  if (selectedTypes.length === 0) {
    return null;
  }

  return (
    <div className="flex gap-2 overflow-x-auto px-4 pb-2 scrollbar-hide">
      {selectedTypes.map((type) => (
        <div
          key={type}
          className="flex items-center gap-2 rounded-full bg-white px-4 py-2 shadow-md transition-all hover:shadow-lg"
        >
          <span className="text-base">{typeIcons[type]}</span>
          <span className="text-sm font-medium text-gray-800 whitespace-nowrap">{type}</span>
          <button
            onClick={() => onRemove(type)}
            className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-gray-600 transition-colors hover:bg-gray-200 hover:text-gray-800"
            aria-label={`Remove ${type} filter`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-3 w-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={3}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}

