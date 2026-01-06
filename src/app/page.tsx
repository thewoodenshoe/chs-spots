'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import FilterModal, { Area, SpotType } from '@/components/FilterModal';
import SubmissionModal from '@/components/SubmissionModal';
import { useSpots } from '@/contexts/SpotsContext';

// Dynamically import MapComponent to avoid SSR issues
const MapComponent = dynamic(() => import('@/components/MapComponent'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-blue-50">
      <div className="text-lg text-blue-600">Loading map...</div>
    </div>
  ),
});

export default function Home() {
  const { addSpot } = useSpots();
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isSubmissionOpen, setIsSubmissionOpen] = useState(false);
  const [selectedArea, setSelectedArea] = useState<Area>('Daniel Island');
  const [selectedTypes, setSelectedTypes] = useState<SpotType[]>([]);
  const [pinLocation, setPinLocation] = useState<{ lat: number; lng: number } | null>(null);

  const handleAddSpot = () => {
    setIsSubmissionOpen(true);
    setPinLocation(null); // Reset pin location when opening
  };

  const handleFilter = () => {
    setIsFilterOpen(true);
  };

  const handleMapClick = (lat: number, lng: number) => {
    if (isSubmissionOpen) {
      setPinLocation({ lat, lng });
    }
  };

  const handleSubmissionSubmit = async (data: {
    title: string;
    description: string;
    type: SpotType;
    lat: number;
    lng: number;
    photo?: File;
  }) => {
    console.log('Spot submission:', data);
    
    try {
      // Convert photo file to data URL if provided
      let photoUrl: string | undefined;
      if (data.photo) {
        photoUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            resolve(reader.result as string);
          };
          reader.readAsDataURL(data.photo!);
        });
      }
      
      // Call API to add spot
      await addSpot({
        lat: data.lat,
        lng: data.lng,
        title: data.title,
        description: data.description,
        type: data.type,
        photoUrl, // Optional - will be undefined if no photo
      });
      
      // Clear form and close modal, but keep marker on map (it's now in the spots array)
      setPinLocation(null);
      setIsSubmissionOpen(false);
    } catch (error) {
      console.error('Error submitting spot:', error);
      alert('Failed to submit spot. Please try again.');
    }
  };

  const activeFiltersCount = selectedTypes.length;

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      {/* Fixed Top Bar */}
      <div className="fixed top-0 left-0 right-0 z-50 flex h-16 items-center justify-between bg-gradient-to-r from-teal-500 to-cyan-500 px-4 shadow-lg safe-area-top">
        <h1 className="text-xl font-bold text-white drop-shadow-md">
          Charleston Local Spots
        </h1>
        <button
          onClick={handleFilter}
          className="relative flex h-10 w-10 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm transition-colors hover:bg-white/30 active:bg-white/40"
          aria-label="Filter spots"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
            />
          </svg>
          {activeFiltersCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white">
              {activeFiltersCount}
            </span>
          )}
        </button>
      </div>

      {/* Full-screen Map */}
      <div className="h-full w-full pt-16 pb-20">
        <MapComponent
          selectedArea={selectedArea}
          selectedTypes={selectedTypes}
          isSubmissionMode={isSubmissionOpen}
          pinLocation={pinLocation}
          onMapClick={handleMapClick}
        />
      </div>

      {/* Floating Action Button */}
      <button
        onClick={handleAddSpot}
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-r from-teal-500 to-cyan-500 shadow-xl transition-all hover:scale-110 active:scale-95 safe-area-bottom"
        aria-label="Add new spot"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-8 w-8 text-white"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={3}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 4v16m8-8H4"
          />
        </svg>
      </button>

      {/* Filter Modal */}
      <FilterModal
        isOpen={isFilterOpen}
        onClose={() => setIsFilterOpen(false)}
        selectedArea={selectedArea}
        onAreaChange={setSelectedArea}
        selectedTypes={selectedTypes}
        onTypesChange={setSelectedTypes}
      />

      {/* Submission Modal - Bottom Sheet */}
      <SubmissionModal
        isOpen={isSubmissionOpen}
        onClose={() => {
          setIsSubmissionOpen(false);
          // Don't reset pin location - preserve it for next time
        }}
        pinLocation={pinLocation}
        onSubmit={handleSubmissionSubmit}
      />
    </div>
  );
}
