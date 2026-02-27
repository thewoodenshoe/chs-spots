'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

interface SuggestActivityModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function SuggestActivityModal({ isOpen, onClose, onSuccess }: SuggestActivityModalProps) {
  const [name, setName] = useState('');
  const [activityName, setActivityName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const handleFocusInput = useCallback(() => {
    setTimeout(() => {
      modalRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 300);
  }, []);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activityName.trim()) { setError('Please enter an activity name.'); return; }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/activities/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || 'Anonymous',
          activityName: activityName.trim(),
          description: description.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to submit suggestion');
      }

      setName('');
      setActivityName('');
      setDescription('');
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Suggest an activity">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div
        ref={modalRef}
        className="relative z-10 w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">Suggest an Activity</h2>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p className="text-sm text-gray-500 mb-4">
          What activity should we add? Think sunset tours, Christmas lights, paddleboard launches, brunch spots — anything Charleston!
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text"
            placeholder="Your name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={handleFocusInput}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
          <input
            type="text"
            placeholder="Activity name (e.g., Sunset Spots) *"
            value={activityName}
            onChange={(e) => setActivityName(e.target.value)}
            onFocus={handleFocusInput}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            required
          />
          <textarea
            placeholder="Brief description or examples (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onFocus={handleFocusInput}
            rows={3}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 resize-none"
          />

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Sending...' : 'Submit Suggestion'}
          </button>
        </form>
      </div>
    </div>
  );
}
