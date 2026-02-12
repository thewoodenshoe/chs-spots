'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { GoogleMap, LoadScript, Marker, InfoWindow, MarkerClusterer } from '@react-google-maps/api';
import { useSpots, Spot } from '@/contexts/SpotsContext';
import { useVenues, Venue } from '@/contexts/VenuesContext';
import { useActivities } from '@/contexts/ActivitiesContext';
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

// Create custom marker icon URL for each spot type
function createMarkerIcon(spot: Spot, activities: Array<{ name: string; emoji: string; color: string }>): google.maps.Icon {
  const activityConfig = activities.find(a => a.name === spot.type);
  const emoji = activityConfig?.emoji || '📍';
  const color = activityConfig?.color || '#0d9488';
  
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

// Create red marker icon for venues (debugging/visualization)
function createVenueMarkerIcon(): google.maps.Icon {
  const svg = `
    <svg width="32" height="32" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="14" fill="#ef4444" stroke="white" stroke-width="2"/>
      <circle cx="16" cy="16" r="6" fill="white"/>
    </svg>
  `;
  
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(32, 32),
    anchor: new google.maps.Point(16, 32),
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
  selectedActivity: SpotType;
  isSubmissionMode?: boolean;
  pinLocation?: { lat: number; lng: number } | null;
  onMapClick?: (lat: number, lng: number) => void;
  mapCenter?: { lat: number; lng: number; zoom: number };
  onEditSpot?: (spot: Spot) => void;
  showAllVenues?: boolean;
}

export default function MapComponent({
  selectedArea,
  selectedActivity,
  isSubmissionMode = false,
  pinLocation,
  onMapClick,
  mapCenter,
  onEditSpot,
  showAllVenues = false,
}: MapComponentProps) {
  const { spots } = useSpots();
  const { venues } = useVenues();
  const { activities } = useActivities();
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedSpot, setSelectedSpot] = useState<Spot | null>(null);
  const [selectedVenue, setSelectedVenue] = useState<Venue | null>(null);
  const [center, setCenter] = useState<{ lat: number; lng: number }>(DEFAULT_CENTER);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

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

  // Reset map center and zoom when selectedArea or mapCenter changes
  // This ensures the map resets even if user manually zoomed out
  useEffect(() => {
    if (map && mapCenter) {
      map.setCenter({ lat: mapCenter.lat, lng: mapCenter.lng });
      map.setZoom(mapCenter.zoom);
    }
  }, [selectedArea, mapCenter, map]);

  // Filter spots based on area and activity
  const filteredSpots = useMemo(() => {
    return spots.filter((spot) => {
      const spotArea = getAreaFromCoordinates(spot.lat, spot.lng);
      const areaMatch = spotArea === selectedArea;
      const activityMatch = spot.type === selectedActivity;
      return areaMatch && activityMatch;
    });
  }, [spots, selectedArea, selectedActivity]);

  // Filter venues - when showAllVenues is true, show ALL venues regardless of area
  const filteredVenues = useMemo(() => {
    if (!showAllVenues) return [];
    // Show ALL venues when showAllVenues is true (no area filtering)
    return venues.filter((venue) => {
      // Only filter out venues without coordinates
      return venue.lat && venue.lng;
    });
  }, [venues, showAllVenues]);

  // Handle map click for submission mode
  const handleMapClick = useCallback((e: google.maps.MapMouseEvent) => {
    if (isSubmissionMode && e.latLng && onMapClick) {
      onMapClick(e.latLng.lat(), e.latLng.lng());
    }
  }, [isSubmissionMode, onMapClick]);

  // Handle marker click
  const handleMarkerClick = useCallback((spot: Spot) => {
    setSelectedSpot(spot);
    setSelectedVenue(null); // Close venue info window if open
  }, []);

  // Handle venue marker click
  const handleVenueMarkerClick = useCallback((venue: Venue) => {
    setSelectedVenue(venue);
    setSelectedSpot(null); // Close spot info window if open
  }, []);

  // Close info window
  const handleInfoWindowClose = useCallback(() => {
    setSelectedSpot(null);
    setSelectedVenue(null);
  }, []);

  // Format description with proper line breaks and bullet points
  // Preserves time ranges (e.g., "4pm-6pm") and creates clean bullet points
  const formatDescription = (description: string): React.ReactElement => {
    // Split by newlines first (preserves intentional line breaks)
    const rawLines = description.split('\n');
    
    const formattedLines: React.ReactElement[] = [];
    
    for (const rawLine of rawLines) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;
      
      // Check if line contains source attribution
      const sourceMatch = trimmed.match(/(.+?)\s*—\s*source:\s*(.+)/i) || trimmed.match(/(.+?)\s*source:\s*(.+)/i);
      
      if (sourceMatch) {
        const [, content, source] = sourceMatch;
        formattedLines.push(
          <div key={formattedLines.length} className="text-xs text-gray-600">
            <span>• {content.trim()}</span>
            <span className="text-gray-500 italic"> — source: {source.trim()}</span>
          </div>
        );
        continue;
      }
      
      // Check if line contains bullet separator (•)
      // If it's a time/day combination (e.g., "4pm-6pm • Monday-Friday"), keep it together
      // Otherwise, split by bullet for other cases
      if (trimmed.includes('•')) {
        // Check if this looks like a time/day combination
        // Pattern: contains time (pm/am) AND contains day names (Monday, Tuesday, etc.) or "Daily", "Weekday", etc.
        const hasTime = /\d+(?:am|pm|AM|PM)/i.test(trimmed);
        const hasDays = /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Daily|Weekday|Weekend|Weekdays|Weekends)/i.test(trimmed);
        
        if (hasTime && hasDays) {
          // Keep time and days together on one line
          formattedLines.push(
            <div key={formattedLines.length} className="text-xs text-gray-600">
              • {trimmed}
            </div>
          );
        } else {
          // Split by bullet for other cases
          const parts = trimmed.split('•').map(p => p.trim()).filter(p => p.length > 0);
          for (const part of parts) {
            formattedLines.push(
              <div key={formattedLines.length} className="text-xs text-gray-600">
                • {part}
              </div>
            );
          }
        }
      } else {
        // Single line without bullets - this is likely a special or standalone item
        formattedLines.push(
          <div key={formattedLines.length} className="text-xs text-gray-600">
            • {trimmed}
          </div>
        );
      }
    }
    
    return (
      <div className="space-y-1">
        {formattedLines}
      </div>
    );
  };

  // Haversine formula to calculate distance between two points in miles
  const calculateDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
    const R = 3959; // Earth's radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  // Find closest spot
  const findClosestSpot = useCallback(() => {
    if (!map || filteredSpots.length === 0) {
      setToastMessage('No spots available');
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }
    
    // Request location permission when button is clicked
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const userPos = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          };
          setUserLocation(userPos);
          
          // Calculate distances to all filtered spots from user location
          const spotsWithDistance = filteredSpots.map(spot => ({
            spot,
            distance: calculateDistance(userPos.lat, userPos.lng, spot.lat, spot.lng),
          }));
          
          // Find closest
          const closest = spotsWithDistance.reduce((prev, current) => 
            current.distance < prev.distance ? current : prev
          );
          
          // Show popup and toast
          setSelectedSpot(closest.spot);
          setToastMessage(`Closest: ${closest.spot.title} (${closest.distance.toFixed(1)} miles)`);
          
          // Center map on closest spot
          map.setCenter({ lat: closest.spot.lat, lng: closest.spot.lng });
          map.setZoom(15);
          
          // Clear toast after 3 seconds
          setTimeout(() => setToastMessage(null), 3000);
        },
        (error) => {
          // Location permission denied or error - use map center as fallback
          const origin = map.getCenter()?.toJSON() || center;
          if (!origin) {
            setToastMessage('Unable to determine location');
            setTimeout(() => setToastMessage(null), 3000);
            return;
          }
          
          // Calculate distances from map center
          const spotsWithDistance = filteredSpots.map(spot => ({
            spot,
            distance: calculateDistance(origin.lat, origin.lng, spot.lat, spot.lng),
          }));
          
          // Find closest
          const closest = spotsWithDistance.reduce((prev, current) => 
            current.distance < prev.distance ? current : prev
          );
          
          // Show popup and toast with note about using map center
          setSelectedSpot(closest.spot);
          setToastMessage(`Closest from map center: ${closest.spot.title} (${closest.distance.toFixed(1)} miles)`);
          
          // Center map on closest spot
          map.setCenter({ lat: closest.spot.lat, lng: closest.spot.lng });
          map.setZoom(15);
          
          // Clear toast after 3 seconds
          setTimeout(() => setToastMessage(null), 3000);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0, // Force fresh location
        }
      );
    } else {
      // Geolocation not supported - use map center
      const origin = map.getCenter()?.toJSON() || center;
      if (!origin) {
        setToastMessage('Location not supported');
        setTimeout(() => setToastMessage(null), 3000);
        return;
      }
      
      // Calculate distances from map center
      const spotsWithDistance = filteredSpots.map(spot => ({
        spot,
        distance: calculateDistance(origin.lat, origin.lng, spot.lat, spot.lng),
      }));
      
      // Find closest
      const closest = spotsWithDistance.reduce((prev, current) => 
        current.distance < prev.distance ? current : prev
      );
      
      // Show popup and toast
      setSelectedSpot(closest.spot);
      setToastMessage(`Closest from map center: ${closest.spot.title} (${closest.distance.toFixed(1)} miles)`);
      
      // Center map on closest spot
      map.setCenter({ lat: closest.spot.lat, lng: closest.spot.lng });
      map.setZoom(15);
      
      // Clear toast after 3 seconds
      setTimeout(() => setToastMessage(null), 3000);
    }
  }, [map, filteredSpots, center]);

  // Listen for findClosestSpot event
  useEffect(() => {
    const handleFindClosest = () => {
      findClosestSpot();
    };
    
    window.addEventListener('findClosestSpot', handleFindClosest);
    return () => {
      window.removeEventListener('findClosestSpot', handleFindClosest);
    };
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

  return (
    <>
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-20 left-1/2 z-[60] -translate-x-1/2 animate-slide-down rounded-lg bg-gray-900 px-4 py-3 text-sm font-medium text-white shadow-2xl safe-area-top">
          {toastMessage}
        </div>
      )}
      
      <LoadScript googleMapsApiKey={GOOGLE_MAPS_API_KEY}>
        <GoogleMap
          mapContainerStyle={mapContainerStyle}
          center={mapCenter ? { lat: mapCenter.lat, lng: mapCenter.lng } : center}
          zoom={mapCenter ? mapCenter.zoom : zoom}
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
                    icon={createMarkerIcon(spot, activities)}
                    clusterer={clusterer}
                    onClick={() => handleMarkerClick(spot)}
                    zIndex={1000} // Spots appear above venues
                  />
                ))}
              </>
            )}
          </MarkerClusterer>
        )}

        {/* All Venues (Red Markers) - Debugging/Visualization */}
        {showAllVenues && filteredVenues.length > 0 && (
          <MarkerClusterer>
            {(clusterer) => (
              <>
                {filteredVenues.map((venue) => (
                  <Marker
                    key={venue.id}
                    position={{ lat: venue.lat, lng: venue.lng }}
                    icon={createVenueMarkerIcon()}
                    clusterer={clusterer}
                    onClick={() => handleVenueMarkerClick(venue)}
                    zIndex={500} // Venues appear below spots
                  />
                ))}
              </>
            )}
          </MarkerClusterer>
        )}

        {/* User Location Marker (Blue Dot) */}
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

        {/* InfoWindow for selected spot */}
        {selectedSpot && (
          <InfoWindow
            position={{ lat: selectedSpot.lat, lng: selectedSpot.lng }}
            onCloseClick={handleInfoWindowClose}
          >
            <div className="text-sm min-w-[200px] max-w-[300px]">
              <div className="font-bold text-gray-900 mb-1 text-base">{selectedSpot.title}</div>
              
              {/* Pending badge for admin */}
              {selectedSpot.status === 'pending' && (
                <div className="mb-2">
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                    Pending Approval
                  </span>
                </div>
              )}
              
              {/* Structured happy hour display with labels */}
              {selectedSpot.happyHourTime && (
                <div className="mb-2">
                  <span className="font-semibold text-gray-700">Time: </span>
                  <span className="text-gray-800">{selectedSpot.happyHourTime}</span>
                </div>
              )}
              
              {selectedSpot.happyHourList && selectedSpot.happyHourList.length > 0 && (
                <div className="mb-2">
                  <div className="font-semibold text-gray-700 mb-1">Happy Hour List:</div>
                  <ul className="list-disc list-inside text-gray-800 space-y-0.5 ml-2">
                    {selectedSpot.happyHourList.map((item, idx) => (
                      <li key={idx} className="text-xs">{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              
              {selectedSpot.sourceUrl && (
                <div className="mb-2">
                  <span className="font-semibold text-gray-700">Source: </span>
                  <a 
                    href={selectedSpot.sourceUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline text-xs break-all"
                  >
                    {selectedSpot.sourceUrl}
                  </a>
                </div>
              )}
              
              {selectedSpot.lastUpdateDate && (
                <div className="mb-2">
                  <span className="font-semibold text-gray-700">Last Update Date: </span>
                  <span className="text-gray-800 text-xs">
                    {new Date(selectedSpot.lastUpdateDate).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric'
                    })}
                  </span>
                </div>
              )}
              
              {/* Fallback to description if new fields not available (backwards compatibility) */}
              {!selectedSpot.happyHourTime && !selectedSpot.happyHourList && selectedSpot.description && (
                <div className="mb-3">
                  {formatDescription(selectedSpot.description)}
                </div>
              )}
              
              <div className="mt-2 flex items-center gap-2 mb-2">
                <span className="text-base">
                  {activities.find(a => a.name === selectedSpot.type)?.emoji || '📍'}
                </span>
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
                  className="mt-3 w-full rounded-lg bg-teal-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-teal-700 touch-manipulation"
                >
                  Edit Spot
                </button>
              )}
            </div>
          </InfoWindow>
        )}

        {/* InfoWindow for selected venue (red marker) */}
        {selectedVenue && (
          <InfoWindow
            position={{ lat: selectedVenue.lat, lng: selectedVenue.lng }}
            onCloseClick={handleInfoWindowClose}
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
                  className="text-xs text-blue-600 hover:underline break-all"
                >
                  {selectedVenue.website}
                </a>
              )}
              <div className="mt-2 text-xs text-gray-500 italic">
                (Venue - No happy hour info)
              </div>
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
    </>
  );
}
