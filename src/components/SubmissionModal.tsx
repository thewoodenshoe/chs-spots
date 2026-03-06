'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { SpotType } from './FilterModal';
import { useActivities } from '@/contexts/ActivitiesContext';
import { useToast } from './Toast';
import useSheetDrag from '@/hooks/useSheetDrag';
import VenuePicker, { VenueSearchResult } from './VenuePicker';
import ActivityPicker from './submission/ActivityPicker';
import PinStep from './submission/PinStep';
import DetailsForm from './submission/DetailsForm';
import type { ScheduleData } from './submission/DetailsForm';

export type NewVenueData = {
  name: string;
  address?: string;
  website?: string;
};

export type SubmitPayload = {
  title: string;
  submitterName: string;
  description: string;
  type: SpotType;
  lat?: number;
  lng?: number;
  photo?: File;
  venueId?: string;
  newVenue?: NewVenueData;
  timeStart?: string;
  timeEnd?: string;
  days?: number[];
  specificDate?: string;
  deals?: string;
};

interface SubmissionModalProps {
  isOpen: boolean;
  onClose: () => void;
  pinLocation: { lat: number; lng: number } | null;
  userLocation: { lat: number; lng: number } | null;
  defaultActivity?: SpotType | null;
  area?: string;
  onSubmit: (data: SubmitPayload) => void;
}

type Step = 'activity' | 'venue' | 'pin' | 'newVenue' | 'details';

export default function SubmissionModal({
  isOpen, onClose, pinLocation, userLocation, defaultActivity, area, onSubmit,
}: SubmissionModalProps) {
  const { activities } = useActivities();
  const { showToast } = useToast();

  const sheetRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { sheetHeight, startDrag } = useSheetDrag(isOpen);

  const [step, setStep] = useState<Step>('activity');
  const [selectedActivity, setSelectedActivity] = useState<SpotType>(defaultActivity || 'Happy Hour');
  const [selectedVenue, setSelectedVenue] = useState<VenueSearchResult | null>(null);
  const [newVenue, setNewVenue] = useState<NewVenueData>({ name: '' });
  const [title, setTitle] = useState('');
  const [submitterName, setSubmitterName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedPhoto, setSelectedPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isVenueRequired = useCallback((activityName: string): boolean => {
    const act = activities.find(a => a.name === activityName);
    return act?.venueRequired !== false;
  }, [activities]);

  useEffect(() => {
    if (isOpen) {
      setStep('activity');
      setSelectedActivity(defaultActivity || activities[0]?.name || 'Happy Hour');
      setSelectedVenue(null);
      setNewVenue({ name: '' });
      setTitle('');
      setSubmitterName('');
      setDescription('');
      setSelectedPhoto(null);
      setPhotoPreview(null);
      setIsSubmitting(false);
    }
  }, [isOpen, defaultActivity, activities]);

  const handleActivitySelect = (name: SpotType) => {
    setSelectedActivity(name);
    setStep(isVenueRequired(name) ? 'venue' : 'pin');
  };

  const handleVenueSelect = (venue: VenueSearchResult) => {
    setSelectedVenue(venue);
    setNewVenue({ name: '' });
    setTitle(venue.name);
    setStep('details');
  };

  const handleCreateNew = (prefillName: string) => {
    setSelectedVenue(null);
    setNewVenue({ name: prefillName });
    setTitle(prefillName);
    setStep('newVenue');
  };

  const handlePinContinue = () => {
    if (!pinLocation) {
      showToast('Please drop a pin on the map first', 'warning');
      return;
    }
    setStep('details');
  };

  const handleSubmit = async (e: React.FormEvent, schedule: ScheduleData) => {
    e.preventDefault();
    const isNewVenueFlow = step === 'newVenue';

    if (isNewVenueFlow && !newVenue.name.trim()) {
      showToast('Please enter a venue name', 'warning');
      return;
    }
    if (!isNewVenueFlow && !selectedVenue && !pinLocation) {
      showToast('Please select a venue or drop a pin on the map', 'warning');
      return;
    }
    if (!isNewVenueFlow && !selectedVenue && !title.trim()) {
      showToast('Please enter a title', 'warning');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: SubmitPayload = {
        title: selectedVenue ? selectedVenue.name : (newVenue.name.trim() || title.trim()),
        submitterName: submitterName.trim() || 'Anonymous',
        description: description.trim(),
        type: selectedActivity,
        photo: selectedPhoto || undefined,
        timeStart: schedule.timeStart || undefined,
        timeEnd: schedule.timeEnd || undefined,
        days: schedule.days.length > 0 ? schedule.days : undefined,
        specificDate: schedule.specificDate || undefined,
        deals: schedule.deals.trim() || undefined,
      };

      if (selectedVenue) {
        payload.venueId = selectedVenue.id;
      } else if (isNewVenueFlow) {
        payload.newVenue = {
          name: newVenue.name.trim(),
          address: newVenue.address?.trim() || undefined,
          website: newVenue.website?.trim() || undefined,
        };
        if (pinLocation) {
          payload.lat = pinLocation.lat;
          payload.lng = pinLocation.lng;
        }
      } else {
        payload.lat = pinLocation!.lat;
        payload.lng = pinLocation!.lng;
      }

      await onSubmit(payload);
      onClose();
    } catch {
      // Parent handles error toast
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBack = () => {
    if (step === 'details' && selectedVenue) setStep('venue');
    else if (step === 'details') setStep('pin');
    else if (step === 'newVenue') setStep('venue');
    else if (step === 'venue' || step === 'pin') setStep('activity');
    else onClose();
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedPhoto(file);
    const reader = new FileReader();
    reader.onloadend = () => setPhotoPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  if (!isOpen) return null;

  const stepTitle = {
    activity: area ? `Add in ${area}` : 'Add to Charleston Finds',
    venue: 'Select Venue',
    pin: 'Drop a Pin',
    newVenue: `New Venue + ${selectedActivity}`,
    details: selectedVenue ? `${selectedActivity} at ${selectedVenue.name}` : 'Add Details',
  }[step];

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/10 pointer-events-none" />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Submit a new spot"
        className="fixed bottom-0 left-0 right-0 z-50 bg-white shadow-2xl safe-area-bottom transition-transform duration-300 ease-out rounded-t-2xl"
        style={{ height: `${sheetHeight}px`, maxHeight: '92vh' }}
      >
        <div
          ref={handleRef}
          onMouseDown={startDrag}
          onTouchStart={startDrag}
          className="flex cursor-grab active:cursor-grabbing justify-center pt-3 pb-2 touch-none"
        >
          <div className="h-1.5 w-16 rounded-full bg-gray-300" />
        </div>

        <div className="flex flex-col h-[calc(100%-24px)] overflow-hidden">
          <div className="flex-shrink-0 px-5 pb-3 border-b border-gray-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {step !== 'activity' && (
                  <button onClick={handleBack} className="p-1 -ml-1 text-gray-400 hover:text-gray-600">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                )}
                <h2 className="text-base font-bold text-gray-800 truncate">{stepTitle}</h2>
              </div>
              <button
                onClick={onClose}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200"
                aria-label="Close"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0">
            {step === 'activity' && (
              <ActivityPicker activities={activities} onSelect={handleActivitySelect} />
            )}
            {step === 'venue' && (
              <VenuePicker
                activityType={selectedActivity}
                userLocation={userLocation}
                onSelect={handleVenueSelect}
                onCannotFind={() => { setSelectedVenue(null); setStep('pin'); }}
                onCreateNew={handleCreateNew}
              />
            )}
            {step === 'pin' && (
              <PinStep pinLocation={pinLocation} onContinue={handlePinContinue} />
            )}
            {step === 'newVenue' && (
              <DetailsForm
                isNewVenue
                newVenue={newVenue}
                onNewVenueChange={setNewVenue}
                selectedVenue={null}
                activityType={selectedActivity}
                title={title}
                setTitle={setTitle}
                submitterName={submitterName}
                setSubmitterName={setSubmitterName}
                description={description}
                setDescription={setDescription}
                photoPreview={photoPreview}
                fileInputRef={fileInputRef}
                onPhotoChange={handlePhotoChange}
                onRemovePhoto={() => {
                  setSelectedPhoto(null);
                  setPhotoPreview(null);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
                isSubmitting={isSubmitting}
                onSubmit={handleSubmit}
              />
            )}
            {step === 'details' && (
              <DetailsForm
                selectedVenue={selectedVenue}
                activityType={selectedActivity}
                title={title}
                setTitle={setTitle}
                submitterName={submitterName}
                setSubmitterName={setSubmitterName}
                description={description}
                setDescription={setDescription}
                photoPreview={photoPreview}
                fileInputRef={fileInputRef}
                onPhotoChange={handlePhotoChange}
                onRemovePhoto={() => {
                  setSelectedPhoto(null);
                  setPhotoPreview(null);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
                isSubmitting={isSubmitting}
                onSubmit={handleSubmit}
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
