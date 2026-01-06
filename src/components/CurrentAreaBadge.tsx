'use client';

import { Area } from './FilterModal';

interface CurrentAreaBadgeProps {
  area: Area;
}

export default function CurrentAreaBadge({ area }: CurrentAreaBadgeProps) {
  return (
    <div className="flex items-center justify-center">
      <span className="rounded-full bg-teal-600 px-4 py-1.5 text-sm font-semibold text-white shadow-md">
        {area}
      </span>
    </div>
  );
}

