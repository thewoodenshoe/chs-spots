import { GET } from '../venues/route';
import { NextRequest } from 'next/server';

// Mock rate limiting
jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(() => true),
  getClientIp: jest.fn(() => '127.0.0.1'),
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

// Mock Headers and RequestCookies for Next.js
class MockHeaders extends Map {
  get(key: string) {
    return super.get(key.toLowerCase()) || null;
  }
  set(key: string, value: string) {
    return super.set(key.toLowerCase(), value);
  }
}

// Mock RequestCookies
class MockRequestCookies {
  private cookies = new Map();
  get(name: string) {
    return { name, value: this.cookies.get(name) || '' };
  }
  set(name: string, value: string) {
    this.cookies.set(name, value);
  }
}

// Mock NextRequest and NextResponse
jest.mock('next/server', () => {
  const actual = jest.requireActual('next/server');
  
  class MockNextRequest extends Request {
    cookies: MockRequestCookies;
    url: string;
    
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(input, init);
      this.url = typeof input === 'string' ? input : input.toString();
      this.cookies = new MockRequestCookies();
      if (!this.headers) {
        (this as unknown as { headers: MockHeaders }).headers = new MockHeaders();
      }
    }
  }

  class MockNextResponse {
    static json(body: unknown, init?: ResponseInit) {
      const status = init?.status || 200;
      const response = new Response(JSON.stringify(body), {
        ...init,
        status,
        headers: {
          'Content-Type': 'application/json',
          ...(init?.headers || {}),
        },
      });
      if (!response.json) {
        (response as unknown as { json: () => Promise<unknown> }).json = async () => body;
      }
      if (!response.status) {
        (response as unknown as { status: number }).status = status;
      }
      return response;
    }
  }

  return {
    ...actual,
    NextRequest: MockNextRequest,
    NextResponse: MockNextResponse,
  };
});

describe('GET /api/venues', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should return all venues from database', async () => {
    const mockVenues = [
      {
        id: 'ChIJ1',
        name: 'Test Venue 1',
        lat: 32.845,
        lng: -79.908,
        area: 'Daniel Island',
        address: '123 Test St',
        website: 'https://example.com',
      },
      {
        id: 'ChIJ2',
        name: 'Test Venue 2',
        lat: 32.855,
        lng: -79.918,
        area: 'Mount Pleasant',
        address: '456 Test Ave',
        website: null,
      },
    ];

    mockGetAll.mockReturnValue(mockVenues);

    const request = new NextRequest('http://localhost:3000/api/venues');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveLength(2);
    expect(data[0]).toEqual({
      id: 'ChIJ1',
      name: 'Test Venue 1',
      lat: 32.845,
      lng: -79.908,
      area: 'Daniel Island',
      address: '123 Test St',
      website: 'https://example.com',
    });
  });

  it('should filter by area query param', async () => {
    const filteredVenues = [
      {
        id: 'ChIJ1',
        name: 'Test Venue 1',
        lat: 32.845,
        lng: -79.908,
        area: 'Daniel Island',
        address: '123 Test St',
      },
    ];

    mockGetByArea.mockReturnValue(filteredVenues);

    const request = new NextRequest('http://localhost:3000/api/venues?area=Daniel Island');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveLength(1);
    expect(data[0].area).toBe('Daniel Island');
    expect(mockGetByArea).toHaveBeenCalledWith('Daniel Island');
  });

  it('should return empty array on database error', async () => {
    mockGetAll.mockImplementation(() => {
      throw new Error('Database connection failed');
    });

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    const request = new NextRequest('http://localhost:3000/api/venues');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual([]);
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('should transform venue data correctly', async () => {
    const mockVenues = [
      {
        id: 'ChIJ1',
        name: 'Test Venue',
        lat: 32.845,
        lng: -79.908,
        area: 'Daniel Island',
        address: '123 Test St',
        website: 'https://example.com',
        types: '["restaurant","bar"]',
        raw_google_data: '{}',
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      },
    ];

    mockGetAll.mockReturnValue(mockVenues);

    const request = new NextRequest('http://localhost:3000/api/venues');
    const response = await GET(request);
    const data = await response.json();

    expect(data[0]).toHaveProperty('id');
    expect(data[0]).toHaveProperty('name');
    expect(data[0]).toHaveProperty('lat');
    expect(data[0]).toHaveProperty('lng');
    expect(data[0]).toHaveProperty('area');
    expect(data[0]).toHaveProperty('address');
    expect(data[0]).toHaveProperty('website');
    // DB-specific columns should NOT be in the response
    expect(data[0]).not.toHaveProperty('types');
    expect(data[0]).not.toHaveProperty('raw_google_data');
    expect(data[0]).not.toHaveProperty('created_at');
  });

  it('should handle venues with missing fields', async () => {
    const mockVenues = [
      {
        id: 'ChIJ1',
        name: 'Test Venue',
        lat: 32.845,
        lng: -79.908,
      },
    ];

    mockGetAll.mockReturnValue(mockVenues);

    const request = new NextRequest('http://localhost:3000/api/venues');
    const response = await GET(request);
    const data = await response.json();

    expect(data[0].area).toBeNull();
    expect(data[0].address).toBeNull();
    expect(data[0].website).toBeNull();
  });

  it('should return empty array when no venues exist', async () => {
    mockGetAll.mockReturnValue([]);

    const request = new NextRequest('http://localhost:3000/api/venues');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual([]);
  });
});
