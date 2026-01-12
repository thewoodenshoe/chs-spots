/**
 * Unit tests for VenuesContext
 */

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { VenuesProvider, useVenues, Venue } from '../VenuesContext';

// Mock fetch globally
global.fetch = jest.fn();

// Mock console.error to track errors
const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

// Test component that uses the context
function TestComponent() {
  const { venues, loading, refreshVenues } = useVenues();
  
  return (
    <div>
      <div data-testid="loading">{loading ? 'loading' : 'loaded'}</div>
      <div data-testid="venues-count">{venues.length}</div>
      <button data-testid="refresh" onClick={refreshVenues}>Refresh</button>
      {venues.length > 0 && (
        <div data-testid="first-venue">{venues[0].name}</div>
      )}
    </div>
  );
}

describe('VenuesContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockClear();
    consoleErrorSpy.mockClear();
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('Initial Load', () => {
    it('should load venues successfully', async () => {
      const mockVenues: Venue[] = [
        {
          id: 'ChIJ1',
          name: 'Test Venue 1',
          lat: 32.845,
          lng: -79.908,
          area: 'Daniel Island',
          address: '123 Test St',
          website: 'https://example.com',
        },
      ];

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockVenues,
      });

      render(
        <VenuesProvider>
          <TestComponent />
        </VenuesProvider>
      );

      expect(screen.getByTestId('loading')).toHaveTextContent('loading');

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('loaded');
      });

      await waitFor(() => {
        expect(screen.getByTestId('venues-count')).toHaveTextContent('1');
      });

      expect(global.fetch).toHaveBeenCalledWith('/api/venues');
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should handle 404 error gracefully', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      render(
        <VenuesProvider>
          <TestComponent />
        </VenuesProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('loaded');
      });

      expect(screen.getByTestId('venues-count')).toHaveTextContent('0');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should handle network errors gracefully', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      render(
        <VenuesProvider>
          <TestComponent />
        </VenuesProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('loaded');
      });

      expect(screen.getByTestId('venues-count')).toHaveTextContent('0');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error loading venues:', expect.any(Error));
    });

    it('should handle empty response array gracefully', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      render(
        <VenuesProvider>
          <TestComponent />
        </VenuesProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('loaded');
      });

      expect(screen.getByTestId('venues-count')).toHaveTextContent('0');
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should handle non-array response data', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error: 'Invalid format' }),
      });

      render(
        <VenuesProvider>
          <TestComponent />
        </VenuesProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('loaded');
      });

      expect(screen.getByTestId('venues-count')).toHaveTextContent('0');
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
  });

  describe('refreshVenues', () => {
    it('should refresh venues successfully', async () => {
      const mockVenues: Venue[] = [
        {
          id: 'ChIJ1',
          name: 'Test Venue',
          lat: 32.845,
          lng: -79.908,
          area: 'Daniel Island',
          address: '123 Test St',
          website: 'https://example.com',
        },
      ];

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockVenues,
      });

      render(
        <VenuesProvider>
          <TestComponent />
        </VenuesProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('loaded');
      });

      // Click refresh button
      await act(async () => {
        screen.getByTestId('refresh').click();
      });

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(2); // Initial load + refresh
      });

      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
  });

  describe('useVenues hook', () => {
    it('should throw error when used outside provider', () => {
      // Suppress console.error for this test
      const originalError = console.error;
      console.error = jest.fn();

      expect(() => {
        render(<TestComponent />);
      }).toThrow('useVenues must be used within a VenuesProvider');

      console.error = originalError;
    });
  });
});
