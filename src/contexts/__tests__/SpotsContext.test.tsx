/**
 * Unit tests for SpotsContext
 * Tests error handling to prevent "Failed to load spots" errors
 */

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { SpotsProvider, useSpots, Spot } from '../SpotsContext';

// Mock fetch globally
global.fetch = jest.fn();

// Mock console.error to track errors
const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

// Test component that uses the context
function TestComponent() {
  const { spots, loading, refreshSpots, addSpot, updateSpot, deleteSpot } = useSpots();
  
  const handleAddSpot = async () => {
    try {
      await addSpot({
        lat: 32.7765,
        lng: -79.9311,
        title: 'Test Spot',
        description: 'Test Description',
        type: 'Happy Hour',
      });
    } catch (error) {
      // Error is handled by context
    }
  };

  const handleUpdateSpot = async () => {
    try {
      await updateSpot({
        id: 1,
        lat: 32.7765,
        lng: -79.9311,
        title: 'Updated Spot',
        description: 'Updated Description',
        type: 'Happy Hour',
      });
    } catch (error) {
      // Error is handled by context
    }
  };

  const handleDeleteSpot = async () => {
    try {
      await deleteSpot(1);
    } catch (error) {
      // Error is handled by context
    }
  };
  
  return (
    <div>
      <div data-testid="loading">{loading ? 'loading' : 'loaded'}</div>
      <div data-testid="spots-count">{spots.length}</div>
      <button data-testid="refresh" onClick={refreshSpots}>Refresh</button>
      <button data-testid="add-spot" onClick={handleAddSpot}>Add Spot</button>
      <button data-testid="update-spot" onClick={handleUpdateSpot}>Update Spot</button>
      <button data-testid="delete-spot" onClick={handleDeleteSpot}>Delete Spot</button>
    </div>
  );
}

describe('SpotsContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockClear();
    consoleErrorSpy.mockClear();
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('Initial Load', () => {
    it('should load spots successfully', async () => {
      const mockSpots: Spot[] = [
        {
          id: 1,
          lat: 32.7765,
          lng: -79.9311,
          title: 'Test Spot 1',
          description: 'Test Description',
          type: 'Happy Hour',
        },
      ];

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockSpots,
      });

      render(
        <SpotsProvider>
          <TestComponent />
        </SpotsProvider>
      );

      expect(screen.getByTestId('loading')).toHaveTextContent('loading');

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('loaded');
      });

      await waitFor(() => {
        expect(screen.getByTestId('spots-count')).toHaveTextContent('1');
      });

      expect(global.fetch).toHaveBeenCalledWith('/api/spots');
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should handle 404 error gracefully', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      render(
        <SpotsProvider>
          <TestComponent />
        </SpotsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('loaded');
      });

      // Should not have any spots
      expect(screen.getByTestId('spots-count')).toHaveTextContent('0');
      
      // Should log error but not crash (check for error message that includes status)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to load spots',
        expect.objectContaining({ status: 404 })
      );
    });

    it('should handle 500 server error gracefully', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      render(
        <SpotsProvider>
          <TestComponent />
        </SpotsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('loaded');
      });

      expect(screen.getByTestId('spots-count')).toHaveTextContent('0');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to load spots',
        expect.objectContaining({ status: 500 })
      );
    });

    it('should handle network errors gracefully', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      render(
        <SpotsProvider>
          <TestComponent />
        </SpotsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('loaded');
      });

      expect(screen.getByTestId('spots-count')).toHaveTextContent('0');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error loading spots:', expect.any(Error));
    });

    it('should handle invalid JSON response gracefully', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      render(
        <SpotsProvider>
          <TestComponent />
        </SpotsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('loaded');
      });

      expect(screen.getByTestId('spots-count')).toHaveTextContent('0');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error loading spots:', expect.any(Error));
    });

    it('should handle empty response array gracefully (no spots should not cause errors)', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      render(
        <SpotsProvider>
          <TestComponent />
        </SpotsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('loaded');
      });

      // Empty spots array should be valid - no errors, just empty state
      expect(screen.getByTestId('spots-count')).toHaveTextContent('0');
      expect(consoleErrorSpy).not.toHaveBeenCalled();
      
      // Verify spots is a valid empty array (not null/undefined)
      const spotsCountElement = screen.getByTestId('spots-count');
      expect(spotsCountElement.textContent).toBe('0');
    });

    it('should handle non-array response data', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error: 'Invalid format' }),
      });

      render(
        <SpotsProvider>
          <TestComponent />
        </SpotsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('loaded');
      });

      // Should not crash even if data is not an array
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
  });

  describe('refreshSpots', () => {
    it('should refresh spots successfully', async () => {
      const mockSpots: Spot[] = [
        {
          id: 1,
          lat: 32.7765,
          lng: -79.9311,
          title: 'Test Spot',
          description: 'Test Description',
          type: 'Happy Hour',
        },
      ];

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockSpots,
      });

      render(
        <SpotsProvider>
          <TestComponent />
        </SpotsProvider>
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

    it('should handle refresh errors gracefully', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [],
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
        });

      render(
        <SpotsProvider>
          <TestComponent />
        </SpotsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('loaded');
      });

      await act(async () => {
        screen.getByTestId('refresh').click();
      });

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Failed to load spots',
          expect.objectContaining({ status: 500 })
        );
      });
    });
  });

  describe('addSpot', () => {
    it('should add spot successfully', async () => {
      const newSpot: Spot = {
        id: 1,
        lat: 32.7765,
        lng: -79.9311,
        title: 'New Spot',
        description: 'New Description',
        type: 'Happy Hour',
      };

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [],
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => newSpot,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [newSpot],
        });

      render(
        <SpotsProvider>
          <TestComponent />
        </SpotsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('loaded');
      });

      await act(async () => {
        screen.getByTestId('add-spot').click();
      });

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(3); // Load + POST + refresh
      });

      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should handle add spot error', async () => {
      const mockHeaders = new Headers();
      mockHeaders.set('content-type', 'application/json');
      
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [],
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          headers: mockHeaders,
          json: async () => ({ error: 'Invalid data' }),
        });

      render(
        <SpotsProvider>
          <TestComponent />
        </SpotsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('loaded');
      });

      await act(async () => {
        try {
          screen.getByTestId('add-spot').click();
        } catch (error) {
          // Error is expected to be thrown
        }
      });

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith('Error adding spot:', expect.any(Error));
      });
    });

    it('should handle add spot error with empty response body', async () => {
      const mockHeaders = new Headers();
      // No content-type header (empty response body)
      
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [],
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          headers: mockHeaders,
          json: async () => {
            throw new Error('Unexpected end of JSON input');
          },
        });

      render(
        <SpotsProvider>
          <TestComponent />
        </SpotsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('loaded');
      });

      await act(async () => {
        try {
          screen.getByTestId('add-spot').click();
        } catch (error) {
          // Error is expected to be thrown
        }
      });

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith('Error adding spot:', expect.any(Error));
      });
    });

    it('should handle add spot with empty JSON response (200 OK but empty)', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [],
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => {
            throw new Error('Unexpected end of JSON input');
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [],
        });

      render(
        <SpotsProvider>
          <TestComponent />
        </SpotsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('loaded');
      });

      await act(async () => {
        screen.getByTestId('add-spot').click();
      });

      // Should not throw error, should handle empty response gracefully
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(3); // Load + POST + refresh
      });

      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
  });

  describe('updateSpot', () => {
    it('should update spot successfully (pending approval)', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [],
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ pending: true, message: 'Edit submitted for approval' }),
        });

      render(
        <SpotsProvider>
          <TestComponent />
        </SpotsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('loaded');
      });

      await act(async () => {
        screen.getByTestId('update-spot').click();
      });

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(2); // Load + PUT (no refresh for pending)
      });

      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should handle update spot error', async () => {
      const mockHeaders = new Headers();
      mockHeaders.set('content-type', 'application/json');
      
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [],
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          headers: mockHeaders,
          json: async () => ({ error: 'Spot not found' }),
        });

      render(
        <SpotsProvider>
          <TestComponent />
        </SpotsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('loaded');
      });

      await act(async () => {
        try {
          screen.getByTestId('update-spot').click();
        } catch (error) {
          // Error is expected to be thrown
        }
      });

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith('Error updating spot:', expect.any(Error));
      });
    });
  });

  describe('deleteSpot', () => {
    it('should delete spot successfully (pending approval)', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [],
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ pending: true, message: 'Delete request submitted for approval' }),
        });

      render(
        <SpotsProvider>
          <TestComponent />
        </SpotsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('loaded');
      });

      await act(async () => {
        screen.getByTestId('delete-spot').click();
      });

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(2); // Load + DELETE (no refresh for pending)
      });

      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should handle delete spot error', async () => {
      const mockHeaders = new Headers();
      mockHeaders.set('content-type', 'application/json');
      
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [],
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          headers: mockHeaders,
          json: async () => ({ error: 'Spot not found' }),
        });

      render(
        <SpotsProvider>
          <TestComponent />
        </SpotsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('loaded');
      });

      await act(async () => {
        screen.getByTestId('delete-spot').click();
      });

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith('Error deleting spot:', expect.any(Error));
      });
    });
  });

  describe('useSpots hook', () => {
    it('should throw error when used outside provider', () => {
      // Suppress console.error for this test
      const originalError = console.error;
      console.error = jest.fn();

      expect(() => {
        render(<TestComponent />);
      }).toThrow('useSpots must be used within a SpotsProvider');

      console.error = originalError;
    });
  });

  describe('Empty Spots Handling', () => {
    it('should handle empty spots array without errors (normal case, not an error)', async () => {
      // Empty array is a valid response - no spots exist yet
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      render(
        <SpotsProvider>
          <TestComponent />
        </SpotsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('loaded');
      });

      // Empty spots should work fine - component should render with 0 spots
      expect(screen.getByTestId('spots-count')).toHaveTextContent('0');
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should handle missing spots.json file gracefully (return empty array)', async () => {
      // API returns 500 when file doesn't exist
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      render(
        <SpotsProvider>
          <TestComponent />
        </SpotsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('loaded');
      });

      // Should set empty array on error, not crash
      expect(screen.getByTestId('spots-count')).toHaveTextContent('0');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to load spots',
        expect.objectContaining({ status: 500 })
      );
    });
  });

  describe('Error Prevention', () => {
    it('should never crash on invalid response status codes', async () => {
      const statusCodes = [400, 401, 403, 404, 500, 502, 503];
      
      for (const statusCode of statusCodes) {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: false,
          status: statusCode,
          statusText: `Status ${statusCode}`,
        });

        const { unmount } = render(
          <SpotsProvider>
            <TestComponent />
          </SpotsProvider>
        );

        await waitFor(() => {
          expect(screen.getByTestId('loading')).toHaveTextContent('loaded');
        });

        expect(screen.getByTestId('spots-count')).toHaveTextContent('0');
        unmount();
        jest.clearAllMocks();
      }
    });

    it('should handle timeout scenarios gracefully', async () => {
      (global.fetch as jest.Mock).mockImplementation(
        () => new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Request timeout')), 100)
        )
      );

      render(
        <SpotsProvider>
          <TestComponent />
        </SpotsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('loaded');
      }, { timeout: 2000 });

      expect(screen.getByTestId('spots-count')).toHaveTextContent('0');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error loading spots:', expect.any(Error));
    });

    it('should handle malformed response data', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => null,
      });

      render(
        <SpotsProvider>
          <TestComponent />
        </SpotsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('loaded');
      });

      // Should handle null gracefully and set empty array
      expect(screen.getByTestId('spots-count')).toHaveTextContent('0');
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
  });
});
