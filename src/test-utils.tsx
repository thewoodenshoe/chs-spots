/**
 * Shared test utilities — wraps components with required providers
 */
import React, { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { ToastProvider } from './components/Toast';
import { ActivitiesProvider } from './contexts/ActivitiesContext';

// Mock activities data for tests
const mockActivities = [
  { name: 'Happy Hour', icon: 'Martini', emoji: '🍹', color: '#0d9488' },
  { name: 'Fishing Spots', icon: 'Fish', emoji: '🎣', color: '#0284c7' },
  { name: 'Sunset Spots', icon: 'Sunset', emoji: '🌅', color: '#f59e0b' },
  { name: 'Christmas Spots', icon: 'Gift', emoji: '🎄', color: '#f97316' },
  { name: 'Pickleball Games', icon: 'Activity', emoji: '🏓', color: '#10b981' },
  { name: 'Bike Routes', icon: 'Bike', emoji: '🚴', color: '#6366f1' },
  { name: 'Golf Cart Hacks', icon: 'Car', emoji: '🛺', color: '#8b5cf6' },
];

// Provider wrapper for all tests
function AllProviders({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <ActivitiesProvider>
        {children}
      </ActivitiesProvider>
    </ToastProvider>
  );
}

// Custom render that wraps with all providers
function customRender(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  return render(ui, { wrapper: AllProviders, ...options });
}

export { customRender as render, mockActivities };
export * from '@testing-library/react';
