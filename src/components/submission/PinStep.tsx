'use client';

interface PinStepProps {
  pinLocation: { lat: number; lng: number } | null;
  onContinue: () => void;
}

export default function PinStep({ pinLocation, onContinue }: PinStepProps) {
  return (
    <div className="space-y-4">
      <div className={`rounded-xl p-4 ${pinLocation ? 'bg-teal-50' : 'bg-amber-50'}`}>
        {pinLocation ? (
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <div>
              <p className="text-sm font-semibold text-teal-800">Pin dropped</p>
              <p className="text-xs text-teal-600">{pinLocation.lat.toFixed(5)}, {pinLocation.lng.toFixed(5)}</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="text-sm font-medium text-amber-800">Tap on the map to drop a pin</p>
          </div>
        )}
      </div>
      <button
        onClick={onContinue}
        disabled={!pinLocation}
        className="w-full rounded-xl bg-teal-600 px-4 py-3 text-sm font-bold text-white shadow transition-all hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Continue
      </button>
    </div>
  );
}
