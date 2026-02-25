/**
 * DAL (Data Access Layer) unit tests.
 * Uses a fresh temp SQLite database per test for isolation.
 */

const { setupTestDb, teardownTestDb } = require('./helpers/test-db');

let db;

beforeEach(() => {
  const ctx = setupTestDb();
  db = ctx.db;
});

afterEach(() => {
  teardownTestDb();
});

describe('DAL: venues', () => {
  test('getAll returns seeded venues', () => {
    const all = db.venues.getAll();
    expect(all.length).toBe(2);
    expect(all[0].name).toBe('Test Bar');
  });

  test('getById returns correct venue', () => {
    const v = db.venues.getById('test-venue-1');
    expect(v).toBeDefined();
    expect(v.name).toBe('Test Bar');
    expect(v.lat).toBe(32.7765);
  });

  test('getById returns undefined for missing venue', () => {
    expect(db.venues.getById('nonexistent')).toBeUndefined();
  });

  test('upsert inserts new venue', () => {
    db.venues.upsert({ id: 'new-1', name: 'New Place', lat: 32.8, lng: -79.9, area: 'West Ashley' });
    expect(db.venues.count()).toBe(3);
  });

  test('upsert updates existing venue', () => {
    db.venues.upsert({ id: 'test-venue-1', name: 'Renamed Bar', lat: 32.7765, lng: -79.9311 });
    expect(db.venues.getById('test-venue-1').name).toBe('Renamed Bar');
    expect(db.venues.count()).toBe(2);
  });

  test('getByArea filters correctly', () => {
    const dt = db.venues.getByArea('Downtown Charleston');
    expect(dt.length).toBe(1);
    expect(dt[0].name).toBe('Test Bar');
  });
});

describe('DAL: spots', () => {
  test('insert and retrieve spot', () => {
    const id = db.spots.insert({
      venue_id: 'test-venue-1',
      title: 'Happy Hour at Test Bar',
      type: 'Happy Hour',
      source: 'automated',
      status: 'approved',
      promotion_time: 'Mon-Fri 4-6pm',
    });
    expect(id).toBeGreaterThan(0);

    const spot = db.spots.getById(id);
    expect(spot.title).toBe('Happy Hour at Test Bar');
    expect(spot.promotion_time).toBe('Mon-Fri 4-6pm');
  });

  test('update spot fields', () => {
    const id = db.spots.insert({
      venue_id: 'test-venue-1', title: 'Test Spot', type: 'Happy Hour', source: 'manual',
    });
    const ok = db.spots.update(id, { title: 'Updated Spot', status: 'approved' });
    expect(ok).toBe(true);
    expect(db.spots.getById(id).title).toBe('Updated Spot');
  });

  test('delete spot', () => {
    const id = db.spots.insert({
      venue_id: 'test-venue-1', title: 'To Delete', type: 'Happy Hour', source: 'manual',
    });
    expect(db.spots.delete(id)).toBe(true);
    expect(db.spots.getById(id)).toBeUndefined();
  });

  test('delete returns false for missing spot', () => {
    expect(db.spots.delete(9999)).toBe(false);
  });

  test('deleteAutomated removes only automated non-override spots', () => {
    db.spots.insert({ venue_id: 'test-venue-1', title: 'Auto', type: 'HH', source: 'automated' });
    db.spots.insert({ venue_id: 'test-venue-2', title: 'Manual', type: 'HH', source: 'manual' });
    const deleted = db.spots.deleteAutomated();
    expect(deleted).toBe(1);
    expect(db.spots.count()).toBe(1);
    expect(db.spots.getAll()[0].source).toBe('manual');
  });

  test('getAll with visibleOnly filter', () => {
    db.spots.insert({ venue_id: 'test-venue-1', title: 'Visible', type: 'HH', source: 'automated', status: 'approved' });
    db.spots.insert({ venue_id: 'test-venue-2', title: 'Pending', type: 'HH', source: 'manual', status: 'pending' });
    const visible = db.spots.getAll({ visibleOnly: true });
    expect(visible.length).toBe(1);
    expect(visible[0].title).toBe('Visible');
  });
});

describe('DAL: gold', () => {
  test('upsert and get gold extraction', () => {
    db.gold.upsert({
      venue_id: 'test-venue-1',
      venue_name: 'Test Bar',
      promotions: { found: true, happyHour: { time: '4-6pm' } },
      source_hash: 'abc123',
    });
    const g = db.gold.get('test-venue-1');
    expect(g).toBeDefined();
    expect(g.source_hash).toBe('abc123');
    expect(JSON.parse(g.promotions).found).toBe(true);
  });

  test('upsert updates existing gold extraction', () => {
    db.gold.upsert({ venue_id: 'test-venue-1', promotions: { found: false }, source_hash: 'v1' });
    db.gold.upsert({ venue_id: 'test-venue-1', promotions: { found: true }, source_hash: 'v2' });
    expect(db.gold.count()).toBe(1);
    expect(db.gold.get('test-venue-1').source_hash).toBe('v2');
  });
});

describe('DAL: config', () => {
  test('get/set single values', () => {
    db.config.set('test_key', 'test_value');
    expect(db.config.get('test_key')).toBe('test_value');
  });

  test('loadConfig returns proper shape', () => {
    const cfg = db.config.loadConfig();
    expect(cfg).toHaveProperty('run_date');
    expect(cfg).toHaveProperty('last_run_status');
    expect(cfg).toHaveProperty('pipeline');
    expect(cfg.pipeline).toHaveProperty('maxIncrementalFiles');
  });

  test('saveConfig persists all fields', () => {
    db.config.saveConfig({
      run_date: '20260301',
      last_run_status: 'completed_successfully',
      pipeline: { maxIncrementalFiles: 100 },
    });
    const cfg = db.config.loadConfig();
    expect(cfg.run_date).toBe('20260301');
    expect(cfg.last_run_status).toBe('completed_successfully');
    expect(cfg.pipeline.maxIncrementalFiles).toBe(100);
  });
});

describe('DAL: watchlist', () => {
  test('upsert and retrieve', () => {
    db.watchlist.upsert({ venue_id: 'test-venue-1', name: 'Bad Bar', status: 'excluded', reason: 'test' });
    expect(db.watchlist.count()).toBe(1);
    expect(db.watchlist.getExcludedIds().has('test-venue-1')).toBe(true);
  });

  test('getFlaggedIds returns flagged venues', () => {
    db.watchlist.upsert({ venue_id: 'v1', name: 'Flagged', status: 'flagged' });
    db.watchlist.upsert({ venue_id: 'v2', name: 'Excluded', status: 'excluded' });
    expect(db.watchlist.getFlaggedIds().size).toBe(1);
    expect(db.watchlist.getExcludedIds().size).toBe(1);
  });
});

describe('DAL: areas', () => {
  test('getAll returns seeded areas', () => {
    const all = db.areas.getAll();
    expect(all.length).toBe(3);
  });

  test('getNames returns names only', () => {
    const names = db.areas.getNames();
    expect(names).toContain('Downtown Charleston');
    expect(names).toContain('Mount Pleasant');
  });
});

describe('DAL: streaks', () => {
  test('upsert and get streak', () => {
    db.streaks.upsert('test-venue-1', 'Happy Hour', 'Test Bar', '2026-02-11', 3);
    const s = db.streaks.get('test-venue-1', 'Happy Hour');
    expect(s).toBeDefined();
    expect(s.streak).toBe(3);
    expect(s.name).toBe('Test Bar');
  });

  test('getAll ordered by streak desc', () => {
    db.streaks.upsert('v1', 'HH', 'A', '2026-02-11', 5);
    db.streaks.upsert('v2', 'HH', 'B', '2026-02-11', 2);
    db.streaks.upsert('v3', 'HH', 'C', '2026-02-11', 8);
    const all = db.streaks.getAll();
    expect(all[0].streak).toBe(8);
    expect(all[2].streak).toBe(2);
  });
});

describe('DAL: pipelineRuns', () => {
  test('create and retrieve pipeline run', () => {
    const id = db.pipelineRuns.create({
      startedAt: '2026-02-11T10:00:00Z',
      status: 'running',
      runDate: '20260211',
      steps: { raw: 'pending', merged: 'pending' },
    });
    expect(id).toBeGreaterThan(0);

    const latest = db.pipelineRuns.latest();
    expect(latest).toBeDefined();
    expect(latest.status).toBe('running');
  });

  test('update pipeline run', () => {
    const id = db.pipelineRuns.create({ status: 'running', runDate: '20260211' });
    db.pipelineRuns.update(id, { status: 'completed', finishedAt: '2026-02-11T10:30:00Z' });
    const latest = db.pipelineRuns.latest();
    expect(latest.status).toBe('completed');
  });
});

describe('DAL: audit', () => {
  test('audit log records mutations', () => {
    db.spots.insert({ venue_id: 'test-venue-1', title: 'Audited', type: 'HH', source: 'manual' });
    const logs = db.audit.recent(10);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].table_name).toBe('spots');
    expect(logs[0].action).toBe('INSERT');
  });
});

describe('DAL: transaction', () => {
  test('transaction rolls back on error', () => {
    const before = db.venues.count();
    try {
      db.transaction(() => {
        db.venues.upsert({ id: 'txn-1', name: 'TXN', lat: 32.8, lng: -79.9 });
        throw new Error('rollback');
      });
    } catch { /* expected */ }
    expect(db.venues.count()).toBe(before);
  });
});
