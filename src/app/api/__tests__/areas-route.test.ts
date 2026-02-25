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
const mockGetAll = jest.fn();

jest.mock('@/lib/db', () => ({
  areasDb: {
    getNames: (...args: unknown[]) => mockGetNames(...args),
    getAll: (...args: unknown[]) => mockGetAll(...args),
  },
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => true,
  getClientIp: () => '127.0.0.1',
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
    mockGetNames.mockReturnValue(['Daniel Island', 'Mount Pleasant', 'Park Circle']);

    const response = await GET(mockRequest);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(['Daniel Island', 'Mount Pleasant', 'Park Circle']);
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

  it('should return all areas from database', async () => {
    mockGetNames.mockReturnValue([
      'Daniel Island', 'Mount Pleasant', 'Downtown Charleston',
      "Sullivan's Island", 'Park Circle', 'North Charleston',
      'West Ashley', 'James Island',
    ]);

    const response = await GET(mockRequest);
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
