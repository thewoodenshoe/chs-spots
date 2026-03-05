'use client';

import { HOUR_OPTIONS } from '@/utils/time-utils';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export interface ScheduleData {
  timeStart: string;
  timeEnd: string;
  days: number[];
  specificDate: string;
  deals: string;
}

interface ScheduleFieldsProps {
  schedule: ScheduleData;
  onChange: (update: Partial<ScheduleData>) => void;
}

export default function ScheduleFields({ schedule, onChange }: ScheduleFieldsProps) {
  const toggleDay = (i: number) => {
    const next = schedule.days.includes(i)
      ? schedule.days.filter(d => d !== i)
      : [...schedule.days, i].sort();
    onChange({ days: next });
  };

  return (
    <>
      <div>
        <label className="mb-1 block text-xs font-semibold text-gray-700">Time</label>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="block text-[10px] text-gray-400 mb-0.5">From</label>
            <select
              value={schedule.timeStart}
              onChange={e => onChange({ timeStart: e.target.value })}
              className="w-full rounded-xl border-2 border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
            >
              <option value="">—</option>
              {HOUR_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <span className="text-gray-400 text-xs font-medium pb-3">to</span>
          <div className="flex-1">
            <label className="block text-[10px] text-gray-400 mb-0.5">To</label>
            <select
              value={schedule.timeEnd}
              onChange={e => onChange({ timeEnd: e.target.value })}
              className="w-full rounded-xl border-2 border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
            >
              <option value="">—</option>
              {HOUR_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-semibold text-gray-700">Days</label>
        <div className="flex flex-wrap gap-1.5">
          {DAY_NAMES.map((day, i) => {
            const active = schedule.days.includes(i);
            return (
              <button
                key={day}
                type="button"
                onClick={() => toggleDay(i)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? 'bg-teal-500 text-white'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {day}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-gray-700">
          Specific Date <span className="text-xs font-normal text-gray-400">(one-off events)</span>
        </label>
        <input
          type="date"
          value={schedule.specificDate}
          onChange={e => onChange({ specificDate: e.target.value })}
          className="w-full rounded-xl border-2 border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-gray-700">
          Deals / Specials <span className="text-xs font-normal text-gray-400">(one per line)</span>
        </label>
        <textarea
          value={schedule.deals}
          onChange={e => onChange({ deals: e.target.value })}
          placeholder="e.g., $5 margaritas&#10;Half-price oysters"
          rows={2}
          className="w-full rounded-xl border-2 border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 resize-none"
        />
      </div>
    </>
  );
}
