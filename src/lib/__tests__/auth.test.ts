/**
 * @jest-environment node
 */
import { isAdminRequest, unauthorizedResponse } from '../auth';

describe('isAdminRequest', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, ADMIN_API_KEY: 'test-secret-key' };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns false when ADMIN_API_KEY is not set', () => {
    delete process.env.ADMIN_API_KEY;
    const req = new Request('http://localhost', {
      headers: { authorization: 'Bearer test-secret-key' },
    });
    expect(isAdminRequest(req)).toBe(false);
  });

  it('returns true for valid Bearer token', () => {
    const req = new Request('http://localhost', {
      headers: { authorization: 'Bearer test-secret-key' },
    });
    expect(isAdminRequest(req)).toBe(true);
  });

  it('returns true for valid x-admin-key header', () => {
    const req = new Request('http://localhost', {
      headers: { 'x-admin-key': 'test-secret-key' },
    });
    expect(isAdminRequest(req)).toBe(true);
  });

  it('returns false for wrong Bearer token', () => {
    const req = new Request('http://localhost', {
      headers: { authorization: 'Bearer wrong-key' },
    });
    expect(isAdminRequest(req)).toBe(false);
  });

  it('returns false for wrong x-admin-key', () => {
    const req = new Request('http://localhost', {
      headers: { 'x-admin-key': 'wrong-key' },
    });
    expect(isAdminRequest(req)).toBe(false);
  });

  it('returns false with no auth headers', () => {
    const req = new Request('http://localhost');
    expect(isAdminRequest(req)).toBe(false);
  });

  it('handles case-insensitive Bearer prefix', () => {
    const req = new Request('http://localhost', {
      headers: { authorization: 'bearer test-secret-key' },
    });
    expect(isAdminRequest(req)).toBe(true);
  });
});

describe('unauthorizedResponse', () => {
  it('returns 401 status', async () => {
    const res = unauthorizedResponse();
    expect(res.status).toBe(401);
  });

  it('returns JSON error body', async () => {
    const res = unauthorizedResponse();
    const body = await res.json();
    expect(body).toEqual({ error: 'Unauthorized' });
  });
});
