import { loadActivities, getActivityNames, getActivityByName, clearActivitiesCache } from '../activities';
import fs from 'fs';
import path from 'path';

// Mock fs module
jest.mock('fs');
const mockedFs = fs as jest.Mocked<typeof fs>;

describe('Activities Utility', () => {
  const mockActivitiesPath = path.join(process.cwd(), 'data', 'config', 'activities.json');
  const mockActivities = [
    { name: 'Happy Hour', icon: 'Martini', emoji: '🍹', color: '#0d9488' },
    { name: 'Fishing Spots', icon: 'Fish', emoji: '🎣', color: '#0284c7' },
    { name: 'Sunset Spots', icon: 'Sunset', emoji: '🌅', color: '#f59e0b' },
  ];

  beforeEach(() => {
    clearActivitiesCache();
    jest.clearAllMocks();
  });

  describe('loadActivities', () => {
    it('should load activities from config file', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(mockActivities));

      const activities = loadActivities();

      expect(activities).toEqual(mockActivities);
      expect(mockedFs.readFileSync).toHaveBeenCalledWith(mockActivitiesPath, 'utf8');
    });

    it('should return fallback activities if file does not exist', () => {
      mockedFs.existsSync.mockReturnValue(false);

      const activities = loadActivities();

      expect(activities).toHaveLength(4);
      expect(activities[0].name).toBe('Happy Hour');
      expect(activities[0].icon).toBe('Martini');
      expect(activities[0].emoji).toBe('🍹');
      expect(activities[0].color).toBe('#0d9488');
      expect(activities[2].name).toBe('Fishing Spots');
      expect(activities[2].communityDriven).toBe(true);
      expect(activities[3].name).toBe('Must-See Spots');
      expect(activities[3].communityDriven).toBe(true);
    });

    it('should return fallback activities if file read fails', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockImplementation(() => {
        throw new Error('File read error');
      });

      const activities = loadActivities();

      expect(activities).toHaveLength(4);
      expect(activities[0].name).toBe('Happy Hour');
    });

    it('should cache activities after first load', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(mockActivities));

      const activities1 = loadActivities();
      const activities2 = loadActivities();

      expect(activities1).toBe(activities2); // Same reference (cached)
      expect(mockedFs.readFileSync).toHaveBeenCalledTimes(1);
    });
  });

  describe('getActivityNames', () => {
    it('should return array of activity names', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(mockActivities));

      const names = getActivityNames();

      expect(names).toEqual(['Happy Hour', 'Fishing Spots', 'Sunset Spots']);
    });
  });

  describe('getActivityByName', () => {
    it('should return activity by name', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(mockActivities));

      const activity = getActivityByName('Happy Hour');

      expect(activity).toEqual({ name: 'Happy Hour', icon: 'Martini', emoji: '🍹', color: '#0d9488' });
    });

    it('should return undefined if activity not found', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(mockActivities));

      const activity = getActivityByName('Non-existent Activity');

      expect(activity).toBeUndefined();
    });
  });

  describe('clearActivitiesCache', () => {
    it('should clear the cache', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(mockActivities));

      const activities1 = loadActivities();
      clearActivitiesCache();
      const activities2 = loadActivities();

      expect(activities1).not.toBe(activities2); // Different references
      expect(mockedFs.readFileSync).toHaveBeenCalledTimes(2);
    });
  });
});
