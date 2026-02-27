/**
 * @jest-environment node
 */
import { checkRateLimit, getClientIp } from '../rate-limit';

describe('checkRateLimit', () => {
  it('allows requests under the limit', () => {
    const key = `test-rl-${Date.now()}`;
    expect(checkRateLimit(key, 3, 10_000)).toBe(true);
    expect(checkRateLimit(key, 3, 10_000)).toBe(true);
    expect(checkRateLimit(key, 3, 10_000)).toBe(true);
  });

  it('blocks requests over the limit', () => {
    const key = `test-rl-block-${Date.now()}`;
    expect(checkRateLimit(key, 2, 10_000)).toBe(true);
    expect(checkRateLimit(key, 2, 10_000)).toBe(true);
    expect(checkRateLimit(key, 2, 10_000)).toBe(false);
  });

  it('uses separate keys independently', () => {
    const key1 = `test-rl-a-${Date.now()}`;
    const key2 = `test-rl-b-${Date.now()}`;
    expect(checkRateLimit(key1, 1, 10_000)).toBe(true);
    expect(checkRateLimit(key1, 1, 10_000)).toBe(false);
    expect(checkRateLimit(key2, 1, 10_000)).toBe(true);
  });
});

describe('getClientIp', () => {
  it('prefers x-real-ip over x-forwarded-for', () => {
    const req = new Request('http://localhost', {
      headers: {
        'x-real-ip': '5.6.7.8',
        'x-forwarded-for': '1.2.3.4, 10.0.0.1',
      },
    });
    expect(getClientIp(req)).toBe('5.6.7.8');
  });

  it('returns last x-forwarded-for entry (trusted proxy hop) when x-real-ip is absent', () => {
    const req = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' },
    });
    expect(getClientIp(req)).toBe('10.0.0.1');
  });

  it('returns single x-forwarded-for entry', () => {
    const req = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '1.2.3.4' },
    });
    expect(getClientIp(req)).toBe('1.2.3.4');
  });

  it('returns x-real-ip when x-forwarded-for is absent', () => {
    const req = new Request('http://localhost', {
      headers: { 'x-real-ip': '5.6.7.8' },
    });
    expect(getClientIp(req)).toBe('5.6.7.8');
  });

  it('returns "unknown" when no proxy headers present', () => {
    const req = new Request('http://localhost');
    expect(getClientIp(req)).toBe('unknown');
  });
});
