import React from 'react';
import { render, screen } from '@testing-library/react';
import Map from '../Map';

// Mock @react-google-maps/api
jest.mock('@react-google-maps/api', () => ({
  LoadScript: ({ children }: { children: React.ReactNode }) => <div data-testid="load-script">{children}</div>,
  GoogleMap: ({ children, onLoad }: { children: React.ReactNode; onLoad?: (map: any) => void }) => {
    React.useEffect(() => {
      if (onLoad) {
        // Mock map object
        onLoad({} as google.maps.Map);
      }
    }, [onLoad]);
    return <div data-testid="google-map">{children}</div>;
  },
  Marker: ({ title }: { title?: string }) => <div data-testid="marker" data-title={title}>Marker</div>,
  InfoWindow: ({ children }: { children: React.ReactNode }) => <div data-testid="info-window">{children}</div>,
}));

// Mock environment variable
const originalEnv = process.env;
beforeAll(() => {
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
    expect(markers).toHaveLength(2);
    expect(markers[0]).toHaveAttribute('data-title', 'Test Spot 1');
    expect(markers[1]).toHaveAttribute('data-title', 'Test Spot 2');
  });

  it('filters spots by selected area', () => {
    render(<Map spots={mockSpots} selectedArea="Daniel Island" />);
    const markers = screen.getAllByTestId('marker');
    expect(markers).toHaveLength(1);
    expect(markers[0]).toHaveAttribute('data-title', 'Test Spot 1');
  });

  it('filters spots by selected activity', () => {
    render(<Map spots={mockSpots} selectedActivity="Happy Hour" />);
    const markers = screen.getAllByTestId('marker');
    expect(markers).toHaveLength(2);
  });

  it('shows API key required message when key is missing', () => {
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = '';
    render(<Map spots={mockSpots} />);
    expect(screen.getByText(/Google Maps API Key Required/i)).toBeInTheDocument();
  });

  it('handles empty spots array', () => {
    render(<Map spots={[]} />);
    expect(screen.getByTestId('google-map')).toBeInTheDocument();
    expect(screen.queryAllByTestId('marker')).toHaveLength(0);
  });
});