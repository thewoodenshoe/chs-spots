'use client';

import { useEffect, useRef } from 'react';

interface MoreMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onAddSpot?: () => void;
  onSuggestActivity: () => void;
  onFeedback: () => void;
  onAbout: () => void;
}

export default function MoreMenu({
  isOpen,
  onClose,
  onAddSpot,
  onSuggestActivity,
  onFeedback,
  onAbout,
}: MoreMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const items = [
    ...(onAddSpot ? [{
      label: 'Add Spot',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
      ),
      onClick: () => { onAddSpot(); onClose(); },
    }] : []),
    {
      label: 'Suggest Activity',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
      ),
      onClick: () => { onSuggestActivity(); onClose(); },
    },
    {
      label: 'Send Feedback',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      ),
      onClick: () => { onFeedback(); onClose(); },
    },
    {
      label: 'About',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      onClick: () => { onAbout(); onClose(); },
    },
  ];

  return (
    <div
      ref={menuRef}
      className="absolute bottom-full right-1 mb-2 w-52 rounded-xl bg-gray-900 shadow-2xl border border-white/10 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-150"
      role="menu"
    >
      {items.map((item, i) => (
        <button
          key={i}
          onClick={item.onClick}
          className={`flex w-full items-center gap-3 px-4 py-3 text-sm transition-colors ${
            'active' in item && item.active
              ? 'text-teal-400 bg-white/5'
              : 'text-white/80 hover:bg-white/10 hover:text-white'
          }`}
          role="menuitem"
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
}
