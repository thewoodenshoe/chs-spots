'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect, useMemo } from 'react';
import FilterModal, { Area, SpotType } from '@/components/FilterModal';
import SubmissionModal from '@/components/SubmissionModal';
import EditSpotModal from '@/components/EditSpotModal';
import AreaSelector, { getAreaCentersSync } from '@/components/AreaSelector';
import ActivityChip from '@/components/ActivityChip';
import { useSpots, Spot } from '@/contexts/SpotsContext';
import VenuesToggle from '@/components/VenuesToggle';
import { useToast } from '@/components/Toast';
import { trackAreaView, trackSpotClick, trackSpotSubmit, trackActivityFilter, trackVenueToggle } from '@/lib/analytics';

const MAX_UPLOAD_BYTES = 700 * 1024;
const MAX_IMAGE_DIMENSION = 1600;
const JPEG_QUALITIES = [0.82, 0.72, 0.62, 0.52, 0.42];

function dataUrlSizeBytes(dataUrl: string): number {
  const base64 = dataUrl.split(',')[1] || '';
  const padding = (base64.match(/=*$/)?.[0].length || 0);
  return (base64.length * 3) / 4 - padding;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image'));
    };
    image.src = objectUrl;
  });
}

async function compressImageForUpload(file: File): Promise<string> {
  const originalDataUrl = await readFileAsDataUrl(file);
  if (dataUrlSizeBytes(originalDataUrl) <= MAX_UPLOAD_BYTES) {
    return originalDataUrl;
  }

  const image = await loadImageFromFile(file);
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    return originalDataUrl;
  }
  context.drawImage(image, 0, 0, width, height);

  for (const quality of JPEG_QUALITIES) {
    const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
    if (dataUrlSizeBytes(compressedDataUrl) <= MAX_UPLOAD_BYTES) {
      return compressedDataUrl;
    }
  }

  throw new Error('Image is too large. Please choose a smaller photo.');
}

// Dynamically import MapComponent to avoid SSR issues with Google Maps
const MapComponent = dynamic(() => import('@/components/MapComponent'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-gray-50">
      <div className="text-lg text-gray-600">Loading map...</div>
    </div>
  ),
});

export default function Home() {
  const { spots, addSpot, updateSpot, deleteSpot } = useSpots();
  const { showToast } = useToast();
  const [healthStatus, setHealthStatus] = useState<'checking' | 'ok' | 'error'>('checking');
  const [isHydrated, setIsHydrated] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isSubmissionOpen, setIsSubmissionOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selectedArea, setSelectedArea] = useState<Area>('Daniel Island');
  const [selectedActivity, setSelectedActivity] = useState<SpotType>('Happy Hour');
  const [pinLocation, setPinLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [editingSpot, setEditingSpot] = useState<Spot | null>(null);
  const [editPinLocation, setEditPinLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [showAllVenues, setShowAllVenues] = useState(false);
  // Default center for Daniel Island (will be updated when area centers load)
  const defaultCenter = { lat: 32.845, lng: -79.908, zoom: 14 };
  const [mapCenter, setMapCenter] = useState(defaultCenter);
  const [areaCenters, setAreaCenters] = useState<Record<string, { lat: number; lng: number; zoom: number }>>({});

  // Escape key closes modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isEditOpen) {
          setIsEditOpen(false);
          setEditingSpot(null);
          setEditPinLocation(null);
        } else if (isSubmissionOpen) {
          setIsSubmissionOpen(false);
        } else if (isFilterOpen) {
          setIsFilterOpen(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isEditOpen, isSubmissionOpen, isFilterOpen]);

  // Load area centers on mount
  useEffect(() => {
    async function loadCenters() {
      try {
        const response = await fetch('/api/areas/config');
        if (response.ok) {
          const areasConfig = await response.json();
          const centers: Record<string, { lat: number; lng: number; zoom: number }> = {};
          areasConfig.forEach((area: { name: string; center: { lat: number; lng: number } }) => {
            centers[area.name] = {
              lat: area.center.lat,
              lng: area.center.lng,
              zoom: 14,
            };
          });
          setAreaCenters(centers);
        }
      } catch (error) {
        console.error('Error loading area centers:', error);
        // Fallback to sync version
        const syncCenters = getAreaCentersSync();
        setAreaCenters(syncCenters);
      }
    }
    loadCenters();
  }, []); // Only load once on mount

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  // Lightweight health polling for a visible uptime indicator
  useEffect(() => {
    let isMounted = true;

    const checkHealth = async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch('/api/health', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!isMounted) return;
        setHealthStatus(response.ok ? 'ok' : 'error');
      } catch {
        if (!isMounted) return;
        setHealthStatus('error');
      } finally {
        clearTimeout(timeoutId);
      }
    };

    checkHealth();
    const intervalId = window.setInterval(checkHealth, 60000);
    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  // Update map center when selectedArea changes
  useEffect(() => {
    const centers = Object.keys(areaCenters).length > 0 ? areaCenters : getAreaCentersSync();
    if (centers[selectedArea]) {
       
      setMapCenter(centers[selectedArea]);
    }
  }, [selectedArea, areaCenters]);

  const handleAddSpot = () => {
    setIsSubmissionOpen(true);
    setPinLocation(null); // Reset pin location when opening
  };

  const handleFilter = () => {
    setIsFilterOpen(true);
  };

  const handleAreaChange = (area: Area) => {
    setSelectedArea(area);
    trackAreaView(area);
    // Use loaded area centers or fallback to sync version
    const centers = Object.keys(areaCenters).length > 0 ? areaCenters : getAreaCentersSync();
    if (centers[area]) {
      setMapCenter(centers[area]);
    } else {
      // Fallback to default
      setMapCenter(defaultCenter);
    }
  };

  const handleMapClick = (lat: number, lng: number) => {
    if (isSubmissionOpen) {
      setPinLocation({ lat, lng });
    } else if (isEditOpen) {
      setEditPinLocation({ lat, lng });
    }
  };

  const handleEditSpot = (spot: Spot) => {
    trackSpotClick(spot.id, spot.title, selectedArea);
    setEditingSpot(spot);
    setEditPinLocation({ lat: spot.lat, lng: spot.lng });
    setIsEditOpen(true);
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
        photoUrl = await compressImageForUpload(data.photo);
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
      trackSpotSubmit(selectedArea, data.type);
      showToast('Spot submitted! Pending approval.', 'success');
    } catch (error) {
      console.error('Error submitting spot:', error);
      const message = error instanceof Error ? error.message : 'Failed to submit spot. Please try again.';
      showToast(message, 'error');
    }
  };

  const handleEditSubmit = async (data: {
    id: number;
    title: string;
    description: string;
    type: SpotType;
    lat: number;
    lng: number;
    photoUrl?: string;
    photo?: File;
  }) => {
    console.log('Spot update:', data);
    
    try {
      // Convert photo file to data URL if provided
      let photoUrl: string | undefined = data.photoUrl;
      if (data.photo) {
        photoUrl = await compressImageForUpload(data.photo);
      }
      
      // Call API to update spot
      await updateSpot({
        id: data.id,
        lat: data.lat,
        lng: data.lng,
        title: data.title,
        description: data.description,
        type: data.type,
        photoUrl, // Optional - will be undefined if no photo
      });
      
      // Clear form and close modal
      setEditPinLocation(null);
      setEditingSpot(null);
      setIsEditOpen(false);
    } catch (error) {
      console.error('Error updating spot:', error);
      const message = error instanceof Error ? error.message : 'Failed to update spot. Please try again.';
      showToast(message, 'error');
    }
  };

  const lastUpdatedEST = useMemo(() => {
    const validDates = spots
      .map((spot) => spot.lastUpdateDate)
      .filter((value): value is string => Boolean(value))
      .map((value) => new Date(value))
      .filter((date) => !Number.isNaN(date.getTime()));

    if (validDates.length === 0) {
      return 'N/A';
    }

    const latest = new Date(Math.max(...validDates.map((date) => date.getTime())));
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(latest);

    const get = (type: string) => parts.find((p) => p.type === type)?.value || '00';
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
  }, [spots]);

  const healthIndicator = useMemo(() => {
    if (healthStatus === 'ok') {
      return (
        <span
          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-green-600 text-xs font-bold text-white shadow-sm"
          aria-label="Healthy"
          title="Healthy"
        >
          ✓
        </span>
      );
    }
    if (healthStatus === 'error') {
      return (
        <span
          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-xs font-bold text-white shadow-sm"
          aria-label="Unhealthy"
          title="Unhealthy"
        >
          ✕
        </span>
      );
    }
    return (
      <span
        className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-yellow-500 text-xs font-bold text-black shadow-sm"
        aria-label="Checking status"
        title="Checking status"
      >
        …
      </span>
    );
  }, [healthStatus]);

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      {/* Fixed Top Bar - Redesigned */}
      <div className="fixed top-0 left-0 right-0 z-50 bg-black/70 backdrop-blur-md safe-area-top">
        {/* Title Row */}
        <div className="flex h-14 items-center justify-center px-4">
          <h1 className="text-2xl font-bold text-white drop-shadow-lg tracking-tight">
            Charleston Hotspots
          </h1>
        </div>
        
        {/* Buttons Row - Same size, responsive */}
        <div className="flex flex-col sm:flex-row items-stretch gap-3 px-4 pb-4">
          {/* Area Selector - Equal width */}
          <div className="flex-1 w-full">
            <AreaSelector
              selectedArea={selectedArea}
              onAreaChange={handleAreaChange}
              onMapRecenter={handleAreaChange}
            />
          </div>
          
          {/* Activity Chip - Equal width */}
          <div className="flex-1 w-full">
            <ActivityChip activity={selectedActivity} onClick={handleFilter} />
          </div>
        </div>
      </div>

      {/* Full-screen Map */}
      <div 
        className="h-full w-full pb-24"
        style={{ 
          paddingTop: '140px' // Increased to accommodate two-row header
        }}
      >
        <MapComponent
          selectedArea={selectedArea}
          selectedActivity={selectedActivity}
          isSubmissionMode={isSubmissionOpen || isEditOpen}
          pinLocation={isEditOpen ? editPinLocation : pinLocation}
          onMapClick={handleMapClick}
          mapCenter={mapCenter}
          onEditSpot={handleEditSpot}
          showAllVenues={showAllVenues}
        />
      </div>

      {/* Bottom Left Button Group */}
      <div className="fixed bottom-6 left-6 z-40 flex flex-col sm:flex-row gap-3 safe-area-bottom">
        {/* Closest Nearby Button */}
        <button
          onClick={() => {
            // This will be handled in MapComponent
            const event = new CustomEvent('findClosestSpot');
            window.dispatchEvent(event);
          }}
          className="flex min-h-[48px] min-w-[48px] items-center gap-2 rounded-full bg-teal-600 px-4 py-3 text-sm font-semibold text-white shadow-2xl transition-all hover:scale-105 active:scale-95 hover:bg-teal-700 touch-manipulation"
          aria-label="Find closest spot"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          <span className="hidden sm:inline">Closest Nearby</span>
        </button>

        {/* Venues Toggle Button */}
        <VenuesToggle
          showVenues={showAllVenues}
          onToggle={() => {
            const newVal = !showAllVenues;
            setShowAllVenues(newVal);
            trackVenueToggle(newVal);
          }}
        />
      </div>

      {/* Last updated timestamp (centered between venues toggle and add button) */}
      <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full bg-black/70 px-4 py-2 text-xs font-medium text-white backdrop-blur-md safe-area-bottom">
        {isHydrated ? (
          <>
            <span className="mr-2 inline-flex items-center">{healthIndicator}</span>
            <span>last updated: {lastUpdatedEST}</span>
          </>
        ) : (
          <span>last updated: --</span>
        )}
      </div>

      {/* Floating Action Button - Redesigned */}
      <button
        onClick={handleAddSpot}
        className="group fixed bottom-6 right-6 z-40 flex h-16 w-16 min-h-[64px] min-w-[64px] items-center justify-center rounded-full bg-teal-500 shadow-2xl transition-all hover:scale-110 active:scale-95 hover:bg-teal-600 safe-area-bottom touch-manipulation"
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
        {/* Desktop hover label */}
        <span className="absolute right-full mr-4 hidden whitespace-nowrap rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
          Add Spot
        </span>
      </button>

      {/* Filter Modal */}
      <FilterModal
        isOpen={isFilterOpen}
        onClose={() => setIsFilterOpen(false)}
        selectedActivity={selectedActivity}
        onActivityChange={(activity: SpotType) => {
          setSelectedActivity(activity);
          trackActivityFilter(activity);
        }}
      />

      {/* Submission Modal - Bottom Sheet */}
      <SubmissionModal
        isOpen={isSubmissionOpen}
        onClose={() => {
          setIsSubmissionOpen(false);
          // Don't reset pin location - preserve it for next time
        }}
        pinLocation={pinLocation}
        defaultActivity={selectedActivity}
        area={selectedArea}
        onSubmit={handleSubmissionSubmit}
      />

      {/* Edit Spot Modal - Bottom Sheet */}
      <EditSpotModal
        isOpen={isEditOpen}
        onClose={() => {
          setIsEditOpen(false);
          setEditingSpot(null);
          setEditPinLocation(null);
        }}
        spot={editingSpot}
        pinLocation={editPinLocation}
        onMapClick={handleMapClick}
        onSubmit={handleEditSubmit}
        onDelete={async (id: number) => {
          try {
            await deleteSpot(id);
            setEditingSpot(null);
            setEditPinLocation(null);
            setIsEditOpen(false);
          } catch (error) {
            console.error('Error deleting spot:', error);
            throw error;
          }
        }}
      />
    </div>
  );
}