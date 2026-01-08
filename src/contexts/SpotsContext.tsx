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
        setSpots(data);
      } else {
        console.error('Failed to load spots');
      }
    } catch (error) {
      console.error('Error loading spots:', error);
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
        const newSpot = await response.json();
        // Refresh spots from API to get the latest data
        await refreshSpots();
        return;
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Failed to add spot');
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
        const error = await response.json();
        throw new Error(error.error || 'Failed to update spot');
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
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete spot');
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

