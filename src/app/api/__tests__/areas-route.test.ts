// Mock Next.js modules before importing
jest.mock('next/server', () => ({
  NextResponse: {
    json: jest.fn((data, init) => ({
      json: async () => data,
      status: init?.status || 200,
      ok: (init?.status || 200) < 400,
    })),
  },
}));

import { GET } from '../areas/route';
import fs from 'fs';
import path from 'path';

// Mock fs module
jest.mock('fs');
jest.mock('path');

describe('/api/areas route', () => {
  const mockReadFileSync = fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>;
  const mockPathJoin = path.join as jest.MockedFunction<typeof path.join>;

  beforeEach(() => {
    jest.clearAllMocks();
    process.cwd = jest.fn().mockReturnValue('/mock/project');
  });

  it('should return area names from areas.json', async () => {
    const mockAreas = [
      { name: 'Daniel Island', center: { lat: 32.845, lng: -79.908 }, radiusMeters: 8000 },
      { name: 'Mount Pleasant', center: { lat: 32.795, lng: -79.875 }, radiusMeters: 12000 },
      { name: 'Park Circle', center: { lat: 32.878, lng: -80.01 }, radiusMeters: 4000 },
    ];

    mockPathJoin.mockReturnValue('/mock/project/data/config/areas.json');
    mockReadFileSync.mockReturnValue(JSON.stringify(mockAreas));

    const response = await GET();
    const data = await response.json();

    expect(mockPathJoin).toHaveBeenCalledWith('/mock/project', 'data', 'config', 'areas.json');
    expect(mockReadFileSync).toHaveBeenCalledWith('/mock/project/data/config/areas.json', 'utf8');
    expect(response.status).toBe(200);
    expect(data).toEqual(['Daniel Island', 'Mount Pleasant', 'Park Circle']);
  });

  it('should return area names using the "name" attribute from areas.json', async () => {
    const mockAreas = [
      { name: 'Daniel Island', displayName: 'Daniel Island', center: { lat: 32.845, lng: -79.908 } },
      { name: 'North Charleston', displayName: 'North Charleston', center: { lat: 32.888, lng: -80.006 } },
      { name: 'West Ashley', displayName: 'West Ashley', center: { lat: 32.785, lng: -80.01 } },
    ];

    mockPathJoin.mockReturnValue('/mock/project/data/config/areas.json');
    mockReadFileSync.mockReturnValue(JSON.stringify(mockAreas));

    const response = await GET();
    const data = await response.json();

    // Should use "name" attribute, not "displayName"
    expect(data).toEqual(['Daniel Island', 'North Charleston', 'West Ashley']);
    expect(data).not.toContain(undefined);
  });

  it('should handle file not found error', async () => {
    mockPathJoin.mockReturnValue('/mock/project/data/config/areas.json');
    mockReadFileSync.mockImplementation(() => {
      throw new Error('File not found');
    });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toHaveProperty('error');
    expect(data.error).toBe('Failed to load areas');
  });

  it('should handle invalid JSON error', async () => {
    mockPathJoin.mockReturnValue('/mock/project/data/config/areas.json');
    mockReadFileSync.mockReturnValue('invalid json');

    const response = await GET();
    
    // Should throw and be caught, returning 500
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data).toHaveProperty('error');
  });

  it('should return all areas from areas.json', async () => {
    // Test with all 8 areas that should be in areas.json
    const mockAreas = [
      { name: 'Daniel Island' },
      { name: 'Mount Pleasant' },
      { name: 'Downtown Charleston' },
      { name: "Sullivan's Island" },
      { name: 'Park Circle' },
      { name: 'North Charleston' },
      { name: 'West Ashley' },
      { name: 'James Island' },
    ];

    mockPathJoin.mockReturnValue('/mock/project/data/config/areas.json');
    mockReadFileSync.mockReturnValue(JSON.stringify(mockAreas));

    const response = await GET();
    const data = await response.json();

    expect(data.length).toBe(8);
    expect(data).toContain('Daniel Island');
    expect(data).toContain('Mount Pleasant');
    expect(data).toContain('Park Circle');
    expect(data).toContain('North Charleston');
    expect(data).toContain('West Ashley');
    expect(data).toContain('James Island');
  });
});
