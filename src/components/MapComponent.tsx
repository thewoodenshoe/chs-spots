'use client';

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { GoogleMap, Marker, InfoWindow, MarkerClusterer, useJsApiLoader } from '@react-google-maps/api';
import { Spot } from '@/contexts/SpotsContext';
import { useVenues, Venue } from '@/contexts/VenuesContext';
import { useActivities } from '@/contexts/ActivitiesContext';
import { SpotType, ACTIVITY_GROUPS } from './FilterModal';
import { NEAR_ME } from './AreaSelector';
import { isOpenNow } from '@/utils/active-status';
import CommunityBanner, { shouldShowBanner } from './CommunityBanner';
import SpotInfoWindow from './SpotInfoWindow';
import { CLUSTER_ICONS, createMarkerIcon, createVenueMarkerIcon } from '@/utils/marker-icons';
import { calculateDistanceMiles } from '@/utils/distance';
import { isSpotActiveNow } from '@/utils/time-utils';

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || '';
const DEFAULT_CENTER = { lat: 32.862, lng: -79.908 };
const DEFAULT_ZOOM = 14;

const mapContainerStyle = {
  width: '100%',
  height: '100%',
};

interface MapComponentProps {
  selectedArea: string;
  selectedActivity: SpotType;
  filteredSpots: Spot[];
  isSubmissionMode?: boolean;
  pinLocation?: { lat: number; lng: number } | null;
  onMapClick?: (lat: number, lng: number) => void;
  mapCenter?: { lat: number; lng: number; zoom: number };
  onEditSpot?: (spot: Spot) => void;
  onReportSpot?: (spot: Spot) => void;
  showAllVenues?: boolean;
  searchQuery?: string;
  deepLinkSpotId?: number | null;
  userLocation?: { lat: number; lng: number } | null;
  onLocateMe?: () => void;
}

export default function MapComponent({
  selectedArea,
  selectedActivity,
  filteredSpots,
  isSubmissionMode = false,
  pinLocation,
  onMapClick,
  mapCenter,
  onEditSpot,
  onReportSpot,
  showAllVenues = false,
  searchQuery = '',
  deepLinkSpotId,
  userLocation = null,
  onLocateMe,
}: MapComponentProps) {
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
  });
  const { venues } = useVenues();
  const { activities } = useActivities();
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [selectedSpot, setSelectedSpot] = useState<Spot | null>(null);
  const [selectedSpots, setSelectedSpots] = useState<Spot[]>([]);
  const [selectedVenue, setSelectedVenue] = useState<Venue | null>(null);
  const [bannerDismissedFor, setBannerDismissedFor] = useState<Set<string>>(new Set());
  const [emptyDismissedKey, setEmptyDismissedKey] = useState('');

  const currentKey = `${selectedActivity}::${selectedArea}`;
  const emptyStateDismissed = emptyDismissedKey === currentKey;
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showOnlyVenueOpen, setShowOnlyVenueOpen] = useState(false);
  const [showOnlyActivityActive, setShowOnlyActivityActive] = useState(false);
  const [showOnlyLiveMusicToday, setShowOnlyLiveMusicToday] = useState(false);

  const whatsHappening = ACTIVITY_GROUPS.find(g => g.label === "What's Happening");
  const discover = ACTIVITY_GROUPS.find(g => g.label === 'Discover');
  const isWhatsHappening = whatsHappening?.activities.includes(selectedActivity) ?? false;
  const isDiscover = discover?.activities.includes(selectedActivity) ?? false;
  const showVenueOpenToggle = !isDiscover;
  const showActivityToggle = isWhatsHappening;
  const showLiveMusicTodayToggle = selectedActivity === 'Live Music';

  const venueMap = useMemo(() => {
    const m = new Map<string, (typeof venues)[number]>();
    for (const v of venues) m.set(v.id, v);
    return m;
  }, [venues]);

  const isScheduledToday = useCallback((s: Spot) => {
    if (!s.timeStart) return false;
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (s.specificDate) return s.specificDate === todayStr;
    if (s.days && s.days.length > 0) return s.days.includes(now.getDay());
    return true;
  }, []);

  const visibleSpots = useMemo(() => {
    let result = filteredSpots;
    if (showOnlyVenueOpen) {
      result = result.filter(s => {
        const venue = s.venueId ? venueMap.get(s.venueId) : undefined;
        return venue ? isOpenNow(venue.operatingHours) : false;
      });
    }
    if (showOnlyActivityActive) {
      result = result.filter(s => isSpotActiveNow(s));
    }
    if (showOnlyLiveMusicToday) {
      result = result.filter(isScheduledToday);
    }
    return result;
  }, [filteredSpots, showOnlyVenueOpen, showOnlyActivityActive, showOnlyLiveMusicToday, venueMap, isScheduledToday]);

  const venueGroupedMarkers = useMemo(() => {
    const groups = new Map<string, Spot[]>();
    for (const s of visibleSpots) {
      const key = s.venueId || `solo_${s.id}`;
      const arr = groups.get(key) || [];
      arr.push(s);
      groups.set(key, arr);
    }
    return Array.from(groups.values()).map(group => ({
      representative: group[0],
      spots: group,
      hasActive: group.some(s => isSpotActiveNow(s)),
    }));
  }, [visibleSpots]);

  const [initialCenter] = useState(() =>
    mapCenter ? { lat: mapCenter.lat, lng: mapCenter.lng } : DEFAULT_CENTER
  );
  const [initialZoom] = useState(() => mapCenter?.zoom ?? DEFAULT_ZOOM);

  const lastCenteredArea = useRef(selectedArea);
  const lastCenteredPos = useRef<{ lat: number; lng: number; zoom: number } | null>(null);

  useEffect(() => {
    if (!map || !userLocation) return;
    if (
      userLocation.lat >= 32.6 && userLocation.lat <= 32.9 &&
      userLocation.lng >= -80.0 && userLocation.lng <= -79.7
    ) {
      map.panTo(userLocation);
    }
  }, [map, userLocation]);

  useEffect(() => {
    if (!map || !mapCenter) return;

    const areaChanged = selectedArea !== lastCenteredArea.current;
    const centerChanged = !lastCenteredPos.current
      || Math.abs(lastCenteredPos.current.lat - mapCenter.lat) > 0.0001
      || Math.abs(lastCenteredPos.current.lng - mapCenter.lng) > 0.0001
      || lastCenteredPos.current.zoom !== mapCenter.zoom;

    if (areaChanged || centerChanged) {
      lastCenteredArea.current = selectedArea;
      lastCenteredPos.current = { ...mapCenter };
      map.panTo({ lat: mapCenter.lat, lng: mapCenter.lng });
      map.setZoom(mapCenter.zoom);
    }
  }, [selectedArea, mapCenter, map]);

  const deepLinkSpot = useMemo(() => {
    if (!deepLinkSpotId) return null;
    return filteredSpots.find(s => s.id === deepLinkSpotId) ?? null;
  }, [deepLinkSpotId, filteredSpots]);

  useEffect(() => {
    if (!deepLinkSpot || !map) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedSpot(deepLinkSpot);
  }, [deepLinkSpot, map]);

  const [prevAct, setPrevAct] = useState(selectedActivity);
  if (prevAct !== selectedActivity) {
    setPrevAct(selectedActivity);
    setShowOnlyVenueOpen(false);
    setShowOnlyActivityActive(false);
    setShowOnlyLiveMusicToday(false);
  }

  const AREA_BYPASS_ACTIVITIES = ['Recently Opened', 'Coming Soon'];
  const isAreaBypass = AREA_BYPASS_ACTIVITIES.includes(selectedActivity);

  useEffect(() => {
    if (deepLinkSpotId) return;
    const isSearch = searchQuery && searchQuery.trim().length >= 2;
    if (!map || (!isSearch && !isAreaBypass)) return;
    if (filteredSpots.length === 0) return;
    if (filteredSpots.length === 1) {
      map.panTo({ lat: filteredSpots[0].lat, lng: filteredSpots[0].lng });
      map.setZoom(15);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    filteredSpots.forEach((s) => bounds.extend({ lat: s.lat, lng: s.lng }));
    map.fitBounds(bounds, { top: 50, bottom: 80, left: 30, right: 30 });
  }, [map, filteredSpots, searchQuery, isAreaBypass, deepLinkSpotId]);

  const filteredVenues = useMemo(() => {
    if (!showAllVenues) return [];
    return venues.filter((venue) => venue.lat && venue.lng);
  }, [venues, showAllVenues]);

  const handleMapClick = useCallback((e: google.maps.MapMouseEvent) => {
    setSelectedSpot(null);
    setSelectedSpots([]);
    setSelectedVenue(null);
    if (window.location.search) window.history.replaceState({}, '', window.location.pathname);
    if (isSubmissionMode && e.latLng && onMapClick) {
      onMapClick(e.latLng.lat(), e.latLng.lng());
    }
  }, [isSubmissionMode, onMapClick]);

  const smartPan = useCallback((position: { lat: number; lng: number }) => {
    if (!map) return;
    const div = map.getDiv();
    const mapH = div.offsetHeight;
    const visibleTop = 165;
    const visibleBottom = 72;
    const usableH = mapH - visibleTop - visibleBottom;
    const targetScreenY = visibleTop + usableH * 0.65;
    const targetFraction = targetScreenY / mapH;

    const bounds = map.getBounds();
    if (!bounds) {
      map.panTo(position);
      return;
    }
    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();
    const latSpan = ne.lat() - sw.lat();
    const desiredCenterLat = position.lat + latSpan * (targetFraction - 0.5);
    map.panTo({ lat: desiredCenterLat, lng: position.lng });
  }, [map]);

  const handleVenueGroupClick = useCallback((spotsAtVenue: Spot[]) => {
    const first = spotsAtVenue[0];
    if (spotsAtVenue.length === 1) {
      setSelectedSpot(first);
      setSelectedSpots([]);
    } else {
      setSelectedSpot(null);
      setSelectedSpots(spotsAtVenue);
    }
    setSelectedVenue(null);
    smartPan({ lat: first.lat, lng: first.lng });
    window.history.replaceState({}, '', `?spot=${first.id}`);
  }, [smartPan]);

  const handleVenueMarkerClick = useCallback((venue: Venue) => {
    setSelectedVenue(venue);
    setSelectedSpot(null);
    setSelectedSpots([]);
    smartPan({ lat: venue.lat, lng: venue.lng });
    if (window.location.search) window.history.replaceState({}, '', window.location.pathname);
  }, [smartPan]);

  const handleInfoWindowClose = useCallback(() => {
    setSelectedSpot(null);
    setSelectedSpots([]);
    setSelectedVenue(null);
    if (window.location.search) window.history.replaceState({}, '', window.location.pathname);
  }, []);

  const findClosestSpot = useCallback(() => {
    if (!map || filteredSpots.length === 0) {
      setToastMessage('No spots available');
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }

    const showClosest = (origin: { lat: number; lng: number }, label: string) => {
      const spotsWithDistance = filteredSpots.map(spot => ({
        spot,
        distance: calculateDistanceMiles(origin.lat, origin.lng, spot.lat, spot.lng),
      }));
      const closest = spotsWithDistance.reduce((prev, cur) =>
        cur.distance < prev.distance ? cur : prev
      );
      setSelectedSpot(closest.spot);
      window.history.replaceState({}, '', `?spot=${closest.spot.id}`);
      setToastMessage(`${label}${closest.spot.title} (${closest.distance.toFixed(1)} miles)`);
      map.panTo({ lat: closest.spot.lat, lng: closest.spot.lng });
      map.setZoom(15);
      setTimeout(() => setToastMessage(null), 3000);
    };

    if (userLocation) {
      showClosest(userLocation, 'Closest: ');
    } else {
      const origin = map.getCenter()?.toJSON() || DEFAULT_CENTER;
      showClosest(origin, 'Closest from map center: ');
    }
  }, [map, filteredSpots, userLocation]);

  useEffect(() => {
    const handleFindClosest = () => findClosestSpot();
    window.addEventListener('findClosestSpot', handleFindClosest);
    return () => window.removeEventListener('findClosestSpot', handleFindClosest);
  }, [findClosestSpot]);

  if (!GOOGLE_MAPS_API_KEY) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gray-100">
        <div className="text-center">
          <p className="text-lg font-semibold text-gray-800 mb-2">
            Google Maps API Key Required
          </p>
          <p className="text-sm text-gray-600">
            Please set NEXT_PUBLIC_GOOGLE_MAPS_KEY in your .env.local file
          </p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gray-100">
        <div className="text-center">
          <p className="text-lg font-semibold text-gray-800 mb-2">Map failed to load</p>
          <p className="text-sm text-gray-600">Please check your connection and try again.</p>
        </div>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gray-50">
        <div className="text-lg text-gray-600">Loading map...</div>
      </div>
    );
  }

  const activityConfig = activities.find(a => a.name === selectedActivity);
  const isCommunityActivity = activityConfig?.communityDriven === true;
  const showCommunityBanner = isCommunityActivity && shouldShowBanner(selectedActivity) && !bannerDismissedFor.has(selectedActivity);

  const activityToggleLabel = (() => {
    switch (selectedActivity) {
      case 'Happy Hour': return 'Happy Hour Now';
      case 'Brunch': return 'Brunch Active Now';
      case 'Live Music': return 'Live Music Now';
      default: return `${selectedActivity} Now`;
    }
  })();

  const hasAnyToggle = showVenueOpenToggle || showActivityToggle || showLiveMusicTodayToggle;

  return (
    <div className="relative h-full w-full">
      {toastMessage && (
        <div className="fixed top-20 left-1/2 z-[60] -translate-x-1/2 animate-slide-down rounded-lg bg-gray-900 px-4 py-3 text-sm font-medium text-white shadow-2xl safe-area-top">
          {toastMessage}
        </div>
      )}

      {showCommunityBanner && (
        <CommunityBanner
          activityName={selectedActivity}
          onDismiss={() => setBannerDismissedFor(prev => new Set(prev).add(selectedActivity))}
        />
      )}

      {hasAnyToggle && !isSubmissionMode && (
        <div className="absolute top-2 right-2 z-[55] flex flex-col gap-1.5">
          {showVenueOpenToggle && (
            <button
              onClick={() => setShowOnlyVenueOpen(prev => !prev)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold shadow-md transition-all ${
                showOnlyVenueOpen
                  ? 'bg-teal-600 text-white'
                  : 'bg-white/95 text-gray-700 border border-gray-200 backdrop-blur-sm'
              }`}
            >
              <span className={`inline-block h-2 w-2 rounded-full ${showOnlyVenueOpen ? 'bg-green-300' : 'bg-gray-300'}`} />
              Venue Open Now
            </button>
          )}
          {showActivityToggle && (
            <button
              onClick={() => setShowOnlyActivityActive(prev => !prev)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold shadow-md transition-all ${
                showOnlyActivityActive
                  ? 'bg-teal-600 text-white'
                  : 'bg-white/95 text-gray-700 border border-gray-200 backdrop-blur-sm'
              }`}
            >
              <span className={`inline-block h-2 w-2 rounded-full ${showOnlyActivityActive ? 'bg-green-300' : 'bg-gray-300'}`} />
              {activityToggleLabel}
            </button>
          )}
          {showLiveMusicTodayToggle && (
            <button
              onClick={() => setShowOnlyLiveMusicToday(prev => !prev)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold shadow-md transition-all ${
                showOnlyLiveMusicToday
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white/95 text-gray-700 border border-gray-200 backdrop-blur-sm'
              }`}
            >
              <span className={`inline-block h-2 w-2 rounded-full ${showOnlyLiveMusicToday ? 'bg-indigo-300' : 'bg-gray-300'}`} />
              Live Music Today
            </button>
          )}
        </div>
      )}

      {isSubmissionMode && (
        <div className="absolute top-2 left-1/2 z-[55] -translate-x-1/2 rounded-full bg-teal-600 px-5 py-2 shadow-lg">
          <span className="text-sm font-semibold text-white">
            {pinLocation ? 'Pin dropped — drag to adjust' : 'Tap the map to drop a pin'}
          </span>
        </div>
      )}

      {!isSubmissionMode && visibleSpots.length === 0 && !showCommunityBanner && !emptyStateDismissed && (
        <div className="absolute top-3 left-3 right-3 z-[55] animate-fade-in-down">
          <div className="rounded-xl bg-white/95 px-4 py-3 shadow-lg backdrop-blur-sm border border-gray-200">
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <>
                  <p className="text-sm font-medium text-gray-700">
                    No {selectedActivity} {selectedArea === NEAR_ME ? 'nearby' : `in ${selectedArea}`} yet
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {selectedActivity === 'Recently Opened' || selectedActivity === 'Coming Soon'
                      ? 'Know a new opening? Tip us and we\u2019ll add it!'
                      : 'Know a spot? Tap "Add Spot" below to help out!'}
                  </p>
                </>
              </div>
              <button
                onClick={() => setEmptyDismissedKey(currentKey)}
                className="flex-shrink-0 p-1 text-gray-400 hover:text-gray-600 transition-colors rounded-full hover:bg-gray-100"
                aria-label="Dismiss"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      <GoogleMap
          mapContainerStyle={mapContainerStyle}
          center={initialCenter}
          zoom={initialZoom}
          onClick={handleMapClick}
          onLoad={(mapInstance) => setMap(mapInstance)}
          options={{
            fullscreenControl: false,
            mapTypeControl: false,
            streetViewControl: false,
            gestureHandling: 'greedy',
          }}
        >
        {venueGroupedMarkers.length > 0 && (
          <MarkerClusterer
            options={{
              enableRetinaIcons: true,
              styles: [
                { url: CLUSTER_ICONS.teal.sm, height: 40, width: 40, textColor: '#fff', textSize: 14, fontWeight: 'bold' },
                { url: CLUSTER_ICONS.teal.md, height: 48, width: 48, textColor: '#fff', textSize: 16, fontWeight: 'bold' },
                { url: CLUSTER_ICONS.teal.lg, height: 56, width: 56, textColor: '#fff', textSize: 18, fontWeight: 'bold' },
              ],
            }}
          >
            {(clusterer) => (
              <>
                {venueGroupedMarkers.map(({ representative, spots: groupSpots, hasActive }) => (
                  <Marker
                    key={representative.venueId || representative.id}
                    position={{ lat: representative.lat, lng: representative.lng }}
                    icon={createMarkerIcon(representative, activities, hasActive)}
                    clusterer={clusterer}
                    onClick={() => handleVenueGroupClick(groupSpots)}
                    zIndex={hasActive ? 1100 : 1000}
                  />
                ))}
              </>
            )}
          </MarkerClusterer>
        )}

        {showAllVenues && filteredVenues.length > 0 && (
          <MarkerClusterer
            options={{
              enableRetinaIcons: true,
              styles: [
                { url: CLUSTER_ICONS.gray.sm, height: 40, width: 40, textColor: '#fff', textSize: 14, fontWeight: 'bold' },
                { url: CLUSTER_ICONS.gray.md, height: 48, width: 48, textColor: '#fff', textSize: 16, fontWeight: 'bold' },
                { url: CLUSTER_ICONS.gray.lg, height: 56, width: 56, textColor: '#fff', textSize: 18, fontWeight: 'bold' },
              ],
            }}
          >
            {(clusterer) => (
              <>
                {filteredVenues.map((venue) => (
                  <Marker
                    key={venue.id}
                    position={{ lat: venue.lat, lng: venue.lng }}
                    icon={createVenueMarkerIcon()}
                    clusterer={clusterer}
                    onClick={() => handleVenueMarkerClick(venue)}
                    zIndex={500}
                  />
                ))}
              </>
            )}
          </MarkerClusterer>
        )}

        {userLocation && (
          <Marker
            position={{ lat: userLocation.lat, lng: userLocation.lng }}
            icon={{
              url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                <svg width="20" height="20" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="10" cy="10" r="8" fill="#3b82f6" stroke="white" stroke-width="2"/>
                </svg>
              `),
              scaledSize: new google.maps.Size(20, 20),
              anchor: new google.maps.Point(10, 10),
            }}
            zIndex={1000}
          />
        )}

        {selectedSpot && (
          <InfoWindow
            position={{ lat: selectedSpot.lat, lng: selectedSpot.lng }}
            onCloseClick={handleInfoWindowClose}
            options={{
              pixelOffset: new google.maps.Size(0, -8),
              maxWidth: 320,
            }}
          >
            <SpotInfoWindow
              spot={selectedSpot}
              activities={activities}
              onEdit={onEditSpot}
              onReport={onReportSpot}
              onClose={handleInfoWindowClose}
            />
          </InfoWindow>
        )}

        {selectedSpots.length > 0 && (
          <InfoWindow
            position={{ lat: selectedSpots[0].lat, lng: selectedSpots[0].lng }}
            onCloseClick={handleInfoWindowClose}
            options={{
              pixelOffset: new google.maps.Size(0, -8),
              maxWidth: 340,
            }}
          >
            <div className="text-sm min-w-[220px] max-w-[320px]">
              {(() => {
                const venueId = selectedSpots[0].venueId;
                const venue = venueId ? venueMap.get(venueId) : undefined;
                return (
                  <>
                    <div className="font-bold text-gray-900 text-base mb-1">
                      {venue?.name || selectedSpots[0].title}
                    </div>
                    {venue?.area && (
                      <p className="text-xs text-gray-500 mb-2">{venue.area}, Charleston SC</p>
                    )}
                    <div className="space-y-2">
                      {selectedSpots.map(s => {
                        const cfg = activities.find(a => a.name === s.type);
                        const active = isSpotActiveNow(s);
                        return (
                          <div
                            key={s.id}
                            className="rounded-lg border border-gray-200 p-2 cursor-pointer hover:border-teal-300 transition-colors"
                            onClick={() => { setSelectedSpot(s); setSelectedSpots([]); }}
                          >
                            <div className="flex items-center gap-1.5">
                              <span>{cfg?.emoji || '📍'}</span>
                              <span className="font-semibold text-gray-800 text-xs">{s.type}</span>
                              {active && (
                                <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-bold text-green-700">Active</span>
                              )}
                            </div>
                            {s.promotionTime && (
                              <p className="text-[11px] text-gray-500 mt-0.5">{s.promotionTime}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex gap-2 mt-2">
                      {venue && (
                        <a
                          href={`https://www.google.com/maps/dir/?api=1&destination=${venue.lat},${venue.lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 rounded-lg bg-indigo-100 px-3 py-1.5 text-xs font-semibold text-indigo-700 text-center hover:bg-indigo-200"
                        >
                          Directions
                        </a>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
          </InfoWindow>
        )}

        {selectedVenue && (
          <InfoWindow
            position={{ lat: selectedVenue.lat, lng: selectedVenue.lng }}
            onCloseClick={handleInfoWindowClose}
            options={{
              pixelOffset: new google.maps.Size(0, -8),
              maxWidth: 320,
            }}
          >
            <div className="text-sm min-w-[200px] max-w-[300px]">
              <div className="font-bold text-gray-900 mb-2 text-base">{selectedVenue.name}</div>
              {selectedVenue.area && (
                <p className="text-xs text-gray-600 mb-1">📍 {selectedVenue.area}</p>
              )}
              {selectedVenue.address && (
                <p className="text-xs text-gray-600 mb-2">{selectedVenue.address}</p>
              )}
              {selectedVenue.website && (
                <a
                  href={selectedVenue.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 hover:underline font-medium"
                >
                  Website
                </a>
              )}
              <div className="mt-2 text-xs text-gray-500 italic">
                (Venue - No happy hour info)
              </div>
            </div>
          </InfoWindow>
        )}

        {isSubmissionMode && pinLocation && (
          <Marker
            position={{ lat: pinLocation.lat, lng: pinLocation.lng }}
            icon={{
              url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                <svg width="30" height="30" xmlns="http://www.w3.org/2000/svg">
                  <path d="M15 0 L15 20 L0 30 L30 30 Z" fill="#ef4444" stroke="white" stroke-width="2"/>
                </svg>
              `),
              scaledSize: new google.maps.Size(30, 30),
              anchor: new google.maps.Point(15, 30),
            }}
          />
        )}
      </GoogleMap>

      {onLocateMe && (
        <button
          onClick={onLocateMe}
          className="absolute bottom-24 right-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-lg transition-all hover:bg-gray-50 active:scale-95 touch-manipulation"
          aria-label="Go to my location"
          title="My location"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="3" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v3m0 14v3M2 12h3m14 0h3" />
            <circle cx="12" cy="12" r="8" strokeDasharray="2 2" />
          </svg>
        </button>
      )}
    </div>
  );
}
