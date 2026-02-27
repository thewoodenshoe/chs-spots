'use client';

import { useState, useRef, useEffect } from 'react';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSearchCommit?: (value: string) => void;
  placeholder?: string;
  resultCount?: number;
}

export default function SearchBar({ value, onChange, onSearchCommit, placeholder = 'Search all areas...', resultCount }: SearchBarProps) {
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && !isFocused && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === 'Escape' && isFocused) {
        onChange('');
        inputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFocused, onChange]);

  const isSearching = value.trim().length >= 2;

  return (
    <div className={`relative transition-all ${isFocused ? 'ring-2 ring-teal-500/30' : ''} rounded-full`}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 pointer-events-none"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        ref={inputRef}
        type="search"
        role="searchbox"
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v);
          if (onSearchCommit) {
            if (commitTimer.current) clearTimeout(commitTimer.current);
            commitTimer.current = setTimeout(() => onSearchCommit(v), 800);
          }
        }}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        placeholder={placeholder}
        aria-label="Search spots across all areas"
        className="h-10 w-full rounded-full border border-white/20 bg-white/10 pl-9 pr-20 text-sm text-white placeholder-gray-300 backdrop-blur-sm focus:border-teal-400 focus:bg-white/15 focus:outline-none transition-all"
      />
      {isSearching && resultCount !== undefined && (
        <span className="absolute right-10 top-1/2 -translate-y-1/2 text-[10px] font-medium text-teal-300 whitespace-nowrap pointer-events-none" aria-live="polite">
          {resultCount} found
        </span>
      )}
      {value && (
        <button
          onClick={() => { onChange(''); inputRef.current?.focus(); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-gray-400 hover:text-white transition-colors"
          aria-label="Clear search"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
