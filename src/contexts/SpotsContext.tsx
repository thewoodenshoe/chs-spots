'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
export interface Spot {
  id: number;
  lat: number;
  lng: number;
  title: string;
  submitterName?: string;
  description: string;
  type: string;
  photoUrl?: string;
  source?: 'manual' | 'automated';
  status?: 'pending' | 'approved' | 'denied';
  // Structured promotion fields (generic)
  promotionTime?: string;
  promotionList?: string[];
  // Legacy happy hour fields (backwards compat)
  happyHourTime?: string;
  happyHourList?: string[];
  sourceUrl?: string;
  lastUpdateDate?: string;
  venueId?: string;
  manualOverride?: boolean;
}

interface SpotsContextType {
  spots: Spot[];
  addSpot: (spot: Omit<Spot, 'id'>) => Promise<void>;
  updateSpot: (spot: Spot) => Promise<{ pending: boolean }>;
  deleteSpot: (id: number) => Promise<{ pending: boolean }>;
  refreshSpots: () => Promise<void>;
  loading: boolean;
  isAdmin: boolean;
}

const SpotsContext = createContext<SpotsContextType | undefined>(undefined);

// Check for admin mode from URL or localStorage
function getAdminSecret(): string | null {
  if (typeof window === 'undefined') return null;

  const params = new URLSearchParams(window.location.search);
  const adminParam = params.get('admin');

  if (adminParam) {
    localStorage.setItem('chs_admin_key', adminParam);
    localStorage.setItem('chs_admin', 'true');
    return adminParam;
  }

  if (localStorage.getItem('chs_admin') === 'true') {
    return localStorage.getItem('chs_admin_key');
  }

  return null;
}

function checkAdminMode(): boolean {
  return getAdminSecret() !== null;
}

/** Build headers that include admin auth when available */
function adminHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const secret = getAdminSecret();
  const headers: Record<string, string> = { ...extra };
  if (secret) {
    headers['x-admin-key'] = secret;
  }
  return headers;
}

export function SpotsProvider({ children }: { children: ReactNode }) {
  const [spots, setSpots] = useState<Spot[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  // Check admin mode on mount
  useEffect(() => {
    setIsAdmin(checkAdminMode());
  }, []);

  // Load spots from API on mount
  const loadSpots = async () => {
    try {
      const secret = getAdminSecret();
      const url = secret ? `/api/spots?admin=${encodeURIComponent(secret)}` : '/api/spots';
      const response = await fetch(url);
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
          await response.json();
          await refreshSpots();
          return;
        } catch {
          // Response was OK but empty/invalid JSON - that's fine, just refresh
          await refreshSpots();
          return;
        }
      } else {
        // Handle error response - check if it has JSON body
        let errorMessage = 'Failed to add spot';
        if (response.status === 413) {
          throw new Error('Image upload is too large. Please use a smaller photo.');
        }
        try {
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const error = await response.json();
            errorMessage = error.error || errorMessage;
          } else {
            // Non-JSON error response, use status text
            const rawText = await response.text();
            if (/request entity too large/i.test(rawText)) {
              errorMessage = 'Image upload is too large. Please use a smaller photo.';
            } else {
              errorMessage = response.statusText || errorMessage;
            }
          }
        } catch {
          errorMessage = response.statusText || `HTTP ${response.status}`;
        }
        throw new Error(errorMessage);
      }
    } catch (error) {
      console.error('Error adding spot:', error);
      throw error;
    }
  };

  const updateSpot = async (spotData: Spot): Promise<{ pending: boolean }> => {
    try {
      const response = await fetch(`/api/spots/${spotData.id}`, {
        method: 'PUT',
        headers: adminHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(spotData),
      });

      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        if (data.pending) {
          return { pending: true };
        }
        await refreshSpots();
        return { pending: false };
      } else {
        let errorMessage = 'Failed to update spot';
        try {
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const error = await response.json();
            errorMessage = error.error || errorMessage;
          } else {
            errorMessage = response.statusText || errorMessage;
          }
        } catch {
          errorMessage = response.statusText || `HTTP ${response.status}`;
        }
        throw new Error(errorMessage);
      }
    } catch (error) {
      console.error('Error updating spot:', error);
      throw error;
    }
  };

  const deleteSpot = async (id: number): Promise<{ pending: boolean }> => {
    try {
      const response = await fetch(`/api/spots/${id}`, {
        method: 'DELETE',
        headers: adminHeaders(),
      });

      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        if (data.pending) {
          return { pending: true };
        }
        await refreshSpots();
        return { pending: false };
      } else {
        let errorMessage = 'Failed to delete spot';
        try {
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const error = await response.json();
            errorMessage = error.error || errorMessage;
          } else {
            errorMessage = response.statusText || errorMessage;
          }
        } catch {
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
    <SpotsContext.Provider value={{ spots, addSpot, updateSpot, deleteSpot, refreshSpots, loading, isAdmin }}>
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

