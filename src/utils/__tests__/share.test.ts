/**
 * @jest-environment jsdom
 */

jest.mock('@/lib/analytics', () => ({ trackShare: jest.fn() }));

import { shareSpot, buildShareText, legacyCopy } from '../share';
import { trackShare } from '@/lib/analytics';

const mockTrackShare = trackShare as jest.MockedFunction<typeof trackShare>;

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(window, 'location', {
    value: { origin: 'https://chsfinds.com' },
    writable: true,
  });
});

describe('buildShareText', () => {
  it('formats Happy Hour', () => {
    expect(buildShareText('Bar 42', 'Happy Hour', 'Downtown Charleston'))
      .toBe('🍹 Happy hour at Bar 42 in Downtown Charleston');
  });

  it('formats Brunch', () => {
    expect(buildShareText('Café X', 'Brunch', '')).toBe('🥞 Brunch at Café X');
  });

  it('formats Coming Soon with area', () => {
    expect(buildShareText('New Place', 'Coming Soon', 'Mount Pleasant'))
      .toBe('✨ New Place is opening soon in Mount Pleasant');
  });

  it('defaults for unknown type', () => {
    expect(buildShareText('Spot A', 'Unknown', 'IOP')).toBe('Check out Spot A in IOP');
  });
});

describe('legacyCopy', () => {
  it('creates a textarea, copies, and removes it', () => {
    document.execCommand = jest.fn().mockReturnValue(true);
    expect(legacyCopy('hello')).toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });

  it('returns false when execCommand fails', () => {
    document.execCommand = jest.fn().mockReturnValue(false);
    expect(legacyCopy('hello')).toBe(false);
  });

  it('returns false when execCommand throws', () => {
    document.execCommand = jest.fn().mockImplementation(() => { throw new Error('fail'); });
    expect(legacyCopy('hello')).toBe(false);
  });
});

describe('shareSpot', () => {
  const title = 'Test Bar';
  const spotId = 42;
  const spotType = 'Happy Hour';
  const area = 'Downtown Charleston';

  afterEach(() => {
    delete (navigator as Record<string, unknown>).share;
    delete (navigator as Record<string, unknown>).canShare;
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  });

  it('uses native share when canShare returns true', async () => {
    const shareFn = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: shareFn, configurable: true });
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });

    const result = await shareSpot(title, spotId, spotType, area);
    expect(result).toBe('shared');
    expect(shareFn).toHaveBeenCalledWith({
      title,
      text: '🍹 Happy hour at Test Bar in Downtown Charleston',
      url: 'https://chsfinds.com/?spot=42',
    });
    expect(mockTrackShare).toHaveBeenCalledWith(42, 'Test Bar');
  });

  it('returns failed when native share throws AbortError', async () => {
    const abort = new DOMException('User cancelled', 'AbortError');
    Object.defineProperty(navigator, 'share', { value: jest.fn().mockRejectedValue(abort), configurable: true });
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });

    const result = await shareSpot(title, spotId, spotType, area);
    expect(result).toBe('failed');
    expect(mockTrackShare).not.toHaveBeenCalled();
  });

  it('falls through to clipboard when canShare is missing', async () => {
    Object.defineProperty(navigator, 'share', { value: jest.fn(), configurable: true });
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    const result = await shareSpot(title, spotId, spotType, area);
    expect(result).toBe('copied');
    expect(writeText).toHaveBeenCalled();
    expect(mockTrackShare).toHaveBeenCalledWith(42, 'Test Bar');
  });

  it('falls through to clipboard when share throws non-AbortError', async () => {
    Object.defineProperty(navigator, 'share', {
      value: jest.fn().mockRejectedValue(new Error('NotAllowedError')),
      configurable: true,
    });
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    const result = await shareSpot(title, spotId, spotType, area);
    expect(result).toBe('copied');
    expect(writeText).toHaveBeenCalled();
  });

  it('falls through to legacy copy when clipboard API fails', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: jest.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    document.execCommand = jest.fn().mockReturnValue(true);

    const result = await shareSpot(title, spotId, spotType, area);
    expect(result).toBe('copied');
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(mockTrackShare).toHaveBeenCalledWith(42, 'Test Bar');
  });

  it('returns failed when all methods fail', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: jest.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    document.execCommand = jest.fn().mockReturnValue(false);

    const result = await shareSpot(title, spotId, spotType, area);
    expect(result).toBe('failed');
    expect(mockTrackShare).not.toHaveBeenCalled();
  });

  it('works with no clipboard API at all (legacy only)', async () => {
    document.execCommand = jest.fn().mockReturnValue(true);

    const result = await shareSpot(title, spotId, spotType, area);
    expect(result).toBe('copied');
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });

  it('clipboard text contains text before URL', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    await shareSpot(title, spotId, spotType, area);
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain('🍹 Happy hour at Test Bar');
    expect(copied).toContain('https://chsfinds.com/?spot=42');
    expect(copied.indexOf('🍹')).toBeLessThan(copied.indexOf('https://'));
  });
});
