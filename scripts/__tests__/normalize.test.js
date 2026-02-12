/**
 * Tests for shared normalization utility (scripts/utils/normalize.js)
 */

const { normalizeText, normalizeUrl } = require('../utils/normalize');

describe('normalizeText', () => {
  test('returns empty string for falsy input', () => {
    expect(normalizeText(null)).toBe('');
    expect(normalizeText(undefined)).toBe('');
    expect(normalizeText('')).toBe('');
  });

  test('removes ISO timestamps', () => {
    const input = 'Updated 2026-01-20T15:34:58.724Z for review';
    const result = normalizeText(input);
    expect(result).not.toContain('2026-01-20');
    expect(result).toContain('Updated');
    expect(result).toContain('for review');
  });

  test('removes ISO dates without time', () => {
    const input = 'Last updated 2026-01-20 by admin';
    const result = normalizeText(input);
    expect(result).not.toContain('2026-01-20');
  });

  test('removes day-of-week + month-day patterns', () => {
    const input = 'Open Wednesday January 28th for happy hour';
    const result = normalizeText(input);
    expect(result).not.toContain('Wednesday January 28th');
    expect(result).toContain('Open');
    expect(result).toContain('for happy hour');
  });

  test('removes month-day patterns with ordinal suffixes', () => {
    const input = 'Menu updated January 28th';
    const result = normalizeText(input);
    expect(result).not.toContain('January 28th');
  });

  test('removes GTM IDs', () => {
    const input = 'Container gtm-abc123 loaded';
    const result = normalizeText(input);
    expect(result).not.toContain('gtm-abc123');
  });

  test('removes Google Analytics IDs', () => {
    const input = 'Tracking UA-123456-7 and G-ABCDE12345';
    const result = normalizeText(input);
    expect(result).not.toContain('UA-123456-7');
    expect(result).not.toContain('G-ABCDE12345');
  });

  test('removes tracking parameters', () => {
    const input = 'Visit https://example.com?fbclid=abc123&utm_source=google';
    const result = normalizeText(input);
    expect(result).not.toContain('fbclid');
    expect(result).not.toContain('utm_source');
  });

  test('removes copyright footers', () => {
    const input = 'Content here Copyright © 2026 All rights reserved';
    const result = normalizeText(input);
    expect(result).not.toContain('Copyright');
    expect(result).not.toContain('All rights reserved');
  });

  test('removes session IDs', () => {
    const input = 'session_abc12345def67890 token_xyz12345678abcdef';
    const result = normalizeText(input);
    expect(result).not.toContain('session_abc12345def67890');
    expect(result).not.toContain('token_xyz12345678abcdef');
  });

  test('removes standalone year numbers', () => {
    const input = 'Copyright 2026 restaurant name';
    const result = normalizeText(input);
    expect(result).not.toContain('2026');
  });

  test('collapses whitespace', () => {
    const input = 'Hello    world\n\nfoo\tbar';
    const result = normalizeText(input);
    expect(result).toBe('Hello world foo bar');
  });

  test('produces identical hash for content differing only in dates', () => {
    const monday = 'Happy Hour Monday January 20th specials include $5 beer';
    const tuesday = 'Happy Hour Tuesday January 21st specials include $5 beer';
    expect(normalizeText(monday)).toBe(normalizeText(tuesday));
  });

  test('produces different hash for actual content changes', () => {
    const original = 'Happy Hour specials: $5 beer, $7 wine';
    const changed = 'Happy Hour specials: $6 beer, $8 wine';
    expect(normalizeText(original)).not.toBe(normalizeText(changed));
  });
});

describe('normalizeUrl', () => {
  test('returns empty string for falsy input', () => {
    expect(normalizeUrl(null)).toBe('');
    expect(normalizeUrl(undefined)).toBe('');
    expect(normalizeUrl('')).toBe('');
  });

  test('removes tracking parameters', () => {
    const url = 'https://example.com/menu?fbclid=abc123&utm_source=google&gclid=xyz';
    const result = normalizeUrl(url);
    expect(result).toBe('https://example.com/menu');
  });

  test('preserves base URL without tracking params', () => {
    const url = 'https://example.com/happy-hour';
    const result = normalizeUrl(url);
    expect(result).toBe('https://example.com/happy-hour');
  });

  test('handles malformed URLs gracefully', () => {
    const url = 'not-a-url?fbclid=abc123';
    const result = normalizeUrl(url);
    expect(result).toBe('not-a-url');
  });
});
