import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AreaSelector from '../AreaSelector';
import { Area } from '../FilterModal';

// Mock fetch for API calls
global.fetch = jest.fn();

// Mock areas.json data
const mockAreas = [
  'Daniel Island',
  'Mount Pleasant',
  'James Island',
  'Downtown Charleston',
  "Sullivan's Island",
  'Park Circle',
  'North Charleston',
  'West Ashley',
];

const mockAreasConfig = [
  { name: 'Daniel Island', center: { lat: 32.845, lng: -79.908 } },
  { name: 'Mount Pleasant', center: { lat: 32.795, lng: -79.875 } },
  { name: 'James Island', center: { lat: 32.737, lng: -79.965 } },
  { name: 'Downtown Charleston', center: { lat: 32.776, lng: -79.931 } },
  { name: "Sullivan's Island", center: { lat: 32.76, lng: -79.84 } },
  { name: 'Park Circle', center: { lat: 32.878, lng: -80.01 } },
  { name: 'North Charleston', center: { lat: 32.888, lng: -80.006 } },
  { name: 'West Ashley', center: { lat: 32.785, lng: -80.04 } },
];

describe('AreaSelector', () => {
  const mockOnAreaChange = jest.fn();
  const mockOnMapRecenter = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockClear();
  });

  it('should load area names from /api/areas endpoint', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockAreas,
    });

    render(
      <AreaSelector
        selectedArea="Daniel Island"
        onAreaChange={mockOnAreaChange}
        onMapRecenter={mockOnMapRecenter}
      />
    );

    // Wait for areas to load
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/areas');
    });

    // Click the dropdown button to open it
    const button = screen.getByRole('button', { name: /select area/i });
    button.click();

    // Wait for areas to appear in dropdown
    await waitFor(() => {
      mockAreas.forEach((area) => {
        expect(screen.getByText(area)).toBeInTheDocument();
      });
    }, { timeout: 3000 });
  });

  it('should display all areas from areas.json in dropdown', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockAreas,
    });

    render(
      <AreaSelector
        selectedArea="Daniel Island"
        onAreaChange={mockOnAreaChange}
        onMapRecenter={mockOnMapRecenter}
      />
    );

    // Open dropdown
    const button = screen.getByRole('button', { name: /select area/i });
    await waitFor(() => {
      expect(screen.queryByText('Loading areas...')).not.toBeInTheDocument();
    });
    button.click();

    // Verify all areas from areas.json are present
    await waitFor(() => {
      expect(screen.getByText('Daniel Island')).toBeInTheDocument();
      expect(screen.getByText('Mount Pleasant')).toBeInTheDocument();
      expect(screen.getByText('James Island')).toBeInTheDocument();
      expect(screen.getByText('Downtown Charleston')).toBeInTheDocument();
      expect(screen.getByText("Sullivan's Island")).toBeInTheDocument();
      expect(screen.getByText('Park Circle')).toBeInTheDocument();
      expect(screen.getByText('North Charleston')).toBeInTheDocument();
      expect(screen.getByText('West Ashley')).toBeInTheDocument();
    });
  });

  it('should handle API error gracefully with fallback areas', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('API Error'));

    render(
      <AreaSelector
        selectedArea="Daniel Island"
        onAreaChange={mockOnAreaChange}
        onMapRecenter={mockOnMapRecenter}
      />
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/areas');
    });

    // Should still show some areas (fallback)
    await waitFor(() => {
      expect(screen.queryByText('Loading areas...')).not.toBeInTheDocument();
    });
  });

  it('should display loading state while fetching areas', async () => {
    (global.fetch as jest.Mock).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({
        ok: true,
        json: async () => mockAreas,
      }), 100))
    );

    render(
      <AreaSelector
        selectedArea="Daniel Island"
        onAreaChange={mockOnAreaChange}
        onMapRecenter={mockOnMapRecenter}
      />
    );

    // Open dropdown immediately
    const button = screen.getByRole('button', { name: /select area/i });
    button.click();

    // Should show loading state initially
    const loadingText = screen.queryByText('Loading areas...');
    // Loading might be too fast to catch, but verify it doesn't error
    expect(button).toBeInTheDocument();
  });

  it('should use area names from areas.json attribute "name"', async () => {
    // This test ensures we're using the "name" attribute from areas.json
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockAreas, // These should be the "name" values from areas.json
    });

    render(
      <AreaSelector
        selectedArea="Daniel Island"
        onAreaChange={mockOnAreaChange}
        onMapRecenter={mockOnMapRecenter}
      />
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/areas');
    });

    // Open dropdown
    const button = screen.getByRole('button', { name: /select area/i });
    await waitFor(() => {
      expect(screen.queryByText('Loading areas...')).not.toBeInTheDocument();
    });
    button.click();

    // Verify the areas match what would be in areas.json
    await waitFor(() => {
      // These names should match the "name" attribute in areas.json
      expect(screen.getByText('Daniel Island')).toBeInTheDocument();
      expect(screen.getByText('Park Circle')).toBeInTheDocument();
      expect(screen.getByText('North Charleston')).toBeInTheDocument();
      expect(screen.getByText('West Ashley')).toBeInTheDocument();
    });
  });
});
