// Mock rate limiting
jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(() => true),
  getClientIp: jest.fn(() => '127.0.0.1'),
}));

// Mock cache (always miss so DB mock is used)
jest.mock('@/lib/cache', () => ({
  getCache: () => null,
  setCache: () => {},
}));

// Mock database module
const mockGetAll = jest.fn();
const mockGetByArea = jest.fn();
jest.mock('@/lib/db', () => ({
  venues: {
    getAll: (...args: unknown[]) => mockGetAll(...args),
    getByArea: (...args: unknown[]) => mockGetByArea(...args),
  },
}));

jest.mock('next/server', () => {
  return {
    NextResponse: {
      json(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
        const status = init?.status || 200;
        return {
          json: async () => body,
          status,
          ok: status < 400,
          headers: new Map(Object.entries(init?.headers || {})),
        };
      },
    },
  };
});

import { GET } from '../venues/route';

function makeRequest(url = 'http://localhost:3000/api/venues') {
  return {
    url,
    headers: { get: () => null },
  } as unknown as Request;
}

describe('GET /api/venues', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return all venues from database', async () => {
    const mockVenues = [
      {
        id: 'ChIJ1', name: 'Test Venue 1', lat: 32.845, lng: -79.908,
        area: 'Daniel Island', address: '123 Test St', website: 'https://example.com',
      },
      {
        id: 'ChIJ2', name: 'Test Venue 2', lat: 32.855, lng: -79.918,
        area: 'Mount Pleasant', address: '456 Test Ave', website: null,
      },
    ];

    mockGetAll.mockReturnValue(mockVenues);

    const response = await GET(makeRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveLength(2);
    expect(data[0]).toEqual({
      id: 'ChIJ1', name: 'Test Venue 1', lat: 32.845, lng: -79.908,
      area: 'Daniel Island', address: '123 Test St', website: 'https://example.com',
      phone: null, operatingHours: null,
    });
  });

  it('should filter by area query param', async () => {
    const filteredVenues = [
      { id: 'ChIJ1', name: 'Test Venue 1', lat: 32.845, lng: -79.908, area: 'Daniel Island', address: '123 Test St' },
    ];

    mockGetByArea.mockReturnValue(filteredVenues);

    const response = await GET(makeRequest('http://localhost:3000/api/venues?area=Daniel+Island'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveLength(1);
    expect(data[0].area).toBe('Daniel Island');
    expect(mockGetByArea).toHaveBeenCalledWith('Daniel Island');
  });

  it('should return error on database failure', async () => {
    mockGetAll.mockImplementation(() => { throw new Error('Database connection failed'); });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    const response = await GET(makeRequest());
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toHaveProperty('error');
    consoleSpy.mockRestore();
  });

  it('should strip internal DB fields from response', async () => {
    const mockVenues = [
      {
        id: 'ChIJ1', name: 'Test Venue', lat: 32.845, lng: -79.908,
        area: 'Daniel Island', address: '123 Test St', website: 'https://example.com',
        types: '["restaurant"]', raw_google_data: '{}', created_at: '2026-01-01',
      },
    ];

    mockGetAll.mockReturnValue(mockVenues);

    const response = await GET(makeRequest());
    const data = await response.json();

    expect(data[0]).toHaveProperty('id');
    expect(data[0]).toHaveProperty('name');
    expect(data[0]).not.toHaveProperty('types');
    expect(data[0]).not.toHaveProperty('raw_google_data');
    expect(data[0]).not.toHaveProperty('created_at');
  });

  it('should handle venues with missing fields', async () => {
    const mockVenues = [{ id: 'ChIJ1', name: 'Test Venue', lat: 32.845, lng: -79.908 }];
    mockGetAll.mockReturnValue(mockVenues);

    const response = await GET(makeRequest());
    const data = await response.json();

    expect(data[0].area).toBeNull();
    expect(data[0].address).toBeNull();
    expect(data[0].website).toBeNull();
  });

  it('should return empty array when no venues exist', async () => {
    mockGetAll.mockReturnValue([]);

    const response = await GET(makeRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual([]);
  });
});
