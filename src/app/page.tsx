'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect, useMemo, useRef } from 'react';
import FilterModal, { Area, SpotType } from '@/components/FilterModal';
import SubmissionModal from '@/components/SubmissionModal';
import EditSpotModal from '@/components/EditSpotModal';
import AreaSelector, { getAreaCentersSync, NEAR_ME } from '@/components/AreaSelector';
import ActivityChip from '@/components/ActivityChip';
import { useSpots, Spot } from '@/contexts/SpotsContext';
import { useToast } from '@/components/Toast';
import { trackAreaView, trackSpotClick, trackSpotSubmit, trackActivityFilter, trackFeedbackSubmit, trackSearchFilter, trackViewMode, trackNearMe, trackSortMode } from '@/lib/analytics';
import FeedbackModal from '@/components/FeedbackModal';
import AboutModal from '@/components/AboutModal';
import SuggestActivityModal from '@/components/SuggestActivityModal';
import SearchBar from '@/components/SearchBar';
import ReportSpotModal from '@/components/ReportSpotModal';
import SpotListView, { SortMode } from '@/components/SpotListView';
import WelcomeOverlay, { hasSeenWelcome } from '@/components/WelcomeOverlay';
import MoreMenu from '@/components/MoreMenu';
import { useVenues } from '@/contexts/VenuesContext';
import { useActivities } from '@/contexts/ActivitiesContext';
import { compressImageForUpload } from '@/utils/image';
import { getAreaFromCoordinates } from '@/utils/area';
import { getFavoriteIds } from '@/utils/favorites';
import { useFilteredSpots, useVenueAreaMap, useSpotCounts } from '@/hooks/useSpotFiltering';

const MapComponent = dynamic(() => import('@/components/MapComponent'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-gray-50">
      <div className="text-lg text-gray-600">Loading map...</div>
    </div>
  ),
});

export default function Home() {
  const { spots, addSpot, updateSpot, deleteSpot, refreshSpots, loading: spotsLoading } = useSpots();
  const { showToast } = useToast();
  const [healthStatus, setHealthStatus] = useState<'checking' | 'ok' | 'error'>('checking');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isSubmissionOpen, setIsSubmissionOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const FALLBACK_AREA = 'Downtown Charleston';
  const FALLBACK_CENTER = { lat: 32.776, lng: -79.931, zoom: 15 };
  const [selectedArea, setSelectedArea] = useState<Area>(NEAR_ME);
  const [selectedActivity, setSelectedActivity] = useState<SpotType>('Happy Hour');
  const [pinLocation, setPinLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [editingSpot, setEditingSpot] = useState<Spot | null>(null);
  const [editPinLocation, setEditPinLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isSuggestActivityOpen, setIsSuggestActivityOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [reportingSpot, setReportingSpot] = useState<Spot | null>(null);
  const [viewMode, setViewMode] = useState<'map' | 'list'>('list');
  const [listSortMode, setListSortMode] = useState<SortMode>('activityActive');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [mapCenter, setMapCenter] = useState(FALLBACK_CENTER);
  const [areaCenters, setAreaCenters] = useState<Record<string, { lat: number; lng: number; zoom: number }>>({});
  const pendingDeepLink = useRef<string | null>(null);
  const deepLinkActive = useRef(false);
  const [deepLinkSpotId, setDeepLinkSpotId] = useState<number | null>(null);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const { venues, refreshVenues } = useVenues();
  const { activities } = useActivities();

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
        const syncCenters = getAreaCentersSync();
        setAreaCenters(syncCenters);
      }
    }
    loadCenters();
  }, []);

  useEffect(() => {
    setSavedCount(getFavoriteIds().length);

    const params = new URLSearchParams(window.location.search);
    const spotId = params.get('spot');
    if (spotId) {
      pendingDeepLink.current = spotId;
    } else if (!hasSeenWelcome()) {
      setViewMode('list');
    }
  }, []);

  useEffect(() => {
    if (!pendingDeepLink.current || spotsLoading || spots.length === 0) return;

    const spotId = pendingDeepLink.current;
    pendingDeepLink.current = null;

    const spot = spots.find(s => s.id === Number(spotId));
    if (!spot) return;

    deepLinkActive.current = true;
    setDeepLinkSpotId(spot.id);
    const area = spot.area
      || (spot.venueId ? venueAreaById.get(spot.venueId) : undefined)
      || getAreaFromCoordinates(spot.lat, spot.lng);
    setSelectedArea(area as Area);
    setSelectedActivity(spot.type as SpotType);
    setMapCenter({ lat: spot.lat, lng: spot.lng, zoom: 16 });
    setViewMode('map');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotsLoading, spots]);

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

  const geoResolved = useRef(false);

  const applyUserPosition = (userPos: { lat: number; lng: number }, skipAreaChange = false) => {
    setUserLocation(userPos);
    if (deepLinkActive.current || pendingDeepLink.current || skipAreaChange) return;
    setMapCenter({ lat: userPos.lat, lng: userPos.lng, zoom: 14 });
  };

  useEffect(() => {
    if (geoResolved.current) return;
    geoResolved.current = true;
    if (!navigator.geolocation) {
      setSelectedArea(FALLBACK_AREA);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => applyUserPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => { setSelectedArea(FALLBACK_AREA); },
    );
  }, [areaCenters]);

  const handleRefresh = async () => {
    await Promise.all([refreshSpots(), refreshVenues()]);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => applyUserPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude }, true),
        () => { /* denied */ },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
      );
    }
  };

  const handleLocateMe = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        applyUserPosition(userPos);
        setMapCenter({ lat: userPos.lat, lng: userPos.lng, zoom: 14 });
      },
      () => { /* denied */ },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  };

  const venueAreaById = useVenueAreaMap(venues);
  const isSearching = searchQuery.trim().length >= 2;

  const spotCountsByActivity = useSpotCounts(spots);

  const filteredSpots = useFilteredSpots({
    spots, selectedArea, selectedActivity, searchQuery, userLocation, venueAreaById,
  });

  useEffect(() => {
    if (deepLinkActive.current || pendingDeepLink.current) return;
    if (selectedArea === NEAR_ME) return;
    const centers = Object.keys(areaCenters).length > 0 ? areaCenters : getAreaCentersSync();
    if (centers[selectedArea]) {
      setMapCenter(centers[selectedArea]);
    }
  }, [selectedArea, areaCenters]);

  const handleAddSpot = () => {
    setIsSubmissionOpen(true);
    setPinLocation(null);
  };

  const handleFilter = () => {
    setIsFilterOpen(true);
  };

  const clearDeepLink = () => {
    deepLinkActive.current = false;
    setDeepLinkSpotId(null);
    if (window.location.search.includes('spot=')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  };

  const handleAreaChange = (area: Area) => {
    clearDeepLink();
    setSelectedArea(area);
    trackAreaView(area);
    if (area === NEAR_ME) {
      trackNearMe();
      if (userLocation) {
        setMapCenter({ lat: userLocation.lat, lng: userLocation.lng, zoom: 13 });
      } else {
        handleLocateMe();
      }
      return;
    }
    const centers = Object.keys(areaCenters).length > 0 ? areaCenters : getAreaCentersSync();
    if (centers[area]) {
      setMapCenter(centers[area]);
    } else {
      setMapCenter(FALLBACK_CENTER);
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
      let photoUrl: string | undefined = data.photoUrl;
      if (data.photo) {
        photoUrl = await compressImageForUpload(data.photo);
      }

      const result = await updateSpot({
        id: data.id,
        lat: data.lat,
        lng: data.lng,
        title: data.title,
        description: data.description,
        type: data.type,
        photoUrl,
      });

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
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:bg-teal-600 focus:text-white focus:px-4 focus:py-2 focus:rounded-md focus:top-2 focus:left-2">
        Skip to content
      </a>
      <header className="fixed top-0 left-0 right-0 z-50 bg-black/70 backdrop-blur-md safe-area-top" role="banner">
        <div className="flex h-10 items-center justify-between px-4">
          <h1 className="text-sm font-bold text-white drop-shadow-lg tracking-tight leading-none">
            Charleston Finds &amp; Deals
          </h1>
          <button
            onClick={() => setIsAboutOpen(true)}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-all"
            aria-label="About"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
        </div>

        <div className="flex flex-row items-stretch gap-2 px-4 pb-2">
          <div className="flex-1 min-w-0">
            <AreaSelector
              selectedArea={selectedArea}
              onAreaChange={handleAreaChange}
              onMapRecenter={handleAreaChange}
              hasUserLocation={!!userLocation}
            />
          </div>
          <div className="flex-1 min-w-0">
            <ActivityChip activity={selectedActivity} spotCount={spotsLoading ? undefined : filteredSpots.length} emoji={activities.find(a => a.name === selectedActivity)?.emoji} onClick={handleFilter} />
          </div>
        </div>
      </header>

      <main
        id="main-content"
        className="h-full w-full"
        style={{ paddingTop: '110px', paddingBottom: '72px' }}
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
            filteredSpots={filteredSpots}
            isSubmissionMode={isSubmissionOpen || isEditOpen}
            pinLocation={isEditOpen ? editPinLocation : pinLocation}
            onMapClick={handleMapClick}
            mapCenter={mapCenter}
            onEditSpot={handleEditSpot}
            onReportSpot={(spot) => {
              setReportingSpot(spot);
              setIsReportOpen(true);
            }}
            showAllVenues={false}
            searchQuery={searchQuery}
            deepLinkSpotId={deepLinkSpotId}
            userLocation={userLocation}
            onLocateMe={handleLocateMe}
          />
        ) : (
          <SpotListView
            spots={filteredSpots}
            allSpots={spots}
            activities={activities}
            userLocation={userLocation}
            selectedArea={selectedArea}
            selectedActivity={selectedActivity}
            sortMode={listSortMode}
            onSortChange={(m) => { setListSortMode(m); trackSortMode(m); }}
            onSpotSelect={(spot) => {
              const spotArea = spot.area || getAreaFromCoordinates(spot.lat, spot.lng);
              setSelectedArea(spotArea as Area);
              setMapCenter({ lat: spot.lat, lng: spot.lng, zoom: 16 });
              setSearchQuery('');
              setViewMode('map');
            }}
            onEditSpot={handleEditSpot}
            onAddSpot={() => { setViewMode('map'); handleAddSpot(); }}
            isSearching={isSearching}
            showFavoritesOnly={showFavoritesOnly}
            onFavoritesChange={(count) => setSavedCount(count)}
            onRefresh={handleRefresh}
            onWhatsNewSelect={(spot) => {
              clearDeepLink();
              setSelectedActivity(spot.type as SpotType);
              const spotArea = spot.area || getAreaFromCoordinates(spot.lat, spot.lng);
              setSelectedArea(spotArea as Area);
              setMapCenter({ lat: spot.lat, lng: spot.lng, zoom: 16 });
              setViewMode('map');
            }}
          />
        )}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-black/70 backdrop-blur-md safe-area-bottom" data-testid="footer-toolbar" role="navigation" aria-label="Main actions">
        {isSearchOpen && (
          <div className="px-3 pt-2">
            <SearchBar
              value={searchQuery}
              onChange={(v) => setSearchQuery(v)}
              onSearchCommit={(v) => { if (v.length >= 2) trackSearchFilter(v); }}
              placeholder="Search spots..."
              resultCount={isSearching ? filteredSpots.length : undefined}
            />
          </div>
        )}
        <div className="flex h-[56px] items-stretch justify-around px-2">
          <button
            onClick={() => {
              setIsSearchOpen(!isSearchOpen);
              if (isSearchOpen) setSearchQuery('');
            }}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 transition-all active:scale-95 touch-manipulation ${
              isSearchOpen ? 'text-teal-400' : 'text-white/70 hover:text-white'
            }`}
            aria-label="Search spots"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span className="text-[10px] font-medium leading-tight">Search</span>
          </button>

          <button
            onClick={() => {
              const next = viewMode === 'map' ? 'list' : 'map';
              if (next === 'map' && userLocation) {
                setMapCenter({ lat: userLocation.lat, lng: userLocation.lng, zoom: 14 });
              }
              setViewMode(next);
              trackViewMode(next);
            }}
            className="flex flex-1 flex-col items-center justify-center gap-0.5 transition-all active:scale-95 touch-manipulation text-white/70 hover:text-white"
            aria-label={viewMode === 'map' ? 'Switch to list view' : 'Switch to map view'}
          >
            {viewMode === 'map' ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
            )}
            <span className="text-[10px] font-medium leading-tight">{viewMode === 'map' ? 'List' : 'Map'}</span>
          </button>

          <button
            onClick={() => {
              setShowFavoritesOnly(true);
              setViewMode('list');
            }}
            className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 transition-all active:scale-95 touch-manipulation ${
              showFavoritesOnly
                ? 'text-red-400'
                : 'text-white/70 hover:text-white'
            }`}
            aria-label="Saved spots"
          >
            <div className="relative">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill={showFavoritesOnly ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
              {savedCount > 0 && (
                <span className="absolute -top-1.5 -right-2.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                  {savedCount}
                </span>
              )}
            </div>
            <span className="text-[10px] font-medium leading-tight">Saved</span>
          </button>

          <div className="relative flex flex-1 flex-col items-center justify-center">
            <button
              onClick={() => setIsMoreMenuOpen(!isMoreMenuOpen)}
              className={`flex flex-col items-center justify-center gap-0.5 transition-all active:scale-95 touch-manipulation ${
                isMoreMenuOpen ? 'text-teal-400' : 'text-white/70 hover:text-white'
              }`}
              aria-label="More options"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" />
              </svg>
              <span className="text-[10px] font-medium leading-tight">More</span>
            </button>
            <MoreMenu
              isOpen={isMoreMenuOpen}
              onClose={() => setIsMoreMenuOpen(false)}
              onAddSpot={() => { if (viewMode === 'list') setViewMode('map'); handleAddSpot(); }}
              onSuggestActivity={() => setIsSuggestActivityOpen(true)}
              onFeedback={() => setIsFeedbackOpen(true)}
              onAbout={() => setIsAboutOpen(true)}
            />
          </div>
        </div>
      </nav>

      <FilterModal
        isOpen={isFilterOpen}
        onClose={() => setIsFilterOpen(false)}
        selectedActivity={selectedActivity}
        spotCounts={spotCountsByActivity}
        onActivityChange={(activity: SpotType) => {
          clearDeepLink();
          setSelectedActivity(activity);
          trackActivityFilter(activity);
          const hasTimeData = activity === 'Happy Hour' || activity === 'Brunch' || activity === 'Live Music';
          setListSortMode(hasTimeData ? 'activityActive' : (userLocation ? 'nearest' : 'alpha'));
        }}
      />

      <SubmissionModal
        isOpen={isSubmissionOpen}
        onClose={() => {
          setIsSubmissionOpen(false);
        }}
        pinLocation={pinLocation}
        defaultActivity={selectedActivity}
        area={selectedArea}
        onSubmit={handleSubmissionSubmit}
      />

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

      <FeedbackModal
        isOpen={isFeedbackOpen}
        onClose={() => setIsFeedbackOpen(false)}
        onSuccess={() => {
          setIsFeedbackOpen(false);
          trackFeedbackSubmit();
          showToast('Feedback sent! Thank you.', 'success');
        }}
      />

      <AboutModal
        isOpen={isAboutOpen}
        onClose={() => setIsAboutOpen(false)}
        lastUpdated={lastUpdatedEST}
        healthIndicator={healthIndicator}
        spotCount={spots.length}
      />

      <SuggestActivityModal
        isOpen={isSuggestActivityOpen}
        onClose={() => setIsSuggestActivityOpen(false)}
        onSuccess={() => {
          setIsSuggestActivityOpen(false);
          showToast('Activity suggestion sent! Thank you.', 'success');
        }}
      />

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

      <WelcomeOverlay
        spots={spots}
        onComplete={() => {
          if (!deepLinkActive.current) setViewMode('list');
        }}
      />
    </div>
  );
}
