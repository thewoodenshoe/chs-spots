'use client';

interface ViewToggleProps {
  viewMode: 'map' | 'list';
  onChange: (mode: 'map' | 'list') => void;
}

export default function ViewToggle({ viewMode, onChange }: ViewToggleProps) {
  return (
    <div className="flex h-8 rounded-full bg-white/10 p-0.5">
      <button
        onClick={() => onChange('map')}
        className={`flex items-center gap-1 rounded-full px-3 text-xs font-semibold transition-all ${
          viewMode === 'map'
            ? 'bg-teal-500 text-white shadow-sm'
            : 'text-white/60 hover:text-white/90'
        }`}
        aria-label="Map view"
        aria-pressed={viewMode === 'map'}
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
        </svg>
        <span className="hidden sm:inline">Map</span>
      </button>
      <button
        onClick={() => onChange('list')}
        className={`flex items-center gap-1 rounded-full px-3 text-xs font-semibold transition-all ${
          viewMode === 'list'
            ? 'bg-teal-500 text-white shadow-sm'
            : 'text-white/60 hover:text-white/90'
        }`}
        aria-label="List view"
        aria-pressed={viewMode === 'list'}
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
        </svg>
        <span className="hidden sm:inline">List</span>
      </button>
    </div>
  );
}
