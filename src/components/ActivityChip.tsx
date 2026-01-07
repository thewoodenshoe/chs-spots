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
  const baseClasses = 'flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5 shadow-md transition-all';
  const clickableClasses = onClick ? 'cursor-pointer hover:shadow-lg active:scale-95 touch-manipulation' : '';

  if (!activity) {
    return (
      <Component
        onClick={onClick}
        className={`${baseClasses} ${clickableClasses} bg-gray-100`}
      >
        <Activity className="h-4 w-4 text-gray-600" />
        <span className="text-xs font-semibold text-gray-700">All Activities</span>
      </Component>
    );
  }

  const Icon = activityIcons[activity];

  return (
    <Component
      onClick={onClick}
      className={`${baseClasses} ${clickableClasses} bg-teal-600`}
    >
      <Icon className="h-4 w-4 text-white" />
      <span className="text-xs font-semibold text-white">{activity}</span>
    </Component>
  );
}

