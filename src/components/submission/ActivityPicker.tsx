'use client';

import { SpotType } from '@/components/FilterModal';

interface ActivityPickerProps {
  activities: { name: string; emoji: string; color: string; venueRequired?: boolean }[];
  onSelect: (name: SpotType) => void;
}

export default function ActivityPicker({ activities, onSelect }: ActivityPickerProps) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500 mb-3">What type of activity do you want to add?</p>
      <div className="grid grid-cols-3 gap-2">
        {activities.map((a) => (
          <button
            key={a.name}
            onClick={() => onSelect(a.name)}
            className="flex flex-col items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-2 py-3 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 active:scale-95 touch-manipulation"
          >
            <span className="text-2xl">{a.emoji}</span>
            <span className="text-[11px] font-semibold text-gray-700 text-center leading-tight">
              {a.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
