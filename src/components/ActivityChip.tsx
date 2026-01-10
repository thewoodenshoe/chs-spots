'use client';

import { SpotType } from './FilterModal';
import { Martini, Fish, Sunset, Gift, Activity, Bike, Car } from 'lucide-react';

interface ActivityChipProps {
  activity: SpotType | null;
  onClick?: () => void;
}

const activityIcons: Record<SpotType, typeof Martini> = {
  'Christmas Spots': Gift,
  'Happy Hour': Martini,
  'Fishing Spots': Fish,
  'Sunset Spots': Sunset,
  'Pickleball Games': Activity,
  'Bike Routes': Bike,
  'Golf Cart Hacks': Car,
};

export default function ActivityChip({ activity, onClick }: ActivityChipProps) {
  const Component = onClick ? 'button' : 'div';
  const baseClasses = 'flex w-full items-center justify-center gap-2 rounded-full bg-teal-600 px-4 py-3 min-h-[48px] text-sm font-semibold text-white shadow-lg transition-all hover:bg-teal-700 hover:shadow-xl active:scale-95 touch-manipulation';
  const clickableClasses = onClick ? 'cursor-pointer' : '';

  if (!activity) {
    return (
      <Component
        onClick={onClick}
        className={`${baseClasses} ${clickableClasses} bg-gray-100 text-gray-700 hover:bg-gray-200`}
      >
        <Activity className="h-5 w-5" />
        <span>All Activities</span>
      </Component>
    );
  }

  const Icon = activityIcons[activity];

  return (
    <Component
      onClick={onClick}
      className={`${baseClasses} ${clickableClasses}`}
    >
      <Icon className="h-5 w-5" />
      <span>{activity}</span>
    </Component>
  );
}

