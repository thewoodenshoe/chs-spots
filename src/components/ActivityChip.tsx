'use client';

import { SpotType } from './FilterModal';
import { useActivities } from '@/contexts/ActivitiesContext';
import { Martini, Fish, Sunset, Gift, Activity, Bike, Car, Compass, Coffee, Star } from 'lucide-react';

interface ActivityChipProps {
  activity: SpotType;
  onClick?: () => void;
}

const iconMap: Record<string, typeof Martini> = {
  'Martini': Martini,
  'Fish': Fish,
  'Sunset': Sunset,
  'Gift': Gift,
  'Activity': Activity,
  'Bike': Bike,
  'Car': Car,
  'Compass': Compass,
  'Coffee': Coffee,
  'Star': Star,
};

export default function ActivityChip({ activity, onClick }: ActivityChipProps) {
  const { activities } = useActivities();
  const Component = onClick ? 'button' : 'div';
  const baseClasses = 'flex w-full items-center justify-center gap-2 rounded-full bg-teal-600 px-4 py-3 min-h-[48px] text-sm font-semibold text-white shadow-lg transition-all hover:bg-teal-700 hover:shadow-xl active:scale-95 touch-manipulation';
  const clickableClasses = onClick ? 'cursor-pointer' : '';

  // Find activity in config and get its icon
  const activityConfig = activities.find(a => a.name === activity);
  const IconName = activityConfig?.icon || 'Activity';
  const Icon = iconMap[IconName] || Activity;

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

