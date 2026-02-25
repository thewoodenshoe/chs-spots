import { loadActivities, getActivityNames, getActivityByName, clearActivitiesCache } from '../activities';

const mockGetAll = jest.fn();

jest.mock('@/lib/db', () => ({
  activitiesDb: {
    getAll: (...args: unknown[]) => mockGetAll(...args),
  },
}));

describe('Activities Utility', () => {
  const mockActivities = [
    { name: 'Happy Hour', icon: 'Martini', emoji: '🍹', color: '#0d9488', community_driven: 0 },
    { name: 'Fishing Spots', icon: 'Fish', emoji: '🎣', color: '#0284c7', community_driven: 0 },
    { name: 'Sunset Spots', icon: 'Sunset', emoji: '🌅', color: '#f59e0b', community_driven: 0 },
  ];

  beforeEach(() => {
    clearActivitiesCache();
    jest.clearAllMocks();
  });

  describe('loadActivities', () => {
    it('should load activities from database', () => {
      mockGetAll.mockReturnValue(mockActivities);

      const activities = loadActivities();

      expect(activities).toHaveLength(3);
      expect(activities[0].name).toBe('Happy Hour');
      expect(activities[0].icon).toBe('Martini');
      expect(mockGetAll).toHaveBeenCalledTimes(1);
    });

    it('should return fallback activities if database is empty', () => {
      mockGetAll.mockReturnValue([]);

      const activities = loadActivities();

      expect(activities).toHaveLength(4);
      expect(activities[0].name).toBe('Happy Hour');
      expect(activities[0].icon).toBe('Martini');
      expect(activities[0].emoji).toBe('🍹');
      expect(activities[0].color).toBe('#0d9488');
      expect(activities[2].name).toBe('Fishing Spots');
      expect(activities[2].communityDriven).toBe(true);
      expect(activities[3].name).toBe('Must-Do Spots');
      expect(activities[3].communityDriven).toBe(true);
    });

    it('should return fallback activities if database throws', () => {
      mockGetAll.mockImplementation(() => { throw new Error('DB error'); });

      const activities = loadActivities();

      expect(activities).toHaveLength(4);
      expect(activities[0].name).toBe('Happy Hour');
    });

    it('should cache activities after first load', () => {
      mockGetAll.mockReturnValue(mockActivities);

      const activities1 = loadActivities();
      const activities2 = loadActivities();

      expect(activities1).toBe(activities2);
      expect(mockGetAll).toHaveBeenCalledTimes(1);
    });
  });

  describe('getActivityNames', () => {
    it('should return array of activity names', () => {
      mockGetAll.mockReturnValue(mockActivities);

      const names = getActivityNames();

      expect(names).toEqual(['Happy Hour', 'Fishing Spots', 'Sunset Spots']);
    });
  });

  describe('getActivityByName', () => {
    it('should return activity by name', () => {
      mockGetAll.mockReturnValue(mockActivities);

      const activity = getActivityByName('Happy Hour');

      expect(activity).toBeDefined();
      expect(activity!.name).toBe('Happy Hour');
      expect(activity!.icon).toBe('Martini');
    });

    it('should return undefined if activity not found', () => {
      mockGetAll.mockReturnValue(mockActivities);

      const activity = getActivityByName('Non-existent Activity');

      expect(activity).toBeUndefined();
    });
  });

  describe('clearActivitiesCache', () => {
    it('should clear the cache', () => {
      mockGetAll.mockReturnValue(mockActivities);

      const activities1 = loadActivities();
      clearActivitiesCache();
      const activities2 = loadActivities();

      expect(activities1).not.toBe(activities2);
      expect(mockGetAll).toHaveBeenCalledTimes(2);
    });
  });
});
