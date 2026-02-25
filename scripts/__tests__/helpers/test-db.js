/**
 * Test helper: sets up a temporary SQLite database for test isolation.
 *
 * Usage:
 *   const { setupTestDb, teardownTestDb } = require('./helpers/test-db');
 *   beforeEach(() => setupTestDb());
 *   afterEach(() => teardownTestDb());
 *
 * Seeds a minimal set of test data (venues, areas, activities, config).
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

let tmpDir = null;

function setupTestDb(opts = {}) {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chs-test-'));
  const dbPath = path.join(tmpDir, 'test.db');
  process.env.DB_PATH = dbPath;

  // Clear any cached DB connections
  delete require.cache[require.resolve('../../utils/db')];
  const db = require('../../utils/db');
  db.ensureSchema();

  if (opts.seed !== false) {
    seedTestData(db);
  }

  return { dbPath, tmpDir, db };
}

function teardownTestDb() {
  try {
    delete require.cache[require.resolve('../../utils/db')];
    const db = require('../../utils/db');
    db.closeDb();
  } catch { /* ignore */ }

  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  tmpDir = null;
  delete process.env.DB_PATH;
}

function seedTestData(db) {
  db.areas.upsert({ name: 'Downtown Charleston', displayName: 'Downtown Charleston' });
  db.areas.upsert({ name: 'Mount Pleasant', displayName: 'Mount Pleasant' });
  db.areas.upsert({ name: 'West Ashley', displayName: 'West Ashley' });

  db.activities.upsert({ name: 'Happy Hour', icon: 'Martini', emoji: '🍹', color: '#0d9488' });
  db.activities.upsert({ name: 'Brunch', icon: 'Coffee', emoji: '🥞', color: '#d97706' });

  db.venues.upsert({
    id: 'test-venue-1',
    name: 'Test Bar',
    address: '123 Main St',
    lat: 32.7765,
    lng: -79.9311,
    area: 'Downtown Charleston',
    website: 'https://testbar.com',
  });

  db.venues.upsert({
    id: 'test-venue-2',
    name: 'Test Grill',
    address: '456 Oak Ave',
    lat: 32.8468,
    lng: -79.8281,
    area: 'Mount Pleasant',
    website: 'https://testgrill.com',
  });

  db.config.set('run_date', '20260211');
  db.config.set('last_run_status', 'idle');
}

module.exports = { setupTestDb, teardownTestDb };
