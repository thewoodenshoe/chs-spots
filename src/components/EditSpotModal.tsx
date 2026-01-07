'use client';

import { useEffect, useRef, useState } from 'react';
import { SpotType } from './FilterModal';
import { Spot } from '@/contexts/SpotsContext';
import { Pencil } from 'lucide-react';

const ACTIVITIES: SpotType[] = [
  'Christmas Spots',
  'Happy Hour',
  'Fishing Spots',
  'Sunset Spots',
  'Pickleball Games',
  'Bike Routes',
  'Golf Cart Hacks',
];

interface EditSpotModalProps {
  isOpen: boolean;
  onClose: () => void;
  spot: Spot | null;
  pinLocation: { lat: number; lng: number } | null;
  onMapClick?: (lat: number, lng: number) => void;
  onSubmit: (data: {
    id: number;
    title: string;
    description: string;
    type: SpotType;
    lat: number;
    lng: number;
    photoUrl?: string;
    photo?: File;
  }) => Promise<void>;
  onDelete?: (id: number) => Promise<void>;
}

export default function EditSpotModal({
  isOpen,
  onClose,
  spot,
  pinLocation: externalPinLocation,
  onMapClick,
  onSubmit,
  onDelete,
}: EditSpotModalProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const resizeHandleRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedActivity, setSelectedActivity] = useState<SpotType>('Happy Hour');
  const [selectedPhoto, setSelectedPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [pinLocation, setPinLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [sheetHeight, setSheetHeight] = useState(400);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [startY, setStartY] = useState(0);
  const [startHeight, setStartHeight] = useState(0);

  // Initialize form with spot data
  useEffect(() => {
    if (spot && isOpen) {
      setTitle(spot.title);
      setDescription(spot.description || '');
      setSelectedActivity(spot.type);
      setPhotoPreview(spot.photoUrl || null);
      setSelectedPhoto(null);
    }
  }, [spot, isOpen]);

  // Sync external pin location
  useEffect(() => {
    if (externalPinLocation) {
      setPinLocation(externalPinLocation);
    } else if (spot && isOpen) {
      setPinLocation({ lat: spot.lat, lng: spot.lng });
    }
  }, [externalPinLocation, spot, isOpen]);

  // Handle drag for moving sheet up/down
  useEffect(() => {
    if (!isOpen) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging && handleRef.current) {
        const deltaY = startY - e.clientY;
        const newHeight = Math.min(Math.max(300, startHeight + deltaY), window.innerHeight * 0.9);
        setSheetHeight(newHeight);
      }
      if (isResizing && resizeHandleRef.current) {
        const deltaY = startY - e.clientY;
        const newHeight = Math.min(Math.max(300, startHeight + deltaY), window.innerHeight * 0.9);
        setSheetHeight(newHeight);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
    };

    if (isDragging || isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, isResizing, startY, startHeight, isOpen]);

  // Touch support for mobile
  useEffect(() => {
    if (!isOpen) return;

    const handleTouchMove = (e: TouchEvent) => {
      if (isDragging && handleRef.current && e.touches[0]) {
        const deltaY = startY - e.touches[0].clientY;
        const newHeight = Math.min(Math.max(300, startHeight + deltaY), window.innerHeight * 0.9);
        setSheetHeight(newHeight);
      }
      if (isResizing && resizeHandleRef.current && e.touches[0]) {
        const deltaY = startY - e.touches[0].clientY;
        const newHeight = Math.min(Math.max(300, startHeight + deltaY), window.innerHeight * 0.9);
        setSheetHeight(newHeight);
      }
    };

    const handleTouchEnd = () => {
      setIsDragging(false);
      setIsResizing(false);
    };

    if (isDragging || isResizing) {
      document.addEventListener('touchmove', handleTouchMove);
      document.addEventListener('touchend', handleTouchEnd);
      return () => {
        document.removeEventListener('touchmove', handleTouchMove);
        document.removeEventListener('touchend', handleTouchEnd);
      };
    }
  }, [isDragging, isResizing, startY, startHeight, isOpen]);

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedPhoto(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPhotoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!spot || !pinLocation) {
      alert('Please ensure location is set');
      return;
    }
    if (!title.trim()) {
      alert('Please enter a title');
      return;
    }

    try {
      await onSubmit({
        id: spot.id,
        title: title.trim(),
        description: description.trim(),
        type: selectedActivity,
        lat: pinLocation.lat,
        lng: pinLocation.lng,
        photo: selectedPhoto || undefined,
        photoUrl: selectedPhoto ? undefined : spot.photoUrl, // Keep existing if no new photo
      });
      handleClose();
    } catch (error) {
      console.error('Error updating spot:', error);
      alert('Failed to update spot. Please try again.');
    }
  };

  const handleDelete = async () => {
    if (!spot || !onDelete) return;

    const confirmed = window.confirm(
      `Are you sure you want to delete "${spot.title}"? This action cannot be undone.`
    );

    if (confirmed) {
      try {
        await onDelete(spot.id);
        handleClose();
      } catch (error) {
        console.error('Error deleting spot:', error);
        alert('Failed to delete spot. Please try again.');
      }
    }
  };

  const handleClose = () => {
    onClose();
  };

  const startDrag = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    setStartY(clientY);
    setStartHeight(sheetHeight);
  };

  const startResize = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    setStartY(clientY);
    setStartHeight(sheetHeight);
  };

  if (!isOpen || !spot) return null;

  return (
    <>
      {/* Subtle map dimming overlay */}
      <div
        className="fixed inset-0 z-40 bg-black/10 pointer-events-none transition-opacity"
        style={{ opacity: isOpen ? 1 : 0 }}
      />

      {/* Bottom Sheet */}
      <div
        ref={sheetRef}
        className="fixed bottom-0 left-0 right-0 z-50 bg-white shadow-2xl safe-area-bottom transition-transform duration-300 ease-out"
        style={{
          height: `${sheetHeight}px`,
          maxHeight: '90vh',
        }}
      >
        {/* Draggable Handle */}
        <div
          ref={handleRef}
          onMouseDown={startDrag}
          onTouchStart={startDrag}
          className="flex cursor-grab active:cursor-grabbing justify-center pt-3 pb-2 touch-none"
        >
          <div className="h-1.5 w-16 rounded-full bg-gray-300" />
        </div>

        {/* Resize Handle (desktop only) */}
        <div
          ref={resizeHandleRef}
          onMouseDown={startResize}
          className="hidden md:block absolute top-0 left-0 right-0 h-2 cursor-ns-resize"
        />

        <div className="flex flex-col h-full overflow-hidden">
          {/* Header with instruction */}
          <div className="flex-shrink-0 px-6 pb-4 border-b border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Pencil className="h-5 w-5 text-teal-600" />
                <h2 className="text-xl font-bold text-gray-800">Edit Spot</h2>
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-600 transition-colors hover:bg-gray-200"
                aria-label="Close edit form"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
            {/* Pin Location Status */}
            <div className="rounded-xl bg-teal-50 p-3">
              <div className="flex items-center gap-2">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4 text-teal-600 flex-shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
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
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-teal-800 truncate">
                    {pinLocation ? 'Location updated' : 'Location not set'}
                  </p>
                  <p className="text-xs text-teal-600 truncate">
                    {pinLocation 
                      ? `${pinLocation.lat.toFixed(5)}, ${pinLocation.lng.toFixed(5)}`
                      : 'Tap on the map to change location'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Scrollable Form Content */}
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-4">
            {/* Title */}
            <div className="mb-4">
              <label className="mb-2 block text-sm font-semibold text-gray-700">
                Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Best Sunset View"
                className="w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-base text-gray-800 placeholder-gray-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                required
              />
            </div>

            {/* Description */}
            <div className="mb-4">
              <label className="mb-2 block text-sm font-semibold text-gray-700">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Tell us about this spot..."
                rows={3}
                className="w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-base text-gray-800 placeholder-gray-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 resize-none"
              />
            </div>

            {/* Activity Selection */}
            <div className="mb-4">
              <label className="mb-2 block text-sm font-semibold text-gray-700">
                Activity <span className="text-red-500">*</span>
              </label>
              <select
                value={selectedActivity}
                onChange={(e) => setSelectedActivity(e.target.value as SpotType)}
                className="w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-base text-gray-800 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                required
              >
                {ACTIVITIES.map((activity) => (
                  <option key={activity} value={activity}>
                    {activity}
                  </option>
                ))}
              </select>
            </div>

            {/* Photo Upload */}
            <div className="mb-6">
              <label className="mb-2 block text-sm font-semibold text-gray-700">
                Photo (optional)
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handlePhotoChange}
                className="hidden"
              />
              {photoPreview ? (
                <div className="space-y-2">
                  <img
                    src={photoPreview}
                    alt="Preview"
                    className="h-32 w-full rounded-xl object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPhoto(null);
                      setPhotoPreview(spot.photoUrl || null);
                      if (fileInputRef.current) {
                        fileInputRef.current.value = '';
                      }
                    }}
                    className="w-full rounded-xl border-2 border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    Remove Photo
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-gray-600 transition-colors hover:border-teal-400 hover:bg-teal-50"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-6 w-6"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                  <span className="font-medium">Upload Photo</span>
                </button>
              )}
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={!pinLocation || !title.trim()}
              className="w-full rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500 px-6 py-4 text-base font-bold text-white shadow-lg transition-all hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:shadow-lg mb-3"
            >
              Update Spot
            </button>

            {/* Delete Button */}
            {onDelete && (
              <button
                type="button"
                onClick={handleDelete}
                className="w-full rounded-xl border-2 border-red-500 bg-white px-6 py-4 text-base font-bold text-red-600 shadow-lg transition-all hover:bg-red-50 hover:shadow-xl mb-4"
              >
                Delete Spot
              </button>
            )}
          </form>
        </div>
      </div>
    </>
  );
}

