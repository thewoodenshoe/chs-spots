'use client';

import { useState, useRef, useEffect } from 'react';
import { Area } from './FilterModal';
import { ChevronDown } from 'lucide-react';

interface AreaSelectorProps {
  selectedArea: Area;
  onAreaChange: (area: Area) => void;
  onMapRecenter?: (area: Area) => void;
}

// Area center coordinates for map recentering - loaded from areas.json
let areaCentersCache: Record<string, { lat: number; lng: number; zoom: number }> | null = null;

async function loadAreaCenters(): Promise<Record<string, { lat: number; lng: number; zoom: number }>> {
  if (areaCentersCache) {
    return areaCentersCache;
  }
  
  try {
    const response = await fetch('/api/areas/config');
    const areasConfig = await response.json();
    
    const centers: Record<string, { lat: number; lng: number; zoom: number }> = {};
    areasConfig.forEach((area: any) => {
      centers[area.name] = {
        lat: area.center.lat,
        lng: area.center.lng,
        zoom: 14, // Default zoom, can be made configurable in areas.json if needed
      };
    });
    
    areaCentersCache = centers;
    return centers;
  } catch (error) {
    console.error('Error loading area centers:', error);
    // Fallback to hardcoded values if API fails
    return {
      'Daniel Island': { lat: 32.845, lng: -79.908, zoom: 14 },
      'Mount Pleasant': { lat: 32.800, lng: -79.860, zoom: 14 },
      'James Island': { lat: 32.720, lng: -79.950, zoom: 14 },
      'Downtown Charleston': { lat: 32.776, lng: -79.931, zoom: 15 },
      'Sullivan\'s Island': { lat: 32.760, lng: -79.840, zoom: 14 },
    };
  }
}

export default function AreaSelector({ selectedArea, onAreaChange, onMapRecenter }: AreaSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [areas, setAreas] = useState<Area[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load areas from API on component mount
  useEffect(() => {
    async function fetchAreas() {
      try {
        const response = await fetch('/api/areas');
        if (response.ok) {
          const areaNames = await response.json();
          setAreas(areaNames as Area[]);
        } else {
          console.error('Failed to fetch areas');
          // Fallback to default areas
          setAreas(['Daniel Island', 'Mount Pleasant', 'James Island', 'Downtown Charleston', 'Sullivan\'s Island']);
        }
      } catch (error) {
        console.error('Error fetching areas:', error);
        // Fallback to default areas
        setAreas(['Daniel Island', 'Mount Pleasant', 'James Island', 'Downtown Charleston', 'Sullivan\'s Island']);
      } finally {
        setIsLoading(false);
      }
    }
    
    fetchAreas();
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
        className="flex w-full items-center justify-center gap-2 rounded-full bg-teal-600 px-4 py-3 min-h-[48px] text-sm font-semibold text-white shadow-lg transition-all hover:bg-teal-700 hover:shadow-xl active:scale-95 touch-manipulation focus:outline-none focus:ring-2 focus:ring-teal-500/50"
        aria-label="Select area"
      >
        <span>{selectedArea}</span>
        <ChevronDown className={`h-5 w-5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute left-0 right-0 top-full z-50 mt-2 w-full rounded-xl bg-white shadow-2xl sm:w-56">
            <div className="py-2">
              {isLoading ? (
                <div className="px-4 py-3 text-sm text-gray-500">Loading areas...</div>
              ) : areas.length === 0 ? (
                <div className="px-4 py-3 text-sm text-gray-500">No areas available</div>
              ) : (
                areas.map((area) => (
                  <button
                    key={area}
                    onClick={() => handleAreaSelect(area)}
                    className={`w-full px-4 py-3 text-left text-sm font-medium transition-colors min-h-[44px] touch-manipulation ${
                      area === selectedArea
                        ? 'bg-teal-50 text-teal-700'
                        : 'text-gray-800 hover:bg-gray-50'
                    }`}
                  >
                    {area}
                  </button>
                ))
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
    'Daniel Island': { lat: 32.845, lng: -79.908, zoom: 14 },
    'Mount Pleasant': { lat: 32.800, lng: -79.860, zoom: 14 },
    'James Island': { lat: 32.720, lng: -79.950, zoom: 14 },
    'Downtown Charleston': { lat: 32.776, lng: -79.931, zoom: 15 },
    'Sullivan\'s Island': { lat: 32.760, lng: -79.840, zoom: 14 },
  };
}

// For backward compatibility, export areaCenters as a getter
export const areaCenters = new Proxy({} as Record<string, { lat: number; lng: number; zoom: number }>, {
  get(target, prop) {
    const sync = getAreaCentersSync();
    return sync[prop as string] || sync['Daniel Island'];
  },
});

