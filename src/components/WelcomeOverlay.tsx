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
    body: 'Choose a neighborhood from the dropdown and select an activity.',
  },
  {
    emoji: '📌',
    title: 'Share What You Know',
    body: 'This is a community page. Found a hidden gem? Is something incorrect? Tap the + button or edit a spot. Or, suggest an entirely new activity category. Charleston Finds is built by locals like you.',
  },
  {
    emoji: '🗺️',
    title: 'Switch to Map View',
    body: 'Tap the map icon in the top right to see all spots on an interactive map. Zoom in, tap markers for details, and explore Charleston visually.',
  },
];

export function hasSeenWelcome(): boolean {
  if (typeof window === 'undefined') return true;
  return localStorage.getItem(STORAGE_KEY) === '1';
}

export default function WelcomeOverlay({ onComplete }: WelcomeOverlayProps) {
  const [step, setStep] = useState(0);
  const [dismissed, setDismissed] = useState(() => hasSeenWelcome());
  const [dontShowAgain, setDontShowAgain] = useState(true);

  if (dismissed) return null;

  const isLast = step === steps.length - 1;
  const current = steps[step];

  const dismiss = () => {
    if (dontShowAgain) {
      localStorage.setItem(STORAGE_KEY, '1');
    }
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

        {/* Don't show again */}
        <div className="flex items-center justify-center px-6 pb-2">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-teal-500 focus:ring-teal-500"
            />
            <span className="text-xs text-gray-400">Don&apos;t show again</span>
          </label>
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
