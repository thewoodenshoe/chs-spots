'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { GoogleMap, LoadScript, Marker, InfoWindow, MarkerClusterer } from '@react-google-maps/api';
import { useSpots, Spot } from '@/contexts/SpotsContext';
import { Area, SpotType } from './FilterModal';

// Google Maps API key - set in .env.local as NEXT_PUBLIC_GOOGLE_MAPS_KEY
const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || '';

// Default center: Daniel Island
const DEFAULT_CENTER = { lat: 32.845, lng: -79.908 };
const DEFAULT_ZOOM = 14;

// Map container style
const mapContainerStyle = {
  width: '100%',
  height: '100%',
};

// Emoji/icons for each spot type
const typeIcons: Record<SpotType, string> = {
  'Christmas Spots': '🎄',
  'Happy Hour': '🍹',
  'Fishing Spots': '🎣',
  'Sunset Spots': '🌅',
  'Pickleball Games': '🏓',
  'Bike Routes': '🚴',
  'Golf Cart Hacks': '🛺',
};

// Color mapping for each spot type
const typeColors: Record<SpotType, string> = {
  'Christmas Spots': '#f97316', // orange/coral
  'Happy Hour': '#0d9488', // teal
  'Fishing Spots': '#0284c7', // blue
  'Sunset Spots': '#f59e0b', // amber
  'Pickleball Games': '#10b981', // green
  'Bike Routes': '#6366f1', // indigo
  'Golf Cart Hacks': '#8b5cf6', // purple
};

// Create custom marker icon URL for each spot type
function createMarkerIcon(spot: Spot): google.maps.Icon {
  const emoji = typeIcons[spot.type];
  const color = typeColors[spot.type];
  
  // Create a data URL for the marker icon
  const svg = `
    <svg width="40" height="40" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="18" fill="${color}" stroke="white" stroke-width="3"/>
      <text x="20" y="28" font-size="20" text-anchor="middle" fill="white">${emoji}</text>
    </svg>
  `;
  
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(40, 40),
    anchor: new google.maps.Point(20, 40),
  };
}

// Helper function to determine area from coordinates
function getAreaFromCoordinates(lat: number, lng: number): Area {
  if (lat >= 32.83 && lat <= 32.86 && lng >= -79.92 && lng <= -79.89) {
    return 'Daniel Island';
  } else if (lat >= 32.78 && lat <= 32.82 && lng >= -79.88 && lng <= -79.82) {
    return 'Mount Pleasant';
  } else if (lat >= 32.70 && lat <= 32.75 && lng >= -79.96 && lng <= -79.90) {
    return 'James Island';
  } else if (lat >= 32.76 && lat <= 32.80 && lng >= -79.95 && lng <= -79.92) {
    return 'Downtown Charleston';
  } else if (lat >= 32.75 && lat <= 32.78 && lng >= -79.85 && lng <= -79.82) {
    return 'Sullivan\'s Island';
  }
  return 'Daniel Island'; // Default
}

interface MapComponentProps {
  selectedArea: Area;
  selectedActivity: SpotType | null;
  isSubmissionMode?: boolean;
  pinLocation?: { lat: number; lng: number } | null;
  onMapClick?: (lat: number, lng: number) => void;
  mapCenter?: { lat: number; lng: number; zoom: number };
  onEditSpot?: (spot: Spot) => void;
}

export default function MapComponent({
  selectedArea,
  selectedActivity,
  isSubmissionMode = false,
  pinLocation,
  onMapClick,
  mapCenter,
  onEditSpot,
}: MapComponentProps) {
  const { spots } = useSpots();
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedSpot, setSelectedSpot] = useState<Spot | null>(null);
  const [center, setCenter] = useState<{ lat: number; lng: number }>(DEFAULT_CENTER);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);

  // Request user geolocation on load
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const userPos = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          };
          setUserLocation(userPos);
          // Only center on user if they're in the Charleston area (rough bounds)
          if (
            userPos.lat >= 32.6 && userPos.lat <= 32.9 &&
            userPos.lng >= -80.0 && userPos.lng <= -79.7
          ) {
            setCenter(userPos);
            setZoom(14);
          }
        },
        (error) => {
          console.log('Geolocation denied or error:', error);
          // Fallback to default center (Daniel Island)
        }
      );
    }
  }, []);

  // Update center/zoom from props
  useEffect(() => {
    if (mapCenter) {
      setCenter({ lat: mapCenter.lat, lng: mapCenter.lng });
      setZoom(mapCenter.zoom);
    }
  }, [mapCenter]);

  // Filter spots based on area and activity
  const filteredSpots = useMemo(() => {
    return spots.filter((spot) => {
      const spotArea = getAreaFromCoordinates(spot.lat, spot.lng);
      const areaMatch = spotArea === selectedArea;
      const activityMatch = selectedActivity === null || spot.type === selectedActivity;
      return areaMatch && activityMatch;
    });
  }, [spots, selectedArea, selectedActivity]);

  // Handle map click for submission mode
  const handleMapClick = useCallback((e: google.maps.MapMouseEvent) => {
    if (isSubmissionMode && e.latLng && onMapClick) {
      onMapClick(e.latLng.lat(), e.latLng.lng());
    }
  }, [isSubmissionMode, onMapClick]);

  // Handle marker click
  const handleMarkerClick = useCallback((spot: Spot) => {
    setSelectedSpot(spot);
  }, []);

  // Close info window
  const handleInfoWindowClose = useCallback(() => {
    setSelectedSpot(null);
  }, []);

  // Format description with bullet points
  const formatDescription = (description: string): string => {
    // Split by common separators and create bullet points
    const lines = description
      .split(/[•\n\-]/)
      .map(line => line.trim())
      .filter(line => line.length > 0);
    
    return lines.map(line => `• ${line}`).join('\n');
  };

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

  return (
    <LoadScript googleMapsApiKey={GOOGLE_MAPS_API_KEY}>
      <GoogleMap
        mapContainerStyle={mapContainerStyle}
        center={center}
        zoom={zoom}
        onClick={handleMapClick}
        onLoad={(map) => setMap(map)}
        options={{
          fullscreenControl: false,
          mapTypeControl: false,
          streetViewControl: false,
          gestureHandling: 'greedy', // Mobile-friendly touch gestures
        }}
      >
        {/* Curated Spots with Clustering */}
        {filteredSpots.length > 0 && (
          <MarkerClusterer>
            {(clusterer) => (
              <>
                {filteredSpots.map((spot) => (
                  <Marker
                    key={spot.id}
                    position={{ lat: spot.lat, lng: spot.lng }}
                    icon={createMarkerIcon(spot)}
                    clusterer={clusterer}
                    onClick={() => handleMarkerClick(spot)}
                  />
                ))}
              </>
            )}
          </MarkerClusterer>
        )}

        {/* InfoWindow for selected spot */}
        {selectedSpot && (
          <InfoWindow
            position={{ lat: selectedSpot.lat, lng: selectedSpot.lng }}
            onCloseClick={handleInfoWindowClose}
          >
            <div className="text-sm min-w-[200px] max-w-[300px]">
              <div className="font-semibold text-gray-800 mb-2">{selectedSpot.title}</div>
              {selectedSpot.description && (
                <div className="text-xs text-gray-600 mb-2 whitespace-pre-line">
                  {formatDescription(selectedSpot.description)}
                </div>
              )}
              <div className="mt-2 flex items-center gap-2 mb-2">
                <span className="text-base">{typeIcons[selectedSpot.type]}</span>
                <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-medium text-teal-800">
                  {selectedSpot.type}
                </span>
              </div>
              {selectedSpot.photoUrl && (
                <img
                  src={selectedSpot.photoUrl}
                  alt={selectedSpot.title}
                  className="mt-2 h-32 w-full rounded-lg object-cover"
                />
              )}
              {onEditSpot && (
                <button
                  onClick={() => {
                    onEditSpot(selectedSpot);
                    handleInfoWindowClose();
                  }}
                  className="mt-3 w-full rounded-lg bg-teal-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-teal-700"
                >
                  Edit Spot
                </button>
              )}
            </div>
          </InfoWindow>
        )}

        {/* Temporary pin for submission mode */}
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
    </LoadScript>
  );
}
