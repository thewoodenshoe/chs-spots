import { GET } from '../venues/route';
import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';

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
        (this as any).headers = new MockHeaders();
      }
    }
  }

  class MockNextResponse {
    static json(body: any, init?: ResponseInit) {
      const status = init?.status || 200;
      const response = new Response(JSON.stringify(body), {
        ...init,
        status,
        headers: {
          'Content-Type': 'application/json',
          ...(init?.headers || {}),
        },
      });
      // Ensure response has json method (browser Response API)
      if (!response.json) {
        (response as any).json = async () => body;
      }
      // Ensure status is accessible
      if (!response.status) {
        (response as any).status = status;
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

// Mock fs module
jest.mock('fs');
const mockedFs = fs as jest.Mocked<typeof fs>;

// Mock path.join to return expected path
jest.mock('path', () => {
  const actual = jest.requireActual('path');
  return {
    ...actual,
    join: jest.fn((...paths) => {
      // If the path ends with 'venues.json', return a mock path for reporting
      if (paths[paths.length - 1] === 'venues.json') {
        return '/mock/path/to/data/reporting/venues.json';
      }
      return actual.join(...paths);
    }),
  };
});

describe('GET /api/venues', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock path.join for each test
    const pathModule = require('path');
    pathModule.join.mockImplementation((...paths: string[]) => {
      if (paths[paths.length - 1] === 'venues.json') {
        return '/mock/path/to/data/reporting/venues.json';
      }
      const actualPath = jest.requireActual('path');
      return actualPath.join(...paths);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should return all venues from venues.json', async () => {
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

    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(mockVenues));

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
    const mockVenues = [
      {
        id: 'ChIJ1',
        name: 'Test Venue 1',
        lat: 32.845,
        lng: -79.908,
        area: 'Daniel Island',
        address: '123 Test St',
      },
      {
        id: 'ChIJ2',
        name: 'Test Venue 2',
        lat: 32.855,
        lng: -79.918,
        area: 'Mount Pleasant',
        address: '456 Test Ave',
      },
    ];

    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(mockVenues));

    const request = new NextRequest('http://localhost:3000/api/venues?area=Daniel Island');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveLength(1);
    expect(data[0].area).toBe('Daniel Island');
  });

  it('should return empty array if file missing', async () => {
    mockedFs.existsSync.mockReturnValue(false);

    const request = new NextRequest('http://localhost:3000/api/venues');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual([]);
  });

  it('should handle JSON parse errors gracefully', async () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue('invalid json');

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    const request = new NextRequest('http://localhost:3000/api/venues');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual([]);
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('should handle non-array data gracefully', async () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify({ error: 'not an array' }));

    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

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
        place_id: 'ChIJ1', // Test place_id fallback
        name: 'Test Venue',
        lat: 32.845,
        lng: -79.908,
        area: 'Daniel Island',
        address: '123 Test St',
        website: 'https://example.com',
      },
    ];

    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(mockVenues));

    const request = new NextRequest('http://localhost:3000/api/venues');
    const response = await GET(request);
    const data = await response.json();

    expect(data[0].id).toBe('ChIJ1');
    expect(data[0]).toHaveProperty('name');
    expect(data[0]).toHaveProperty('lat');
    expect(data[0]).toHaveProperty('lng');
    expect(data[0]).toHaveProperty('area');
    expect(data[0]).toHaveProperty('address');
    expect(data[0]).toHaveProperty('website');
  });

  it('should handle venues with missing fields', async () => {
    const mockVenues = [
      {
        id: 'ChIJ1',
        name: 'Test Venue',
        lat: 32.845,
        lng: -79.908,
        // Missing area, address, website
      },
    ];

    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(mockVenues));

    const request = new NextRequest('http://localhost:3000/api/venues');
    const response = await GET(request);
    const data = await response.json();

    expect(data[0].area).toBeNull();
    expect(data[0].address).toBeNull();
    expect(data[0].website).toBeNull();
  });
});
