'use client';

import { ChevronDown } from 'lucide-react';
import { SpotType } from './FilterModal';

interface ActivityChipProps {
  activity: SpotType;
  spotCount?: number;
  emoji?: string;
  onClick?: () => void;
}

export default function ActivityChip({ activity, spotCount, emoji, onClick }: ActivityChipProps) {
  const Component = onClick ? 'button' : 'div';
  const baseClasses = 'flex w-full items-center justify-center gap-2 rounded-full bg-teal-600 px-4 py-3 min-h-[48px] text-sm font-semibold text-white shadow-lg transition-all hover:bg-teal-700 hover:shadow-xl active:scale-95 touch-manipulation';
  const clickableClasses = onClick ? 'cursor-pointer' : '';

  return (
    <Component
      onClick={onClick}
      className={`${baseClasses} ${clickableClasses}`}
    >
      {emoji && <span className="flex-shrink-0 text-base leading-none">{emoji}</span>}
      <span className="truncate">{activity}</span>
      {spotCount !== undefined && (
        <span className="flex-shrink-0 rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] font-bold leading-none">
          {spotCount}
        </span>
      )}
      {onClick && <ChevronDown className="h-4 w-4 flex-shrink-0 text-teal-200" />}
    </Component>
  );
}
