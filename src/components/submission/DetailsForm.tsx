'use client';

import type { VenueSearchResult } from '@/components/VenuePicker';

interface DetailsFormProps {
  selectedVenue: VenueSearchResult | null;
  title: string;
  setTitle: (v: string) => void;
  submitterName: string;
  setSubmitterName: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  photoPreview: string | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onPhotoChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemovePhoto: () => void;
  isSubmitting: boolean;
  onSubmit: (e: React.FormEvent) => void;
}

export default function DetailsForm({
  selectedVenue, title, setTitle, submitterName, setSubmitterName,
  description, setDescription, photoPreview, fileInputRef,
  onPhotoChange, onRemovePhoto, isSubmitting, onSubmit,
}: DetailsFormProps) {
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {selectedVenue && (
        <div className="rounded-xl bg-teal-50 border border-teal-200 px-3 py-2.5">
          <div className="text-sm font-semibold text-teal-800">{selectedVenue.name}</div>
          <div className="text-xs text-teal-600">{selectedVenue.area || selectedVenue.address}</div>
        </div>
      )}

      {!selectedVenue && (
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-700">
            Spot Name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Best Sunset View"
            className="w-full rounded-xl border-2 border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
            required
          />
        </div>
      )}

      <div>
        <label className="mb-1 block text-xs font-semibold text-gray-700">
          Your Name <span className="text-xs font-normal text-gray-400">(optional)</span>
        </label>
        <input
          type="text"
          value={submitterName}
          onChange={(e) => setSubmitterName(e.target.value)}
          placeholder="e.g., John D."
          className="w-full rounded-xl border-2 border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-gray-700">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Tell us about this spot..."
          rows={2}
          className="w-full rounded-xl border-2 border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 resize-none"
        />
      </div>

      <div>
        <label htmlFor="photo-upload-detail" className="mb-1 block text-xs font-semibold text-gray-700">
          Photo <span className="text-xs font-normal text-gray-400">(optional)</span>
        </label>
        <input id="photo-upload-detail" ref={fileInputRef} type="file" accept="image/*" onChange={onPhotoChange} className="hidden" />
        {photoPreview ? (
          <div className="space-y-2">
            <img src={photoPreview} alt="Preview" className="h-24 w-full rounded-xl object-cover" />
            <button type="button" onClick={onRemovePhoto} className="w-full rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50">
              Remove Photo
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-xs text-gray-500 hover:border-teal-400 hover:bg-teal-50"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Upload Photo
          </button>
        )}
      </div>

      <button
        type="submit"
        disabled={isSubmitting || (!selectedVenue && !title.trim())}
        className="w-full rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500 px-4 py-3 text-sm font-bold text-white shadow-lg transition-all hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isSubmitting ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Submitting...
          </span>
        ) : 'Submit'}
      </button>
    </form>
  );
}
