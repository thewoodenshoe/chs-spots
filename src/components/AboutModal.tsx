'use client';

import { useEffect, useRef } from 'react';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
  lastUpdated: string;
  healthIndicator: React.ReactNode;
  spotCount: number;
}

export default function AboutModal({ isOpen, onClose, lastUpdated, healthIndicator, spotCount }: AboutModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="About Charleston Finds">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div
        ref={modalRef}
        className="relative z-10 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between bg-white px-6 pt-5 pb-3 border-b border-gray-100">
          <h2 className="text-xl font-bold text-gray-900">About Charleston Finds</h2>
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

        <div className="px-6 py-5 space-y-5">
          {/* Tagline */}
          <p className="text-base text-gray-700 leading-relaxed">
            Your community-powered map for the best of Charleston, SC.
            Discover happy hours, brunch deals, live music, dog-friendly spots, new openings, and more — verified from venue sites and curated by locals.
          </p>

          {/* How it works */}
          <div>
            <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-2">How it works</h3>
            <ul className="space-y-2 text-sm text-gray-600">
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-teal-500 font-bold">1.</span>
                <span>Pick an area and activity to explore spots on the map.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-teal-500 font-bold">2.</span>
                <span>Tap the <strong>+</strong> button to suggest a new spot — drop a pin, add a name and photo, done.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-teal-500 font-bold">3.</span>
                <span>Missing an entire activity? Use <strong>Suggest an Activity</strong> and we&apos;ll add it. Think sunset tours, Christmas lights, paddleboard launches — you name it.</span>
              </li>
            </ul>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-4 rounded-xl bg-gray-50 p-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-teal-600">{spotCount}</div>
              <div className="text-xs text-gray-500">spots</div>
            </div>
            <div className="h-8 w-px bg-gray-200" />
            <div className="flex-1 flex items-center gap-2 text-sm text-gray-600">
              {healthIndicator}
              <span>Last updated: {lastUpdated}</span>
            </div>
          </div>

          {/* Privacy & Terms */}
          <div>
            <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-2">Privacy &amp; Terms</h3>
            <div className="rounded-xl bg-gray-50 p-4 space-y-3">
              <div>
                <h4 className="text-xs font-semibold text-gray-700 mb-1">What we collect</h4>
                <p className="text-xs text-gray-500 leading-relaxed">
                  When you submit a spot, we store the name you provide, location, description, and optional photo.
                  We use privacy-friendly analytics (Umami) that collects no personal data and sets no cookies.
                  We do not sell or share your information with third parties.
                </p>
              </div>
              <div>
                <h4 className="text-xs font-semibold text-gray-700 mb-1">Data accuracy</h4>
                <p className="text-xs text-gray-500 leading-relaxed">
                  Spot data is gathered automatically from restaurant websites and supplemented by community submissions.
                  Happy hour times, specials, and promotions should always be verified directly with the venue.
                  We are not affiliated with any business listed.
                </p>
              </div>
              <div>
                <h4 className="text-xs font-semibold text-gray-700 mb-1">Terms of use</h4>
                <p className="text-xs text-gray-500 leading-relaxed">
                  Charleston Finds is a free community project provided as-is. By using this site you agree that
                  information may not be accurate or up to date, and you use it at your own discretion.
                  We reserve the right to moderate, edit, or remove user-submitted content.
                </p>
              </div>
              <a
                href="/privacy"
                className="inline-block text-xs font-medium text-teal-600 hover:underline mt-1"
                target="_blank"
                rel="noopener noreferrer"
              >
                Full Privacy Policy &rarr;
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
