'use client';

import { useState } from 'react';

const STORAGE_KEY = 'chs-finds-welcomed';

interface WelcomeOverlayProps {
  onComplete: () => void;
}

const steps = [
  {
    emoji: '🌴',
    title: 'Welcome to Charleston Finds',
    body: 'Discover happy hours, brunch specials, fishing spots, and more — all updated daily from real restaurant websites and local tips.',
  },
  {
    emoji: '🗺️',
    title: 'Pick Your Area & Vibe',
    body: 'Choose a neighborhood from the dropdown and select an activity. Switch between Map and List view to browse your way.',
  },
  {
    emoji: '📌',
    title: 'Share What You Know',
    body: 'Found a hidden gem? Tap the + button to add a spot, or suggest an entirely new activity category. Charleston Finds is built by locals like you.',
  },
];

export function hasSeenWelcome(): boolean {
  if (typeof window === 'undefined') return true;
  return localStorage.getItem(STORAGE_KEY) === '1';
}

export default function WelcomeOverlay({ onComplete }: WelcomeOverlayProps) {
  const [step, setStep] = useState(0);
  const [dismissed, setDismissed] = useState(() => hasSeenWelcome());

  if (dismissed) return null;

  const isLast = step === steps.length - 1;
  const current = steps[step];

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, '1');
    setDismissed(true);
    onComplete();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-5">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={dismiss} />

      <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white shadow-2xl overflow-hidden">
        {/* Progress dots */}
        <div className="flex justify-center gap-2 pt-5">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? 'w-6 bg-teal-500' : 'w-1.5 bg-gray-300'
              }`}
            />
          ))}
        </div>

        {/* Content */}
        <div className="px-6 pt-5 pb-4 text-center">
          <div className="text-4xl mb-3">{current.emoji}</div>
          <h2 className="text-lg font-bold text-gray-900 mb-2">{current.title}</h2>
          <p className="text-sm text-gray-600 leading-relaxed">{current.body}</p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between px-6 pb-5">
          <button
            onClick={dismiss}
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            Skip
          </button>

          {isLast ? (
            <button
              onClick={dismiss}
              className="rounded-full bg-teal-500 px-6 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-teal-600 transition-colors active:scale-95"
            >
              Get Started
            </button>
          ) : (
            <button
              onClick={() => setStep(step + 1)}
              className="rounded-full bg-teal-500 px-6 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-teal-600 transition-colors active:scale-95"
            >
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
