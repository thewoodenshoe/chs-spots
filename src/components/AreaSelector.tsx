'use client';

import { useState, useRef, useEffect } from 'react';
import { Area } from './FilterModal';
import { ChevronDown } from 'lucide-react';

interface AreaSelectorProps {
  selectedArea: Area;
  onAreaChange: (area: Area) => void;
  onMapRecenter?: (area: Area) => void;
}

const AREAS: Area[] = ['Daniel Island', 'Mount Pleasant', 'James Island', 'Downtown Charleston', 'Sullivan\'s Island'];

// Area center coordinates for map recentering
const areaCenters: Record<Area, { lat: number; lng: number; zoom: number }> = {
  'Daniel Island': { lat: 32.845, lng: -79.908, zoom: 14 },
  'Mount Pleasant': { lat: 32.800, lng: -79.860, zoom: 14 },
  'James Island': { lat: 32.720, lng: -79.950, zoom: 14 },
  'Downtown Charleston': { lat: 32.776, lng: -79.931, zoom: 15 },
  'Sullivan\'s Island': { lat: 32.760, lng: -79.840, zoom: 14 },
};

export default function AreaSelector({ selectedArea, onAreaChange, onMapRecenter }: AreaSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleAreaSelect = (area: Area) => {
    onAreaChange(area);
    setIsOpen(false);
    if (onMapRecenter) {
      onMapRecenter(area);
    }
  };

  return (
    <div className="relative w-full" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition-all hover:bg-teal-700 hover:shadow-lg"
        aria-label="Select area"
      >
        <span>{selectedArea}</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-xl bg-white shadow-2xl">
            <div className="py-2">
              {AREAS.map((area) => (
                <button
                  key={area}
                  onClick={() => handleAreaSelect(area)}
                  className={`w-full px-4 py-3 text-left text-sm font-medium transition-colors ${
                    area === selectedArea
                      ? 'bg-teal-50 text-teal-700'
                      : 'text-gray-800 hover:bg-gray-50'
                  }`}
                >
                  {area}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export { areaCenters };

