import { isSpotActiveNow, getSpotStartMinutes, getSpotEndMinutes, extractCompactTime } from '../time-utils';
import type { Spot } from '@/contexts/SpotsContext';

function makeSpot(overrides: Partial<Spot> = {}): Spot {
  return {
    id: 1, lat: 32.7, lng: -79.9, title: 'Test Spot',
    description: '', type: 'Happy Hour', ...overrides,
  };
}

describe('time-utils', () => {
  describe('isSpotActiveNow', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('returns false when day restriction excludes today', () => {
      jest.setSystemTime(new Date('2026-02-26T22:00:00Z')); // Thursday 5pm ET
      const spot = makeSpot({ days: [3], timeStart: '11:00', timeEnd: '22:00' }); // Wed only
      expect(isSpotActiveNow(spot)).toBe(false);
    });

    it('returns true when day matches and time is within range', () => {
      jest.setSystemTime(new Date('2026-02-25T22:00:00Z')); // Wednesday 5pm ET
      const spot = makeSpot({ days: [3], timeStart: '16:00', timeEnd: '18:00' }); // Wed 4-6pm
      expect(isSpotActiveNow(spot)).toBe(true);
    });

    it('returns false when day matches but before time range', () => {
      jest.setSystemTime(new Date('2026-02-25T20:00:00Z')); // Wednesday 3pm ET
      const spot = makeSpot({ days: [3], timeStart: '16:00', timeEnd: '18:00' });
      expect(isSpotActiveNow(spot)).toBe(false);
    });

    it('returns false when time matches but wrong day', () => {
      jest.setSystemTime(new Date('2026-02-26T22:00:00Z')); // Thursday 5pm ET
      const spot = makeSpot({ days: [3], timeStart: '16:00', timeEnd: '18:00' });
      expect(isSpotActiveNow(spot)).toBe(false);
    });

    it('daily spot (no days restriction): active within time range', () => {
      jest.setSystemTime(new Date('2026-03-03T20:30:00Z')); // Tuesday 3:30pm ET
      const spot = makeSpot({ timeStart: '15:00', timeEnd: '17:00' });
      expect(isSpotActiveNow(spot)).toBe(true);
    });

    it('daily spot (no days restriction): inactive before time range', () => {
      jest.setSystemTime(new Date('2026-03-03T19:09:00Z')); // Tuesday 2:09pm ET
      const spot = makeSpot({ timeStart: '15:00', timeEnd: '17:00' });
      expect(isSpotActiveNow(spot)).toBe(false);
    });

    it('daily spot (no days restriction): inactive after time range', () => {
      jest.setSystemTime(new Date('2026-03-03T22:30:00Z')); // Tuesday 5:30pm ET
      const spot = makeSpot({ timeStart: '15:00', timeEnd: '17:00' });
      expect(isSpotActiveNow(spot)).toBe(false);
    });

    it('Mon-Fri restriction: active on Wednesday', () => {
      jest.setSystemTime(new Date('2026-02-25T22:00:00Z')); // Wednesday 5pm ET
      const spot = makeSpot({ days: [1, 2, 3, 4, 5], timeStart: '16:00', timeEnd: '19:00' });
      expect(isSpotActiveNow(spot)).toBe(true);
    });

    it('Mon-Fri restriction: inactive on Saturday', () => {
      jest.setSystemTime(new Date('2026-02-28T22:00:00Z')); // Saturday 5pm ET
      const spot = makeSpot({ days: [1, 2, 3, 4, 5], timeStart: '16:00', timeEnd: '19:00' });
      expect(isSpotActiveNow(spot)).toBe(false);
    });

    it('Mon-Fri restriction: inactive before time range', () => {
      jest.setSystemTime(new Date('2026-02-25T20:00:00Z')); // Wednesday 3pm ET
      const spot = makeSpot({ days: [1, 2, 3, 4, 5], timeStart: '16:00', timeEnd: '19:00' });
      expect(isSpotActiveNow(spot)).toBe(false);
    });

    it('specific date: active on that exact date within time', () => {
      jest.setSystemTime(new Date('2026-05-10T16:00:00Z')); // May 10 2026, 12pm ET
      const spot = makeSpot({ specificDate: '2026-05-10', timeStart: '11:00', timeEnd: '23:00' });
      expect(isSpotActiveNow(spot)).toBe(true);
    });

    it('specific date: inactive on a different date', () => {
      jest.setSystemTime(new Date('2026-03-03T16:00:00Z')); // March 3
      const spot = makeSpot({ specificDate: '2026-05-10', timeStart: '11:00', timeEnd: '23:00' });
      expect(isSpotActiveNow(spot)).toBe(false);
    });

    it('overnight span (e.g. 22:00-02:00): active at 11pm', () => {
      jest.setSystemTime(new Date('2026-02-26T04:00:00Z')); // Wed 11pm ET
      const spot = makeSpot({ timeStart: '22:00', timeEnd: '02:00' });
      expect(isSpotActiveNow(spot)).toBe(true);
    });

    it('overnight span (e.g. 22:00-02:00): active at 1am', () => {
      jest.setSystemTime(new Date('2026-02-26T06:00:00Z')); // Thu 1am ET
      const spot = makeSpot({ timeStart: '22:00', timeEnd: '02:00' });
      expect(isSpotActiveNow(spot)).toBe(true);
    });

    it('overnight span (e.g. 22:00-02:00): inactive at 3am', () => {
      jest.setSystemTime(new Date('2026-02-26T08:00:00Z')); // Thu 3am ET
      const spot = makeSpot({ timeStart: '22:00', timeEnd: '02:00' });
      expect(isSpotActiveNow(spot)).toBe(false);
    });

    it('falls back to operating hours when no structured time data', () => {
      jest.setSystemTime(new Date('2026-02-25T22:00:00Z')); // Wednesday 5pm ET
      const spot = makeSpot({
        operatingHours: {
          sun: 'closed', mon: { open: '10:00', close: '22:00' },
          tue: { open: '10:00', close: '22:00' }, wed: { open: '10:00', close: '22:00' },
          thu: { open: '10:00', close: '22:00' }, fri: { open: '10:00', close: '22:00' },
          sat: { open: '10:00', close: '22:00' },
        },
      });
      expect(isSpotActiveNow(spot)).toBe(true);
    });

    it('returns false when no time data and no operating hours', () => {
      jest.setSystemTime(new Date('2026-02-25T22:00:00Z'));
      const spot = makeSpot({});
      expect(isSpotActiveNow(spot)).toBe(false);
    });
  });

  describe('getSpotStartMinutes / getSpotEndMinutes', () => {
    it('returns minutes from timeStart/timeEnd', () => {
      const spot = makeSpot({ timeStart: '16:00', timeEnd: '18:00' });
      expect(getSpotStartMinutes(spot)).toBe(960);
      expect(getSpotEndMinutes(spot)).toBe(1080);
    });

    it('returns null when fields are missing', () => {
      const spot = makeSpot({});
      expect(getSpotStartMinutes(spot)).toBeNull();
      expect(getSpotEndMinutes(spot)).toBeNull();
    });

    it('handles midnight correctly', () => {
      const spot = makeSpot({ timeStart: '00:00', timeEnd: '02:00' });
      expect(getSpotStartMinutes(spot)).toBe(0);
      expect(getSpotEndMinutes(spot)).toBe(120);
    });
  });

  describe('extractCompactTime', () => {
    it('formats a normal time range', () => {
      const spot = makeSpot({ timeStart: '16:00', timeEnd: '19:00' });
      expect(extractCompactTime(spot)).toBe('4pm-7pm');
    });

    it('formats time with minutes', () => {
      const spot = makeSpot({ timeStart: '16:30', timeEnd: '19:30' });
      expect(extractCompactTime(spot)).toBe('4:30pm-7:30pm');
    });

    it('returns All day for 00:00-23:59', () => {
      const spot = makeSpot({ timeStart: '00:00', timeEnd: '23:59' });
      expect(extractCompactTime(spot)).toBe('All day');
    });

    it('returns null when no timeStart', () => {
      const spot = makeSpot({});
      expect(extractCompactTime(spot)).toBeNull();
    });

    it('returns just start when no timeEnd', () => {
      const spot = makeSpot({ timeStart: '16:00' });
      expect(extractCompactTime(spot)).toBe('4pm');
    });

    it('handles 12pm (noon) correctly', () => {
      const spot = makeSpot({ timeStart: '12:00', timeEnd: '14:00' });
      expect(extractCompactTime(spot)).toBe('12pm-2pm');
    });

    it('handles 12am (midnight) correctly', () => {
      const spot = makeSpot({ timeStart: '00:00', timeEnd: '02:00' });
      expect(extractCompactTime(spot)).toBe('12am-2am');
    });
  });
});
