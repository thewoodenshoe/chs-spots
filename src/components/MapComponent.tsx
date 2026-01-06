'use client';

import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Area, SpotType } from './FilterModal';
import { useSpots, Spot } from '@/contexts/SpotsContext';

// Fix for default marker icons in Next.js
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

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

// Create custom marker icon for each spot type
function createCustomMarkerIcon(spot: Spot): L.DivIcon {
  const emoji = typeIcons[spot.type];
  const color = typeColors[spot.type];
  
  return L.divIcon({
    className: 'custom-marker',
    html: `<div style="
      width: 40px;
      height: 40px;
      background-color: ${color};
      border: 3px solid white;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      transition: transform 0.2s;
    ">${emoji}</div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 40],
    popupAnchor: [0, -40],
  });
}

// Custom icon for dropped pin (temporary pin) - using divIcon for a red marker
const tempPinIcon = L.divIcon({
  className: 'custom-temp-pin',
  html: `<div style="
    width: 30px;
    height: 30px;
    background-color: #ef4444;
    border: 3px solid white;
    border-radius: 50% 50% 50% 0;
    transform: rotate(-45deg);
    box-shadow: 0 3px 14px rgba(0,0,0,0.4);
  "></div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 30],
  popupAnchor: [0, -30],
});

// Component to handle map clicks when in submission mode
function MapClickHandler({
  isSubmissionMode,
  onMapClick,
}: {
  isSubmissionMode: boolean;
  onMapClick: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click: (e) => {
      if (isSubmissionMode) {
        onMapClick(e.latlng.lat, e.latlng.lng);
      }
    },
  });
  return null;
}

// Helper function to determine area from coordinates
function getAreaFromCoordinates(lat: number, lng: number): Area {
  // Simple approximation - in production, use proper geocoding
  if (lat >= 32.83 && lat <= 32.86 && lng >= -79.92 && lng <= -79.89) {
    return 'Daniel Island';
  } else if (lat >= 32.78 && lat <= 32.82 && lng >= -79.88 && lng <= -79.82) {
    return 'Mount Pleasant';
  } else if (lat >= 32.75 && lat <= 32.78 && lng >= -79.85 && lng <= -79.82) {
    return 'Sullivan\'s Island';
  }
  return 'Daniel Island'; // Default
}

interface MapComponentProps {
  selectedArea: Area;
  selectedTypes: SpotType[];
  isSubmissionMode?: boolean;
  pinLocation?: { lat: number; lng: number } | null;
  onMapClick?: (lat: number, lng: number) => void;
}

export default function MapComponent({
  selectedArea,
  selectedTypes,
  isSubmissionMode = false,
  pinLocation,
  onMapClick,
}: MapComponentProps) {
  const { spots } = useSpots();

  // Filter spots based on area and types
  const filteredSpots = spots.filter((spot) => {
    const spotArea = getAreaFromCoordinates(spot.lat, spot.lng);
    const areaMatch = spotArea === selectedArea;
    const typeMatch = selectedTypes.length === 0 || selectedTypes.includes(spot.type);
    return areaMatch && typeMatch;
  });

  return (
    <MapContainer
      center={[32.845, -79.908]}
      zoom={13}
      style={{ height: '100%', width: '100%', zIndex: 0 }}
      scrollWheelZoom={true}
    >
      {/* Use CyclOSM for a cleaner, more modern look */}
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | Tiles style by <a href="https://www.cyclosm.org">CyclOSM</a>'
        url="https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      <MapClickHandler
        isSubmissionMode={isSubmissionMode}
        onMapClick={onMapClick || (() => {})}
      />
      {filteredSpots.map((spot) => (
        <Marker key={spot.id} position={[spot.lat, spot.lng]} icon={createCustomMarkerIcon(spot)}>
          <Popup className="custom-popup">
            <div className="text-sm min-w-[200px]">
              <div className="font-semibold text-gray-800 mb-1">{spot.title}</div>
              {spot.description && (
                <div className="mt-1 text-xs text-gray-600 mb-2">{spot.description}</div>
              )}
              <div className="mt-2 flex items-center gap-2">
                <span className="text-base">{typeIcons[spot.type]}</span>
                <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-medium text-teal-800">
                  {spot.type}
                </span>
              </div>
              {spot.photoUrl && (
                <img
                  src={spot.photoUrl}
                  alt={spot.title}
                  className="mt-2 h-32 w-full rounded-lg object-cover"
                />
              )}
            </div>
          </Popup>
        </Marker>
      ))}
      {/* Temporary pin for submission */}
      {isSubmissionMode && pinLocation && (
        <Marker position={[pinLocation.lat, pinLocation.lng]} icon={tempPinIcon}>
          <Popup>
            <div className="text-sm font-medium text-gray-800">
              New spot location
            </div>
          </Popup>
        </Marker>
      )}
    </MapContainer>
  );
}

