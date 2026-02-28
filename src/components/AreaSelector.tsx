'use client';

import { useState, useRef, useEffect } from 'react';
import { Area } from './FilterModal';
import { ChevronDown } from 'lucide-react';

export const NEAR_ME = 'Near Me';

interface AreaSelectorProps {
  selectedArea: Area;
  onAreaChange: (area: Area) => void;
  onMapRecenter?: (area: Area) => void;
  hasUserLocation?: boolean;
}

// Area center coordinates for map recentering - loaded from areas.json
let areaCentersCache: Record<string, { lat: number; lng: number; zoom: number }> | null = null;
let areaDescriptionsCache: Record<string, string> | null = null;

async function loadAreaCenters(): Promise<Record<string, { lat: number; lng: number; zoom: number }>> {
  if (areaCentersCache) {
    return areaCentersCache;
  }
  
  try {
    const response = await fetch('/api/areas/config');
    const areasConfig = await response.json();
    
    const centers: Record<string, { lat: number; lng: number; zoom: number }> = {};
    const descriptions: Record<string, string> = {};
    areasConfig.forEach((area: { name: string; description?: string; center: { lat: number; lng: number } }) => {
      centers[area.name] = {
        lat: area.center.lat,
        lng: area.center.lng,
        zoom: 14,
      };
      if (area.description) descriptions[area.name] = area.description;
    });
    
    areaCentersCache = centers;
    areaDescriptionsCache = descriptions;
    return centers;
  } catch (error) {
    console.error('Error loading area centers:', error);
    return {
      'Daniel Island': { lat: 32.862, lng: -79.908, zoom: 14 },
      'Mount Pleasant': { lat: 32.800, lng: -79.860, zoom: 14 },
      'James Island': { lat: 32.720, lng: -79.950, zoom: 14 },
      'Downtown Charleston': { lat: 32.776, lng: -79.931, zoom: 15 },
      'Sullivan\'s & IOP': { lat: 32.773, lng: -79.818, zoom: 14 },
    };
  }
}

export default function AreaSelector({ selectedArea, onAreaChange, onMapRecenter, hasUserLocation }: AreaSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [areas, setAreas] = useState<Area[]>([]);
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function fetchAreas() {
      try {
        const response = await fetch('/api/areas');
        if (response.ok) {
          const areaNames = await response.json();
          setAreas(areaNames as Area[]);
        } else {
          setAreas(['Daniel Island', 'Mount Pleasant', 'James Island', 'Downtown Charleston', 'Sullivan\'s & IOP']);
        }
      } catch {
        setAreas(['Daniel Island', 'Mount Pleasant', 'James Island', 'Downtown Charleston', 'Sullivan\'s & IOP']);
      } finally {
        setIsLoading(false);
      }
    }
    
    async function fetchDescriptions() {
      await loadAreaCenters();
      if (areaDescriptionsCache) setDescriptions(areaDescriptionsCache);
    }

    fetchAreas();
    fetchDescriptions();
  }, []);

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
        className="flex w-full items-center justify-center gap-2 rounded-full bg-gray-800 px-4 py-2 min-h-[40px] text-sm font-semibold text-white shadow-lg transition-all hover:bg-gray-700 hover:shadow-xl active:scale-95 touch-manipulation focus:outline-none focus:ring-2 focus:ring-gray-500/50"
        aria-label="Select area"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 flex-shrink-0 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <span className="truncate">{selectedArea}</span>
        <ChevronDown className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute left-0 right-0 top-full z-50 mt-2 w-full rounded-xl bg-white shadow-2xl sm:w-56 max-h-[60vh] overflow-y-auto overscroll-contain">
            <div className="py-2">
              {isLoading ? (
                <div className="px-4 py-3 text-sm text-gray-500">Loading areas...</div>
              ) : areas.length === 0 ? (
                <div className="px-4 py-3 text-sm text-gray-500">No areas available</div>
              ) : (
                <>
                  {(hasUserLocation || selectedArea === NEAR_ME) && (
                    <>
                      <button
                        onClick={() => handleAreaSelect(NEAR_ME as Area)}
                        className={`w-full px-4 py-3 text-left text-sm font-medium transition-colors min-h-[44px] touch-manipulation flex items-center gap-2 ${
                          selectedArea === NEAR_ME
                            ? 'bg-teal-50 text-teal-700'
                            : 'text-gray-800 hover:bg-gray-50'
                        }`}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-teal-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        Near Me
                      </button>
                      <div className="mx-3 border-t border-gray-100" />
                    </>
                  )}
                  {areas.map((area) => (
                    <button
                      key={area}
                      onClick={() => handleAreaSelect(area)}
                      className={`w-full px-4 py-2.5 text-left transition-colors min-h-[44px] touch-manipulation ${
                        area === selectedArea
                          ? 'bg-teal-50 text-teal-700'
                          : 'text-gray-800 hover:bg-gray-50'
                      }`}
                    >
                      <span className="block text-sm font-medium">{area}</span>
                      {descriptions[area] && (
                        <span className="block text-[11px] leading-tight text-gray-400 mt-0.5">{descriptions[area]}</span>
                      )}
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Export function to get area centers (async, loads from API)
export async function getAreaCenters(): Promise<Record<string, { lat: number; lng: number; zoom: number }>> {
  return await loadAreaCenters();
}

// Export synchronous getter for backward compatibility (returns cached or default)
export function getAreaCentersSync(): Record<string, { lat: number; lng: number; zoom: number }> {
  if (areaCentersCache) {
    return areaCentersCache;
  }
  // Return default if not loaded yet
  return {
    'Daniel Island': { lat: 32.862, lng: -79.908, zoom: 14 },
    'Downtown Charleston': { lat: 32.776, lng: -79.931, zoom: 15 },
    'James Island': { lat: 32.737, lng: -79.965, zoom: 14 },
    'Mount Pleasant': { lat: 32.795, lng: -79.875, zoom: 14 },
    'North Charleston': { lat: 32.888, lng: -80.006, zoom: 14 },
    'Sullivan\'s & IOP': { lat: 32.773, lng: -79.818, zoom: 14 },
    'West Ashley': { lat: 32.785, lng: -80.040, zoom: 14 },
  };
}

// For backward compatibility, export areaCenters as a getter
export const areaCenters = new Proxy({} as Record<string, { lat: number; lng: number; zoom: number }>, {
  get(target, prop) {
    const sync = getAreaCentersSync();
    return sync[prop as string] || sync['Downtown Charleston'];
  },
});

