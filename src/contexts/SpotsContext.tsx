'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { SpotType } from '@/components/FilterModal';

export interface Spot {
  id: number;
  lat: number;
  lng: number;
  title: string;
  description: string;
  type: SpotType;
  photoUrl?: string;
  source?: 'manual' | 'automated'; // Indicates if spot was added manually or by script
}

interface SpotsContextType {
  spots: Spot[];
  addSpot: (spot: Omit<Spot, 'id'>) => Promise<void>;
  updateSpot: (spot: Spot) => Promise<void>;
  deleteSpot: (id: number) => Promise<void>;
  refreshSpots: () => Promise<void>;
  loading: boolean;
}

const SpotsContext = createContext<SpotsContextType | undefined>(undefined);

export function SpotsProvider({ children }: { children: ReactNode }) {
  const [spots, setSpots] = useState<Spot[]>([]);
  const [loading, setLoading] = useState(true);

  // Load spots from API on mount
  const loadSpots = async () => {
    try {
      const response = await fetch('/api/spots');
      if (response.ok) {
        const data = await response.json();
        // Ensure data is an array, default to empty array if not
        setSpots(Array.isArray(data) ? data : []);
      } else {
        console.error('Failed to load spots', { status: response.status, statusText: response.statusText });
        setSpots([]); // Set empty array on error to prevent crashes
      }
    } catch (error) {
      console.error('Error loading spots:', error);
      setSpots([]); // Set empty array on error to prevent crashes
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSpots();
  }, []);

  const refreshSpots = async () => {
    await loadSpots();
  };

  const addSpot = async (spotData: Omit<Spot, 'id'>) => {
    try {
      const response = await fetch('/api/spots', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(spotData),
      });

      if (response.ok) {
        // Try to parse response, but handle empty responses gracefully
        try {
          const newSpot = await response.json();
          // Refresh spots from API to get the latest data
          await refreshSpots();
          return;
        } catch (parseError) {
          // Response was OK but empty/invalid JSON - that's fine, just refresh
          await refreshSpots();
          return;
        }
      } else {
        // Handle error response - check if it has JSON body
        let errorMessage = 'Failed to add spot';
        try {
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const error = await response.json();
            errorMessage = error.error || errorMessage;
          } else {
            // Non-JSON error response, use status text
            errorMessage = response.statusText || errorMessage;
          }
        } catch (jsonError) {
          // Failed to parse error response, use status text
          errorMessage = response.statusText || `HTTP ${response.status}`;
        }
        throw new Error(errorMessage);
      }
    } catch (error) {
      console.error('Error adding spot:', error);
      throw error;
    }
  };

  const updateSpot = async (spotData: Spot) => {
    try {
      const response = await fetch(`/api/spots/${spotData.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(spotData),
      });

      if (response.ok) {
        // Refresh spots from API to get the latest data
        await refreshSpots();
        return;
      } else {
        // Handle error response - check if it has JSON body
        let errorMessage = 'Failed to update spot';
        try {
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const error = await response.json();
            errorMessage = error.error || errorMessage;
          } else {
            errorMessage = response.statusText || errorMessage;
          }
        } catch (jsonError) {
          errorMessage = response.statusText || `HTTP ${response.status}`;
        }
        throw new Error(errorMessage);
      }
    } catch (error) {
      console.error('Error updating spot:', error);
      throw error;
    }
  };

  const deleteSpot = async (id: number) => {
    try {
      const response = await fetch(`/api/spots/${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        // Refresh spots from API to get the latest data
        await refreshSpots();
        return;
      } else {
        // Handle error response - check if it has JSON body
        let errorMessage = 'Failed to delete spot';
        try {
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const error = await response.json();
            errorMessage = error.error || errorMessage;
          } else {
            errorMessage = response.statusText || errorMessage;
          }
        } catch (jsonError) {
          errorMessage = response.statusText || `HTTP ${response.status}`;
        }
        throw new Error(errorMessage);
      }
    } catch (error) {
      console.error('Error deleting spot:', error);
      throw error;
    }
  };

  return (
    <SpotsContext.Provider value={{ spots, addSpot, updateSpot, deleteSpot, refreshSpots, loading }}>
      {children}
    </SpotsContext.Provider>
  );
}

export function useSpots() {
  const context = useContext(SpotsContext);
  if (context === undefined) {
    throw new Error('useSpots must be used within a SpotsProvider');
  }
  return context;
}

