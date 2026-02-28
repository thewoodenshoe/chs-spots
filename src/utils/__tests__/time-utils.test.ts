import { isSpotActiveNow, getSpotStartMinutes, getSpotEndMinutes } from '../time-utils';
import type { Spot } from '@/contexts/SpotsContext';

describe('time-utils', () => {
  describe('isSpotActiveNow', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('returns false when promotion is Wednesday-only and today is Thursday, even if venue would be open', () => {
      jest.setSystemTime(new Date('2026-02-26T22:00:00Z')); // Thursday 5pm ET
      const spot: Spot = {
        id: 1,
        lat: 32.7,
        lng: -79.9,
        title: 'Southern Roots Smokehouse',
        description: 'Happy hour Wednesday',
        type: 'Happy Hour',
        promotionTime: 'Happy Hour • Wednesday',
        operatingHours: {
          sun: 'closed',
          mon: { open: '11:00', close: '22:00' },
          tue: { open: '11:00', close: '22:00' },
          wed: { open: '11:00', close: '22:00' },
          thu: { open: '11:00', close: '22:00' },
          fri: { open: '11:00', close: '22:00' },
          sat: { open: '11:00', close: '22:00' },
        },
      };
      expect(isSpotActiveNow(spot)).toBe(false);
    });

    it('returns true when promotion is Wednesday-only and today is Wednesday and venue is open', () => {
      jest.setSystemTime(new Date('2026-02-25T22:00:00Z')); // Wednesday 5pm ET
      const spot: Spot = {
        id: 1,
        lat: 32.7,
        lng: -79.9,
        title: 'Southern Roots Smokehouse',
        description: 'Happy hour Wednesday',
        type: 'Happy Hour',
        promotionTime: 'Happy Hour • Wednesday',
        operatingHours: {
          sun: 'closed',
          mon: { open: '11:00', close: '22:00' },
          tue: { open: '11:00', close: '22:00' },
          wed: { open: '11:00', close: '22:00' },
          thu: { open: '11:00', close: '22:00' },
          fri: { open: '11:00', close: '22:00' },
          sat: { open: '11:00', close: '22:00' },
        },
      };
      expect(isSpotActiveNow(spot)).toBe(true);
    });

    it('respects time window: active Wednesday 5pm for 4pm-6pm', () => {
      jest.setSystemTime(new Date('2026-02-25T22:00:00Z')); // Wednesday 5pm ET
      const spot: Spot = {
        id: 1,
        lat: 32.7,
        lng: -79.9,
        title: 'Test Bar',
        description: 'Happy hour 4-6pm',
        type: 'Happy Hour',
        promotionTime: '4pm-6pm • Wednesday',
      };
      expect(isSpotActiveNow(spot)).toBe(true);
    });

    it('respects time window: inactive Wednesday 3pm for 4pm-6pm', () => {
      jest.setSystemTime(new Date('2026-02-25T20:00:00Z')); // Wednesday 3pm ET
      const spot: Spot = {
        id: 1,
        lat: 32.7,
        lng: -79.9,
        title: 'Test Bar',
        description: 'Happy hour 4-6pm',
        type: 'Happy Hour',
        promotionTime: '4pm-6pm • Wednesday',
      };
      expect(isSpotActiveNow(spot)).toBe(false);
    });

    it('respects time window: inactive Thursday 5pm for 4pm-6pm Wednesday', () => {
      jest.setSystemTime(new Date('2026-02-26T22:00:00Z')); // Thursday 5pm ET
      const spot: Spot = {
        id: 1,
        lat: 32.7,
        lng: -79.9,
        title: 'Test Bar',
        description: 'Happy hour 4-6pm',
        type: 'Happy Hour',
        promotionTime: '4pm-6pm • Wednesday',
      };
      expect(isSpotActiveNow(spot)).toBe(false);
    });

    it('uses operating hours fallback when no day restriction and no parseable time', () => {
      jest.setSystemTime(new Date('2026-02-25T22:00:00Z')); // Wednesday 5pm ET (within 11-22)
      const spot: Spot = {
        id: 1,
        lat: 32.7,
        lng: -79.9,
        title: 'Daily Specials Spot',
        description: 'Daily specials',
        type: 'Happy Hour',
        promotionTime: 'Daily specials',
        operatingHours: {
          sun: { open: '10:00', close: '22:00' },
          mon: { open: '10:00', close: '22:00' },
          tue: { open: '10:00', close: '22:00' },
          wed: { open: '10:00', close: '22:00' },
          thu: { open: '10:00', close: '22:00' },
          fri: { open: '10:00', close: '22:00' },
          sat: { open: '10:00', close: '22:00' },
        },
      };
      expect(isSpotActiveNow(spot)).toBe(true);
    });
  });

  describe('getSpotStartMinutes and getSpotEndMinutes', () => {
    it('parses 4pm-6pm range', () => {
      const spot: Spot = {
        id: 1,
        lat: 0,
        lng: 0,
        title: 'Test',
        description: '',
        type: 'Happy Hour',
        promotionTime: '4pm-6pm • Wednesday',
      };
      expect(getSpotStartMinutes(spot)).toBe(16 * 60);
      expect(getSpotEndMinutes(spot)).toBe(18 * 60);
    });
  });
});
