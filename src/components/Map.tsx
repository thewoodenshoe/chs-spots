'use client';

import { useMemo, useCallback } from 'react';
import { GoogleMap, LoadScript, Marker, InfoWindow } from '@react-google-maps/api';
import { useState } from 'react';

interface Spot {
  title: string;
  lat: number;
  lng: number;
  description?: string;
  activity?: string;
  area?: string;
  happyHourTime?: string;
  happyHourList?: string[];
  sourceUrl?: string;
  lastUpdateDate?: string;
}

interface MapProps {
  spots: Spot[];
  selectedArea?: string;
  selectedActivity?: string;
}

const containerStyle = {
  width: '100%',
  height: '100%'
};

const defaultCenter = {
  lat: 32.7765,
  lng: -79.9311
};

export default function Map({ spots, selectedArea, selectedActivity }: MapProps) {
  const [selectedSpot, setSelectedSpot] = useState<Spot | null>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);

  // Filter spots based on selected area and activity
  const filteredSpots = useMemo(() => {
    return spots.filter(spot => {
      if (selectedArea && spot.area && spot.area !== selectedArea) return false;
      if (selectedActivity && spot.activity && spot.activity !== selectedActivity) return false;
      return true;
    });
  }, [spots, selectedArea, selectedActivity]);

  // Calculate center based on filtered spots
  const center = useMemo(() => {
    if (filteredSpots.length === 0) return defaultCenter;
    
    const avgLat = filteredSpots.reduce((sum, spot) => sum + spot.lat, 0) / filteredSpots.length;
    const avgLng = filteredSpots.reduce((sum, spot) => sum + spot.lng, 0) / filteredSpots.length;
    return { lat: avgLat, lng: avgLng };
  }, [filteredSpots]);

  const onLoad = useCallback((map: google.maps.Map) => {
    setMap(map);
    // Fit bounds to show all markers
    if (filteredSpots.length > 0) {
      const bounds = new google.maps.LatLngBounds();
      filteredSpots.forEach(spot => {
        bounds.extend({ lat: spot.lat, lng: spot.lng });
      });
      map.fitBounds(bounds);
    }
  }, [filteredSpots]);

  const onUnmount = useCallback(() => {
    setMap(null);
  }, []);

  // Get Google Maps API key from environment variable
  // Next.js automatically exposes NEXT_PUBLIC_* variables to client components
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';

  if (!apiKey) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-50">
        <div className="text-center p-6 bg-white rounded-lg shadow-md max-w-md">
          <p className="text-lg font-semibold mb-2 text-gray-800">Google Maps API Key Required</p>
          <p className="text-sm text-gray-600 mb-4">
            Please create a <code className="bg-gray-100 px-2 py-1 rounded">.env.local</code> file in your project root with:
          </p>
          <code className="block text-xs bg-gray-100 p-3 rounded text-left">
            NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_api_key_here
          </code>
        </div>
      </div>
    );
  }

  return (
    <LoadScript googleMapsApiKey={apiKey}>
      <GoogleMap
        mapContainerStyle={containerStyle}
        center={center}
        zoom={10}
        onLoad={onLoad}
        onUnmount={onUnmount}
        options={{
          zoomControl: true,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: true,
        }}
      >
        {filteredSpots.map((spot, index) => (
          <Marker
            key={index}
            position={{ lat: spot.lat, lng: spot.lng }}
            onClick={() => setSelectedSpot(spot)}
            title={spot.title}
          />
        ))}
        
        {selectedSpot && (
          <InfoWindow
            position={{ lat: selectedSpot.lat, lng: selectedSpot.lng }}
            onCloseClick={() => setSelectedSpot(null)}
          >
            <div className="p-2 max-w-xs">
              <h3 className="font-semibold text-lg mb-2">{selectedSpot.title}</h3>
              {selectedSpot.area && (
                <p className="text-sm text-gray-600 mb-1">📍 {selectedSpot.area}</p>
              )}
              {selectedSpot.activity && (
                <p className="text-sm text-blue-600 font-medium mb-2">
                  {selectedSpot.activity}
                </p>
              )}
              
              {/* Structured happy hour display with labels */}
              {selectedSpot?.happyHourTime && (
                <div className="mb-2">
                  <span className="font-semibold text-gray-700 text-sm">Time: </span>
                  <span className="text-gray-800 text-sm">{selectedSpot.happyHourTime}</span>
                </div>
              )}
              
              {selectedSpot.happyHourList && selectedSpot.happyHourList.length > 0 && (
                <div className="mb-2">
                  <div className="font-semibold text-gray-700 text-sm mb-1">Happy Hour List:</div>
                  <ul className="list-disc list-inside text-gray-800 space-y-0.5 ml-2">
                    {selectedSpot.happyHourList.map((item, idx) => (
                      <li key={idx} className="text-xs">{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              
              {selectedSpot.sourceUrl && (
                <div className="mb-2">
                  <span className="font-semibold text-gray-700 text-sm">Source: </span>
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
                  <span className="font-semibold text-gray-700 text-sm">Last Update Date: </span>
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
                <div className="text-sm text-gray-700 whitespace-pre-wrap">
                  {selectedSpot.description.substring(0, 200)}
                  {selectedSpot.description.length > 200 ? '...' : ''}
                </div>
              )}
            </div>
          </InfoWindow>
        )}
      </GoogleMap>
    </LoadScript>
  );
}
