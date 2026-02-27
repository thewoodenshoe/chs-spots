jest.mock('next/server', () => ({
  NextResponse: {
    json: jest.fn((data, init) => ({
      json: async () => data,
      status: init?.status || 200,
      ok: (init?.status || 200) < 400,
    })),
  },
}));

const mockGetNames = jest.fn();

jest.mock('@/lib/db', () => ({
  areasDb: {
    getNames: (...args: unknown[]) => mockGetNames(...args),
  },
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => true,
  getClientIp: () => '127.0.0.1',
}));

jest.mock('@/lib/cache', () => ({
  getCache: () => null,
  setCache: () => {},
}));

import { GET } from '../areas/route';

describe('/api/areas route', () => {
  const mockRequest = {
    headers: { get: (key: string) => key === 'x-forwarded-for' ? '127.0.0.1' : null },
  } as unknown as Request;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return area names from database', async () => {
    mockGetNames.mockReturnValue(['Daniel Island', 'Mount Pleasant', 'Downtown Charleston']);

    const response = await GET(mockRequest);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(['Daniel Island', 'Mount Pleasant', 'Downtown Charleston']);
  });

  it('should return area names using the "name" attribute', async () => {
    mockGetNames.mockReturnValue(['Daniel Island', 'North Charleston', 'West Ashley']);

    const response = await GET(mockRequest);
    const data = await response.json();

    expect(data).toEqual(['Daniel Island', 'North Charleston', 'West Ashley']);
    expect(data).not.toContain(undefined);
  });

  it('should handle database error', async () => {
    mockGetNames.mockImplementation(() => { throw new Error('DB error'); });

    const response = await GET(mockRequest);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toHaveProperty('error');
    expect(data.error).toBe('Failed to load areas');
  });

  it('should return all 7 areas from database', async () => {
    mockGetNames.mockReturnValue([
      'Daniel Island', 'Mount Pleasant', 'Downtown Charleston',
      "Sullivan's & IOP", 'North Charleston', 'West Ashley', 'James Island',
    ]);

    const response = await GET(mockRequest);
    const data = await response.json();

    expect(data.length).toBe(7);
    expect(data).toContain('Daniel Island');
    expect(data).toContain('Mount Pleasant');
    expect(data).toContain('North Charleston');
    expect(data).toContain('West Ashley');
    expect(data).toContain('James Island');
  });
});
