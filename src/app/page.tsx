'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect, useMemo } from 'react';
import FilterModal, { Area, SpotType } from '@/components/FilterModal';
import SubmissionModal from '@/components/SubmissionModal';
import EditSpotModal from '@/components/EditSpotModal';
import AreaSelector, { getAreaCentersSync } from '@/components/AreaSelector';
import ActivityChip from '@/components/ActivityChip';
import { useSpots, Spot } from '@/contexts/SpotsContext';
// VenuesToggle is now inlined in the footer toolbar
import { useToast } from '@/components/Toast';
import { trackAreaView, trackSpotClick, trackSpotSubmit, trackActivityFilter, trackVenueToggle, trackFeedbackSubmit, trackSearchFilter } from '@/lib/analytics';
import FeedbackModal from '@/components/FeedbackModal';
import AboutModal from '@/components/AboutModal';
import SuggestActivityModal from '@/components/SuggestActivityModal';
import SearchBar from '@/components/SearchBar';
import ReportSpotModal from '@/components/ReportSpotModal';
import ViewToggle from '@/components/ViewToggle';
import SpotListView, { SortMode } from '@/components/SpotListView';
import WelcomeOverlay, { hasSeenWelcome } from '@/components/WelcomeOverlay';
import { useVenues } from '@/contexts/VenuesContext';
import { useActivities } from '@/contexts/ActivitiesContext';

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
  const { spots, addSpot, updateSpot, deleteSpot, loading: spotsLoading } = useSpots();
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
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isSuggestActivityOpen, setIsSuggestActivityOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [reportingSpot, setReportingSpot] = useState<Spot | null>(null);
  const [viewMode, setViewMode] = useState<'map' | 'list'>('map');
  const [listSortMode, setListSortMode] = useState<SortMode>('alpha');
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  // Default center for Daniel Island (will be updated when area centers load)
  const defaultCenter = { lat: 32.862, lng: -79.908, zoom: 14 };
  const [mapCenter, setMapCenter] = useState(defaultCenter);
  const [areaCenters, setAreaCenters] = useState<Record<string, { lat: number; lng: number; zoom: number }>>({});
  const { venues } = useVenues();
  const { activities } = useActivities();

  // Escape key closes modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isReportOpen) {
          setIsReportOpen(false);
          setReportingSpot(null);
        } else if (isAboutOpen) {
          setIsAboutOpen(false);
        } else if (isSuggestActivityOpen) {
          setIsSuggestActivityOpen(false);
        } else if (isFeedbackOpen) {
          setIsFeedbackOpen(false);
        } else if (isEditOpen) {
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
  }, [isReportOpen, isAboutOpen, isSuggestActivityOpen, isFeedbackOpen, isEditOpen, isSubmissionOpen, isFilterOpen]);

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
    if (!hasSeenWelcome()) {
      setViewMode('list');
    }
  }, []);

  // Deep-link: ?spot=123 — navigate to a shared spot
  useEffect(() => {
    if (spotsLoading || spots.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const spotId = params.get('spot');
    if (!spotId) return;

    const spot = spots.find(s => s.id === Number(spotId));
    if (!spot) return;

    const area = spot.area
      || (spot.venueId ? venueAreaById.get(spot.venueId) : undefined)
      || getAreaFromCoordinates(spot.lat, spot.lng);
    setSelectedArea(area as Area);
    setSelectedActivity(spot.type as SpotType);
    setMapCenter({ lat: spot.lat, lng: spot.lng, zoom: 16 });
    setViewMode('map');

    window.history.replaceState({}, '', window.location.pathname);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotsLoading, spots]);

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

  // Request user geolocation (for list view distance badges)
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => { /* denied or error — distance will be unavailable */ }
      );
    }
  }, []);

  // Build venue-area lookup for filtering (mirrors MapComponent logic)
  const venueAreaById = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of venues) {
      if (v.id && v.area) m.set(v.id, v.area);
    }
    return m;
  }, [venues]);

  // Area from coordinates — same bounds as MapComponent
  function getAreaFromCoordinates(lat: number, lng: number): string {
    if (lat >= 32.83 && lat <= 32.86 && lng >= -79.92 && lng <= -79.89) return 'Daniel Island';
    if (lat >= 32.78 && lat <= 32.82 && lng >= -79.88 && lng <= -79.82) return 'Mount Pleasant';
    if (lat >= 32.70 && lat <= 32.75 && lng >= -79.96 && lng <= -79.90) return 'James Island';
    if (lat >= 32.76 && lat <= 32.80 && lng >= -79.95 && lng <= -79.92) return 'Downtown Charleston';
    if (lat >= 32.75 && lat <= 32.78 && lng >= -79.87 && lng <= -79.81) return "Sullivan's Island";
    return 'Daniel Island';
  }

  const filteredSpots = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    return spots.filter((spot) => {
      if (spot.lat === 0 && spot.lng === 0) return false;
      const spotArea = spot.area
        || (spot.venueId ? venueAreaById.get(spot.venueId) : undefined)
        || getAreaFromCoordinates(spot.lat, spot.lng);
      const areaMatch = spotArea === selectedArea;
      const activityMatch = spot.type === selectedActivity;
      const searchMatch = !query || spot.title.toLowerCase().includes(query) || (spot.description || '').toLowerCase().includes(query);
      return areaMatch && activityMatch && searchMatch;
    });
  }, [spots, selectedArea, selectedActivity, venueAreaById, searchQuery]);

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
    setMapCenter({ lat: spot.lat, lng: spot.lng, zoom: 16 });
    setViewMode('map');
    setIsEditOpen(true);
  };

  const handleSubmissionSubmit = async (data: {
    title: string;
    submitterName: string;
    description: string;
    type: SpotType;
    lat: number;
    lng: number;
    photo?: File;
  }) => {
    try {
      let photoUrl: string | undefined;
      if (data.photo) {
        photoUrl = await compressImageForUpload(data.photo);
      }
      
      await addSpot({
        lat: data.lat,
        lng: data.lng,
        title: data.title,
        submitterName: data.submitterName,
        description: data.description,
        type: data.type,
        photoUrl,
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
    try {
      // Convert photo file to data URL if provided
      let photoUrl: string | undefined = data.photoUrl;
      if (data.photo) {
        photoUrl = await compressImageForUpload(data.photo);
      }
      
      // Call API to update spot
      const result = await updateSpot({
        id: data.id,
        lat: data.lat,
        lng: data.lng,
        title: data.title,
        description: data.description,
        type: data.type,
        photoUrl,
      });
      
      // Clear form and close modal
      setEditPinLocation(null);
      setEditingSpot(null);
      setIsEditOpen(false);
      if (result?.pending) {
        showToast('Edit submitted for approval!', 'info');
      } else {
        showToast('Spot updated!', 'success');
      }
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
    <div className="relative h-dvh w-screen overflow-hidden">
      {/* Fixed Top Bar */}
      <div className="fixed top-0 left-0 right-0 z-50 bg-black/70 backdrop-blur-md safe-area-top">
        {/* Title Row */}
        <div className="flex h-12 items-center justify-between px-4">
          <div>
            <h1 className="text-xl font-bold text-white drop-shadow-lg tracking-tight leading-none">
              Charleston Finds
            </h1>
            <p className="text-[10px] text-white/50 leading-tight mt-0.5">Happy hours, brunch & more — updated daily</p>
          </div>
          <div className="flex items-center gap-2">
            <ViewToggle viewMode={viewMode} onChange={setViewMode} />
            <button
              onClick={() => setIsAboutOpen(true)}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-all"
              aria-label="About Charleston Finds"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Search + Filters Row */}
        <div className="flex flex-col gap-2 px-4 pb-3">
          <SearchBar
            value={searchQuery}
            onChange={(v) => {
              setSearchQuery(v);
              if (v.length >= 2) trackSearchFilter(v);
            }}
            placeholder="Search spots..."
          />
          <div className="flex flex-row items-stretch gap-2">
            <div className="flex-1 min-w-0">
              <AreaSelector
                selectedArea={selectedArea}
                onAreaChange={handleAreaChange}
                onMapRecenter={handleAreaChange}
              />
            </div>
            <div className="flex-1 min-w-0">
              <ActivityChip activity={selectedActivity} spotCount={filteredSpots.length} onClick={handleFilter} />
            </div>
          </div>
        </div>
      </div>

      {/* Content area: Map or List */}
      <div 
        className="h-full w-full"
        style={{ paddingTop: '165px', paddingBottom: '72px' }}
      >
        {spotsLoading ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-gray-50">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-teal-500" />
            <p className="text-sm font-medium text-gray-500">Loading spots...</p>
          </div>
        ) : viewMode === 'map' ? (
          <MapComponent
            selectedArea={selectedArea}
            selectedActivity={selectedActivity}
            isSubmissionMode={isSubmissionOpen || isEditOpen}
            pinLocation={isEditOpen ? editPinLocation : pinLocation}
            onMapClick={handleMapClick}
            mapCenter={mapCenter}
            onEditSpot={handleEditSpot}
            onReportSpot={(spot) => {
              setReportingSpot(spot);
              setIsReportOpen(true);
            }}
            showAllVenues={showAllVenues}
            searchQuery={searchQuery}
          />
        ) : (
          <SpotListView
            spots={filteredSpots}
            activities={activities}
            userLocation={userLocation}
            selectedArea={selectedArea}
            selectedActivity={selectedActivity}
            sortMode={listSortMode}
            onSortChange={setListSortMode}
            onSpotSelect={(spot) => {
              setMapCenter({ lat: spot.lat, lng: spot.lng, zoom: 16 });
              setViewMode('map');
            }}
            onEditSpot={handleEditSpot}
            onAddSpot={() => { setViewMode('map'); handleAddSpot(); }}
          />
        )}
      </div>

      {/* Bottom Toolbar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-black/70 backdrop-blur-md safe-area-bottom" data-testid="footer-toolbar">
        <div className="flex h-[60px] items-stretch justify-around px-2">
          {/* Nearby */}
          <button
            onClick={() => {
              if (viewMode === 'list') {
                setListSortMode('nearest');
              } else {
                window.dispatchEvent(new CustomEvent('findClosestSpot'));
              }
            }}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 transition-all active:scale-95 touch-manipulation ${
              viewMode === 'list' && listSortMode === 'nearest'
                ? 'text-teal-400'
                : 'text-white/70 hover:text-white'
            }`}
            aria-label="Find closest spot"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="text-[10px] font-medium leading-tight">Nearby</span>
          </button>

          {/* Venues — only in map mode */}
          {viewMode === 'map' ? (
            <button
              onClick={() => { const v = !showAllVenues; setShowAllVenues(v); trackVenueToggle(v); }}
              className={`flex flex-1 flex-col items-center justify-center gap-0.5 transition-all active:scale-95 touch-manipulation ${showAllVenues ? 'text-red-400' : 'text-white/70 hover:text-white'}`}
              aria-label={showAllVenues ? 'Hide venues' : 'Show venues'}
              aria-pressed={showAllVenues}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              <span className="text-[10px] font-medium leading-tight">Venues</span>
            </button>
          ) : (
            <div className="flex-1" />
          )}

          {/* Add Spot — center, primary */}
          <button
            onClick={() => { if (viewMode === 'list') setViewMode('map'); handleAddSpot(); }}
            className="flex flex-col items-center justify-center px-4 active:scale-95 transition-all touch-manipulation"
            aria-label="Add new spot"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-500 shadow-lg">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </span>
            <span className="text-[10px] font-medium leading-tight text-teal-400 mt-0.5">Add Spot</span>
          </button>

          {/* Suggest */}
          <button
            onClick={() => setIsSuggestActivityOpen(true)}
            className="flex flex-1 flex-col items-center justify-center gap-0.5 text-white/70 hover:text-white active:scale-95 transition-all touch-manipulation"
            aria-label="Suggest an activity"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <span className="text-[10px] font-medium leading-tight">Suggest</span>
          </button>

          {/* Feedback */}
          <button
            onClick={() => setIsFeedbackOpen(true)}
            className="flex flex-1 flex-col items-center justify-center gap-0.5 text-white/70 hover:text-white active:scale-95 transition-all touch-manipulation"
            aria-label="Send feedback"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <span className="text-[10px] font-medium leading-tight">Feedback</span>
          </button>
        </div>
      </div>

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
            const result = await deleteSpot(id);
            setEditingSpot(null);
            setEditPinLocation(null);
            setIsEditOpen(false);
            if (result?.pending) {
              showToast('Delete request submitted for approval!', 'info');
            }
          } catch (error) {
            console.error('Error deleting spot:', error);
            throw error;
          }
        }}
      />

      {/* Feedback Modal */}
      <FeedbackModal
        isOpen={isFeedbackOpen}
        onClose={() => setIsFeedbackOpen(false)}
        onSuccess={() => {
          setIsFeedbackOpen(false);
          trackFeedbackSubmit();
          showToast('Feedback sent! Thank you.', 'success');
        }}
      />

      {/* About Modal */}
      <AboutModal
        isOpen={isAboutOpen}
        onClose={() => setIsAboutOpen(false)}
        lastUpdated={lastUpdatedEST}
        healthIndicator={healthIndicator}
        spotCount={spots.length}
      />

      {/* Suggest Activity Modal */}
      <SuggestActivityModal
        isOpen={isSuggestActivityOpen}
        onClose={() => setIsSuggestActivityOpen(false)}
        onSuccess={() => {
          setIsSuggestActivityOpen(false);
          showToast('Activity suggestion sent! Thank you.', 'success');
        }}
      />

      {/* Report Spot Issue Modal */}
      <ReportSpotModal
        isOpen={isReportOpen}
        onClose={() => { setIsReportOpen(false); setReportingSpot(null); }}
        onSuccess={() => {
          setIsReportOpen(false);
          setReportingSpot(null);
          showToast('Report submitted — thank you for helping improve our data!', 'success');
        }}
        spot={reportingSpot}
      />

      {/* First-time visitor welcome overlay */}
      <WelcomeOverlay onComplete={() => setViewMode('list')} />
    </div>
  );
}