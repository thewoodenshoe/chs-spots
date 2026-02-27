'use client';

import { useEffect, useRef, useMemo } from 'react';
import { useActivities } from '@/contexts/ActivitiesContext';

export type SpotType = string;
export type Area = string;

interface FilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedActivity: SpotType;
  onActivityChange: (activity: SpotType) => void;
  spotCounts?: Record<string, number>;
}

export interface ActivityGroup {
  label: string;
  activities: string[];
}

export const ACTIVITY_GROUPS: ActivityGroup[] = [
  { label: "What's Happening", activities: ['Happy Hour', 'Brunch', 'Live Music'] },
  { label: 'Explore', activities: ['Coffee Shops', 'Rooftop Bars', 'Dog-Friendly', 'Fishing Spots', 'Landmarks & Attractions'] },
  { label: "What's New", activities: ['Recently Opened', 'Coming Soon'] },
];

export default function FilterModal({
  isOpen,
  onClose,
  selectedActivity,
  onActivityChange,
  spotCounts = {},
}: FilterModalProps) {
  const { activities } = useActivities();
  const modalRef = useRef<HTMLDivElement>(null);

  const activityMap = useMemo(() => {
    const m = new Map<string, typeof activities[0]>();
    activities.forEach(a => m.set(a.name, a));
    return m;
  }, [activities]);

  const visibleGroups = useMemo(() => {
    return ACTIVITY_GROUPS
      .map(group => ({
        ...group,
        activities: group.activities.filter(name => {
          const config = activityMap.get(name);
          if (!config) return false;
          const count = spotCounts[name] ?? 0;
          if (count === 0 && (name === 'Recently Opened' || name === 'Coming Soon')) return false;
          return true;
        }),
      }))
      .filter(group => group.activities.length > 0);
  }, [activityMap, spotCounts]);

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
      <div
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label="Filter activities"
        className="fixed bottom-0 left-0 right-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-3xl bg-white shadow-2xl safe-area-bottom animate-slide-up"
      >
        <div className="sticky top-0 z-10 flex justify-center bg-white pt-4 pb-2">
          <div className="h-1 w-12 rounded-full bg-gray-300" />
        </div>

        <div className="px-6 pb-6">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-800">Select Activity</h2>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-600 transition-colors hover:bg-gray-200"
              aria-label="Close filter"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {visibleGroups.map((group) => (
            <div key={group.label} className="mb-5">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                {group.label}
              </p>
              <div className="space-y-2">
                {group.activities.map((name) => {
                  const config = activityMap.get(name);
                  const isSelected = selectedActivity === name;
                  const count = spotCounts[name] ?? 0;
                  return (
                    <button
                      key={name}
                      onClick={() => { onActivityChange(name); onClose(); }}
                      className={`flex w-full cursor-pointer items-center rounded-xl border-2 p-3.5 transition-all ${
                        isSelected
                          ? 'border-teal-500 bg-teal-50'
                          : 'border-gray-200 bg-gray-50 hover:border-teal-300 hover:bg-teal-50/50'
                      }`}
                    >
                      <span
                        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-lg"
                        style={{ backgroundColor: `${config?.color || '#6366f1'}18` }}
                      >
                        {config?.emoji || '⭐'}
                      </span>
                      <span className="ml-3 flex-1 text-left text-base font-medium text-gray-800">
                        {name}
                      </span>
                      <span className="ml-2 flex-shrink-0 rounded-full bg-gray-200/80 px-2 py-0.5 text-xs font-semibold text-gray-500">
                        {count}
                      </span>
                      {isSelected && (
                        <svg xmlns="http://www.w3.org/2000/svg" className="ml-2 h-5 w-5 flex-shrink-0 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

