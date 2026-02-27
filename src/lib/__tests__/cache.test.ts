/**
 * @jest-environment node
 */
import { getCache, setCache, invalidate, invalidatePrefix, clearAll } from '../cache';

describe('cache', () => {
  afterEach(() => {
    clearAll();
  });

  it('returns null for missing key', () => {
    expect(getCache('nonexistent')).toBeNull();
  });

  it('stores and retrieves values', () => {
    setCache('test-key', { foo: 'bar' }, 60_000);
    expect(getCache('test-key')).toEqual({ foo: 'bar' });
  });

  it('returns null for expired entries', () => {
    setCache('expired', 'data', -1);
    expect(getCache('expired')).toBeNull();
  });

  it('invalidates a specific key', () => {
    setCache('a', 1, 60_000);
    setCache('b', 2, 60_000);
    invalidate('a');
    expect(getCache('a')).toBeNull();
    expect(getCache('b')).toBe(2);
  });

  it('invalidates by prefix', () => {
    setCache('api:spots', 1, 60_000);
    setCache('api:venues', 2, 60_000);
    setCache('other', 3, 60_000);
    invalidatePrefix('api:');
    expect(getCache('api:spots')).toBeNull();
    expect(getCache('api:venues')).toBeNull();
    expect(getCache('other')).toBe(3);
  });

  it('clearAll removes everything', () => {
    setCache('x', 1, 60_000);
    setCache('y', 2, 60_000);
    clearAll();
    expect(getCache('x')).toBeNull();
    expect(getCache('y')).toBeNull();
  });
});
