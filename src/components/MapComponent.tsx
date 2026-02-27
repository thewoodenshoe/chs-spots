'use client';

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { GoogleMap, Marker, InfoWindow, MarkerClusterer, useJsApiLoader } from '@react-google-maps/api';
import { Spot } from '@/contexts/SpotsContext';
import { useVenues, Venue } from '@/contexts/VenuesContext';
import { useActivities } from '@/contexts/ActivitiesContext';
import { SpotType } from './FilterModal';
import { NEAR_ME } from './AreaSelector';
import CommunityBanner, { shouldShowBanner } from './CommunityBanner';
import SpotInfoWindow from './SpotInfoWindow';
import { CLUSTER_ICONS, createMarkerIcon, createVenueMarkerIcon } from '@/utils/marker-icons';
import { calculateDistanceMiles } from '@/utils/distance';

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
}

let geolocatedOnce = false;

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
}: MapComponentProps) {
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
  });
  const { venues } = useVenues();
  const { activities } = useActivities();
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedSpot, setSelectedSpot] = useState<Spot | null>(null);
  const [selectedVenue, setSelectedVenue] = useState<Venue | null>(null);
  const [bannerDismissedFor, setBannerDismissedFor] = useState<Set<string>>(new Set());
  const [emptyDismissedKey, setEmptyDismissedKey] = useState('');

  const currentKey = `${selectedActivity}::${selectedArea}`;
  const emptyStateDismissed = emptyDismissedKey === currentKey;
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [initialCenter] = useState(() =>
    mapCenter ? { lat: mapCenter.lat, lng: mapCenter.lng } : DEFAULT_CENTER
  );
  const [initialZoom] = useState(() => mapCenter?.zoom ?? DEFAULT_ZOOM);

  const lastCenteredArea = useRef(selectedArea);
  const lastCenteredPos = useRef<{ lat: number; lng: number; zoom: number } | null>(null);

  useEffect(() => {
    if (geolocatedOnce || !navigator.geolocation) return;
    geolocatedOnce = true;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const userPos = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        setUserLocation(userPos);
        if (
          map &&
          userPos.lat >= 32.6 && userPos.lat <= 32.9 &&
          userPos.lng >= -80.0 && userPos.lng <= -79.7
        ) {
          map.panTo(userPos);
        }
      },
      (error) => {
        console.log('Geolocation denied or error:', error);
      }
    );
  }, [map]);

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
    setSelectedVenue(null);
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

  const handleMarkerClick = useCallback((spot: Spot) => {
    setSelectedSpot(spot);
    setSelectedVenue(null);
    smartPan({ lat: spot.lat, lng: spot.lng });
  }, [smartPan]);

  const handleVenueMarkerClick = useCallback((venue: Venue) => {
    setSelectedVenue(venue);
    setSelectedSpot(null);
    smartPan({ lat: venue.lat, lng: venue.lng });
  }, [smartPan]);

  const handleInfoWindowClose = useCallback(() => {
    setSelectedSpot(null);
    setSelectedVenue(null);
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
      setToastMessage(`${label}${closest.spot.title} (${closest.distance.toFixed(1)} miles)`);
      map.panTo({ lat: closest.spot.lat, lng: closest.spot.lng });
      map.setZoom(15);
      setTimeout(() => setToastMessage(null), 3000);
    };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const userPos = { lat: position.coords.latitude, lng: position.coords.longitude };
          setUserLocation(userPos);
          showClosest(userPos, 'Closest: ');
        },
        () => {
          const origin = map.getCenter()?.toJSON() || DEFAULT_CENTER;
          showClosest(origin, 'Closest from map center: ');
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    } else {
      const origin = map.getCenter()?.toJSON() || DEFAULT_CENTER;
      showClosest(origin, 'Closest from map center: ');
    }
  }, [map, filteredSpots]);

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

      {isSubmissionMode && (
        <div className="absolute top-2 left-1/2 z-[55] -translate-x-1/2 rounded-full bg-teal-600 px-5 py-2 shadow-lg">
          <span className="text-sm font-semibold text-white">
            {pinLocation ? 'Pin dropped — drag to adjust' : 'Tap the map to drop a pin'}
          </span>
        </div>
      )}

      {!isSubmissionMode && filteredSpots.length === 0 && !showCommunityBanner && !emptyStateDismissed && (
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
        {filteredSpots.length > 0 && (
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
                {filteredSpots.map((spot) => (
                  <Marker
                    key={spot.id}
                    position={{ lat: spot.lat, lng: spot.lng }}
                    icon={createMarkerIcon(spot, activities)}
                    clusterer={clusterer}
                    onClick={() => handleMarkerClick(spot)}
                    zIndex={1000}
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
    </div>
  );
}
