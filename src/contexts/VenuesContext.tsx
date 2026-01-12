'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export interface Venue {
  id: string;
  name: string;
  lat: number;
  lng: number;
  area: string | null;
  address: string | null;
  website: string | null;
}

interface VenuesContextType {
  venues: Venue[];
  refreshVenues: () => Promise<void>;
  loading: boolean;
}

const VenuesContext = createContext<VenuesContextType | undefined>(undefined);

export function VenuesProvider({ children }: { children: ReactNode }) {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);

  // Load venues from API on mount
  const loadVenues = async () => {
    try {
      const response = await fetch('/api/venues');
      if (response.ok) {
        const data = await response.json();
        // Ensure data is an array, default to empty array if not
        setVenues(Array.isArray(data) ? data : []);
      } else {
        console.error('Failed to load venues', { status: response.status, statusText: response.statusText });
        setVenues([]); // Set empty array on error to prevent crashes
      }
    } catch (error) {
      console.error('Error loading venues:', error);
      setVenues([]); // Set empty array on error to prevent crashes
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadVenues();
  }, []);

  const refreshVenues = async () => {
    await loadVenues();
  };

  return (
    <VenuesContext.Provider value={{ venues, refreshVenues, loading }}>
      {children}
    </VenuesContext.Provider>
  );
}

export function useVenues() {
  const context = useContext(VenuesContext);
  if (context === undefined) {
    throw new Error('useVenues must be used within a VenuesProvider');
  }
  return context;
}
