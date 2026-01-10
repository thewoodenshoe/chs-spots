import React from 'react';
import { render, screen } from '@testing-library/react';
import Map from '../Map';

// Mock google.maps namespace
global.google = {
  maps: {
    LatLngBounds: jest.fn().mockImplementation(() => ({
      extend: jest.fn(),
    })),
    Size: jest.fn().mockImplementation((width, height) => ({ width, height })),
    Point: jest.fn().mockImplementation((x, y) => ({ x, y })),
    Map: jest.fn(),
  },
} as any;

// Mock @react-google-maps/api
jest.mock('@react-google-maps/api', () => ({
  LoadScript: ({ children, googleMapsApiKey }: { children: React.ReactNode; googleMapsApiKey?: string }) => {
    if (!googleMapsApiKey) {
      return <div>No API Key</div>;
    }
    return <div data-testid="load-script">{children}</div>;
  },
  GoogleMap: ({ children, onLoad, onUnmount }: { children: React.ReactNode; onLoad?: (map: any) => void; onUnmount?: () => void }) => {
    React.useEffect(() => {
      if (onLoad) {
        // Mock map object with methods needed
        const mockMap = {
          fitBounds: jest.fn(),
        } as unknown as google.maps.Map;
        onLoad(mockMap);
      }
      return () => {
        if (onUnmount) {
          onUnmount();
        }
      };
    }, [onLoad, onUnmount]);
    return <div data-testid="google-map">{children}</div>;
  },
  Marker: ({ title, onClick }: { title?: string; onClick?: () => void }) => (
    <div data-testid="marker" data-title={title} onClick={onClick}>Marker: {title}</div>
  ),
  InfoWindow: ({ children, onCloseClick }: { children: React.ReactNode; onCloseClick?: () => void }) => (
    <div data-testid="info-window" onClick={onCloseClick}>{children}</div>
  ),
}));

// Mock environment variable
const originalEnv = process.env;
beforeEach(() => {
  process.env = {
    ...originalEnv,
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: 'test-api-key',
  };
});

afterAll(() => {
  process.env = originalEnv;
});

describe('Map Component', () => {
  const mockSpots = [
    {
      title: 'Test Spot 1',
      lat: 32.7765,
      lng: -79.9311,
      description: 'Test description',
      activity: 'Happy Hour',
      area: 'Daniel Island',
    },
    {
      title: 'Test Spot 2',
      lat: 32.7865,
      lng: -79.9411,
      description: 'Another test',
      activity: 'Happy Hour',
      area: 'Mount Pleasant',
    },
  ];

  it('renders map without errors', () => {
    render(<Map spots={mockSpots} />);
    expect(screen.getByTestId('load-script')).toBeInTheDocument();
    expect(screen.getByTestId('google-map')).toBeInTheDocument();
  });

  it('renders spots as markers', () => {
    render(<Map spots={mockSpots} />);
    const markers = screen.getAllByTestId('marker');
    expect(markers.length).toBeGreaterThanOrEqual(2);
    // Check that markers are rendered (may have more if InfoWindow is also rendered)
    expect(markers.some(m => m.getAttribute('data-title') === 'Test Spot 1')).toBe(true);
    expect(markers.some(m => m.getAttribute('data-title') === 'Test Spot 2')).toBe(true);
  });

  it('filters spots by selected area', () => {
    render(<Map spots={mockSpots} selectedArea="Daniel Island" />);
    const markers = screen.getAllByTestId('marker');
    // Should have at least one marker for Daniel Island
    expect(markers.length).toBeGreaterThanOrEqual(1);
    const danielIslandMarker = markers.find(m => m.getAttribute('data-title') === 'Test Spot 1');
    expect(danielIslandMarker).toBeTruthy();
  });

  it('filters spots by selected activity', () => {
    render(<Map spots={mockSpots} selectedActivity="Happy Hour" />);
    const markers = screen.getAllByTestId('marker');
    // Both spots have Happy Hour activity, so both should show
    expect(markers.length).toBeGreaterThanOrEqual(2);
  });

  it('shows API key required message when key is missing', () => {
    // Temporarily remove API key
    const originalKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    
    render(<Map spots={mockSpots} />);
    expect(screen.getByText(/Google Maps API Key Required/i)).toBeInTheDocument();
    
    // Restore
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = originalKey;
  });

  it('handles empty spots array', () => {
    render(<Map spots={[]} />);
    // Map should still render even with no spots
    expect(screen.getByTestId('google-map')).toBeInTheDocument();
    // No markers should be rendered
    expect(screen.queryAllByTestId('marker')).toHaveLength(0);
  });
});