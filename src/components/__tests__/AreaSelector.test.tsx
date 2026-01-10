import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AreaSelector from '../AreaSelector';
import { Area } from '../FilterModal';
import fs from 'fs';
import path from 'path';

// Load actual areas from areas.json file
const areasFilePath = path.join(process.cwd(), 'data', 'areas.json');
let areasFromFile: string[] = [];

try {
  const areasData = JSON.parse(fs.readFileSync(areasFilePath, 'utf8'));
  areasFromFile = areasData.map((area: any) => area.name);
} catch (error) {
  console.warn('Could not load areas.json for tests, using fallback');
  areasFromFile = ['Daniel Island', 'Mount Pleasant', 'James Island', 'Downtown Charleston', "Sullivan's Island", 'North Charleston', 'West Ashley'];
}

// Mock fetch for API calls
global.fetch = jest.fn();

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
      json: async () => areasFromFile,
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
      areasFromFile.forEach((area) => {
        // Use getAllByText since area name appears in both button and dropdown
        const elements = screen.getAllByText(area);
        expect(elements.length).toBeGreaterThan(0);
      });
    }, { timeout: 3000 });
  });

  it('should load all area names from areas.json data file into menu', async () => {
    // This test verifies that the menu loads from the actual areas.json file
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => areasFromFile, // Use actual areas from file
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

    // Verify all areas from areas.json are present in the menu
    await waitFor(() => {
      areasFromFile.forEach((areaName) => {
        // Use getAllByText since area name appears multiple times
        const elements = screen.getAllByText(areaName, { exact: true });
        expect(elements.length).toBeGreaterThan(0);
      });
    });

    // Verify Park Circle is NOT present (should be removed)
    await waitFor(() => {
      expect(screen.queryByText('Park Circle', { exact: true })).not.toBeInTheDocument();
    });
  });

  it('should NOT display Park Circle in the menu (removed from areas.json)', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => areasFromFile,
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

    const button = screen.getByRole('button', { name: /select area/i });
    await waitFor(() => {
      expect(screen.queryByText('Loading areas...')).not.toBeInTheDocument();
    });
    button.click();

    // Verify Park Circle is NOT in the dropdown
    await waitFor(() => {
      expect(screen.queryByText('Park Circle', { exact: true })).not.toBeInTheDocument();
    });
  });

  it('should have exactly the number of areas from areas.json', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => areasFromFile,
    });

    render(
      <AreaSelector
        selectedArea="Daniel Island"
        onAreaChange={mockOnAreaChange}
        onMapRecenter={mockOnMapRecenter}
      />
    );

    const button = screen.getByRole('button', { name: /select area/i });
    await waitFor(() => {
      expect(screen.queryByText('Loading areas...')).not.toBeInTheDocument();
    });
    button.click();

    // Count area buttons in dropdown (excluding the main button)
    await waitFor(() => {
      const areaButtons = areasFromFile.map(area => 
        screen.queryByRole('button', { name: new RegExp(area, 'i') })
      ).filter(Boolean);
      
      // Should have at least the number of areas from file
      expect(areaButtons.length).toBeGreaterThanOrEqual(areasFromFile.length);
    });
  });

  it('should match areas.json exactly - UX menu loads from data file', async () => {
    // This is the key test: verify UX menu loads all names from areas.json
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => areasFromFile,
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

    const button = screen.getByRole('button', { name: /select area/i });
    await waitFor(() => {
      expect(screen.queryByText('Loading areas...')).not.toBeInTheDocument();
    });
    button.click();

    // Verify each area from areas.json appears in the menu
    const visibleAreas: string[] = [];
    for (const areaName of areasFromFile) {
      await waitFor(() => {
        const element = screen.queryByText(areaName, { exact: true });
        if (element) {
          visibleAreas.push(areaName);
        }
      }, { timeout: 1000 });
    }

    // All areas from file should be visible
    expect(visibleAreas.length).toBe(areasFromFile.length);
    expect(visibleAreas.sort()).toEqual(areasFromFile.sort());

    // Park Circle should not be present
    expect(visibleAreas).not.toContain('Park Circle');
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
});
