'use client';

import { useEffect, useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Martini, ChevronDown } from 'lucide-react';

// Dynamically import the map component to avoid SSR issues
const MapComponent = dynamic(() => import('@/components/Map'), { ssr: false });

interface Spot {
  title: string;
  lat: number;
  lng: number;
  description?: string;
  activity?: string;
  area?: string;
}

export default function Home() {
  const [spots, setSpots] = useState<Spot[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedArea, setSelectedArea] = useState<string>('Daniel Island');
  const [selectedActivity, setSelectedActivity] = useState<string>('Happy Hour');

  useEffect(() => {
    fetch('/api/spots')
      .then((res) => res.json())
      .then((data) => {
        setSpots(data);
        setLoading(false);
        
        // Auto-select first area if available
        if (data.length > 0) {
          const uniqueAreas = Array.from(new Set(data.map((spot: Spot) => spot.area).filter(Boolean))).sort();
          if (uniqueAreas.length > 0 && !selectedArea) {
            setSelectedArea(uniqueAreas[0] as string);
          }
        }
      })
      .catch((err) => {
        console.error('Error loading spots:', err);
        setLoading(false);
      });
  }, []);

  // Extract unique areas and activities
  const areas = useMemo(() => {
    const areaSet = new Set<string>();
    spots.forEach(spot => {
      if (spot.area) areaSet.add(spot.area);
    });
    const sortedAreas = Array.from(areaSet).sort();
    // Ensure Daniel Island is first if it exists
    if (sortedAreas.includes('Daniel Island')) {
      return ['Daniel Island', ...sortedAreas.filter(a => a !== 'Daniel Island')];
    }
    return sortedAreas;
  }, [spots]);

  const activities = useMemo(() => {
    const activitySet = new Set<string>();
    spots.forEach(spot => {
      if (spot.activity) activitySet.add(spot.activity);
    });
    return Array.from(activitySet).sort();
  }, [spots]);

  const handleAreaChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedArea(e.target.value);
  };

  return (
    <div className="h-screen w-screen flex flex-col">
      {/* Header: Dark semi-transparent background */}
      <div className="fixed top-0 left-0 right-0 z-50 bg-black/70 backdrop-blur-md safe-area-top">
        {/* Title Row */}
        <div className="flex h-14 items-center justify-center px-4">
          <h1 className="text-2xl font-bold text-white drop-shadow-lg tracking-tight">
            Charleston Hotspots
          </h1>
        </div>

        {/* Selectors Row - Responsive: stacked on small, side-by-side on sm+ */}
        <div className="flex flex-col sm:flex-row items-stretch gap-3 px-4 pb-4">
          {/* Area Selector - Teal Pill */}
          <div className="flex-1">
            <div className="relative w-full">
              <select
                value={selectedArea}
                onChange={handleAreaChange}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-teal-600 px-4 py-3 min-h-[48px] text-sm font-semibold text-white shadow-lg transition-all hover:bg-teal-700 hover:shadow-xl active:scale-95 touch-manipulation appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-teal-500/50"
                aria-label="Select area"
              >
                {areas.map((area) => (
                  <option key={area} value={area}>
                    {area}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-white">
                <ChevronDown className="h-4 w-4" />
              </div>
            </div>
          </div>

          {/* Activity Badge - Teal Pill with Icon */}
          <div className="flex-1">
            <div className="flex w-full items-center justify-center gap-2 rounded-full bg-teal-600 px-4 py-3 min-h-[48px] text-sm font-semibold text-white shadow-lg">
              <Martini className="h-5 w-5" />
              <span>{selectedActivity || 'Happy Hour'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Map Container - Add padding top for fixed header */}
      <div className="flex-1 relative pt-[140px] sm:pt-[140px]">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-lg text-gray-600">Loading spots...</p>
          </div>
        ) : (
          <MapComponent 
            spots={spots} 
            selectedArea={selectedArea || undefined}
            selectedActivity={selectedActivity || undefined}
          />
        )}
      </div>
    </div>
  );
}
