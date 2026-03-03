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

    it('natural language "daily from 3pm to 5pm": inactive before 3pm', () => {
      jest.setSystemTime(new Date('2026-03-03T19:09:00Z')); // Tuesday 2:09pm ET
      const spot: Spot = {
        id: 4893,
        lat: 32.88,
        lng: -79.97,
        title: 'Jackrabbit Filly',
        description: 'Daily snacks and drink specials',
        type: 'Happy Hour',
        promotionTime: 'daily from 3pm to 5pm',
      };
      expect(isSpotActiveNow(spot)).toBe(false);
    });

    it('natural language "daily from 3pm to 5pm": active at 3:30pm', () => {
      jest.setSystemTime(new Date('2026-03-03T20:30:00Z')); // Tuesday 3:30pm ET
      const spot: Spot = {
        id: 4893,
        lat: 32.88,
        lng: -79.97,
        title: 'Jackrabbit Filly',
        description: 'Daily snacks and drink specials',
        type: 'Happy Hour',
        promotionTime: 'daily from 3pm to 5pm',
      };
      expect(isSpotActiveNow(spot)).toBe(true);
    });

    it('natural language "daily from 3pm to 5pm": inactive after 5pm', () => {
      jest.setSystemTime(new Date('2026-03-03T22:30:00Z')); // Tuesday 5:30pm ET
      const spot: Spot = {
        id: 4893,
        lat: 32.88,
        lng: -79.97,
        title: 'Jackrabbit Filly',
        description: 'Daily snacks and drink specials',
        type: 'Happy Hour',
        promotionTime: 'daily from 3pm to 5pm',
      };
      expect(isSpotActiveNow(spot)).toBe(false);
    });

    it('natural language "Monday to Friday from 4pm to 7pm": active Wed 5pm', () => {
      jest.setSystemTime(new Date('2026-02-25T22:00:00Z')); // Wednesday 5pm ET
      const spot: Spot = {
        id: 5001,
        lat: 32.78,
        lng: -79.93,
        title: 'Pearlz Oyster Bar',
        description: 'Happy hour Mon-Fri',
        type: 'Happy Hour',
        promotionTime: 'Monday to Friday from 4pm to 7pm',
      };
      expect(isSpotActiveNow(spot)).toBe(true);
    });

    it('natural language "Monday to Friday from 4pm to 7pm": inactive Sat 5pm', () => {
      jest.setSystemTime(new Date('2026-02-28T22:00:00Z')); // Saturday 5pm ET
      const spot: Spot = {
        id: 5001,
        lat: 32.78,
        lng: -79.93,
        title: 'Pearlz Oyster Bar',
        description: 'Happy hour Mon-Fri',
        type: 'Happy Hour',
        promotionTime: 'Monday to Friday from 4pm to 7pm',
      };
      expect(isSpotActiveNow(spot)).toBe(false);
    });

    it('natural language "Monday to Friday from 4pm to 7pm": inactive Wed 3pm', () => {
      jest.setSystemTime(new Date('2026-02-25T20:00:00Z')); // Wednesday 3pm ET
      const spot: Spot = {
        id: 5001,
        lat: 32.78,
        lng: -79.93,
        title: 'Pearlz Oyster Bar',
        description: 'Happy hour Mon-Fri',
        type: 'Happy Hour',
        promotionTime: 'Monday to Friday from 4pm to 7pm',
      };
      expect(isSpotActiveNow(spot)).toBe(false);
    });

    it('plural day name "Sundays": active on Sunday', () => {
      jest.setSystemTime(new Date('2026-03-01T18:00:00Z')); // Sunday 1pm ET
      const spot: Spot = {
        id: 5105,
        lat: 32.78,
        lng: -79.93,
        title: 'Container Bar',
        description: 'Brunch every Sunday',
        type: 'Brunch',
        promotionTime: '1pm-4pm • Sundays',
      };
      expect(isSpotActiveNow(spot)).toBe(true);
    });

    it('plural day name "Sundays": inactive on Tuesday', () => {
      jest.setSystemTime(new Date('2026-03-03T18:00:00Z')); // Tuesday 1pm ET
      const spot: Spot = {
        id: 5105,
        lat: 32.78,
        lng: -79.93,
        title: 'Container Bar',
        description: 'Brunch every Sunday',
        type: 'Brunch',
        promotionTime: '1pm-4pm • Sundays',
      };
      expect(isSpotActiveNow(spot)).toBe(false);
    });

    it('specific calendar date: inactive when not that date', () => {
      jest.setSystemTime(new Date('2026-03-03T16:00:00Z')); // Tuesday 11am ET
      const spot: Spot = {
        id: 4872,
        lat: 32.78,
        lng: -79.93,
        title: 'Bay Street Biergarten',
        description: 'Mother\'s Day brunch',
        type: 'Brunch',
        promotionTime: '11am-11pm • Sunday May 10, 2026',
      };
      expect(isSpotActiveNow(spot)).toBe(false);
    });

    it('specific calendar date: active on that exact date', () => {
      jest.setSystemTime(new Date('2026-05-10T16:00:00Z')); // May 10 2026, 12pm ET
      const spot: Spot = {
        id: 4872,
        lat: 32.78,
        lng: -79.93,
        title: 'Bay Street Biergarten',
        description: 'Mother\'s Day brunch',
        type: 'Brunch',
        promotionTime: '11am-11pm • Sunday May 10, 2026',
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

    it('parses "daily from 3pm to 5pm" correctly', () => {
      const spot: Spot = {
        id: 1,
        lat: 0,
        lng: 0,
        title: 'Test',
        description: '',
        type: 'Happy Hour',
        promotionTime: 'daily from 3pm to 5pm',
      };
      expect(getSpotStartMinutes(spot)).toBe(15 * 60); // 3pm = 900 min
      expect(getSpotEndMinutes(spot)).toBe(17 * 60);   // 5pm = 1020 min
    });

    it('parses "Monday to Friday from 4pm to 7pm" correctly', () => {
      const spot: Spot = {
        id: 1,
        lat: 0,
        lng: 0,
        title: 'Test',
        description: '',
        type: 'Happy Hour',
        promotionTime: 'Monday to Friday from 4pm to 7pm',
      };
      expect(getSpotStartMinutes(spot)).toBe(16 * 60); // 4pm = 960 min
      expect(getSpotEndMinutes(spot)).toBe(19 * 60);   // 7pm = 1140 min
    });
  });
});
