/**
 * Database access layer for Next.js API routes.
 * Thin TypeScript wrapper around better-sqlite3.
 *
 * Uses the same database file as the ETL scripts:
 *   DB_PATH env var → default: <project>/data/chs-spots.db
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

/* eslint-disable @typescript-eslint/no-explicit-any */

let _db: Database.Database | null = null;

function getDbPath(): string {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  const dataRoot = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
  return path.join(dataRoot, 'chs-spots.db');
}

function getDb(): Database.Database {
  if (_db) return _db;
  const dbPath = getDbPath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  runMigrations(_db);
  return _db;
}

function ensureCoreTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS spots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venue_id TEXT, title TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'Happy Hour',
      source TEXT NOT NULL DEFAULT 'manual', status TEXT NOT NULL DEFAULT 'approved',
      description TEXT, promotion_time TEXT, promotion_list TEXT, source_url TEXT,
      submitter_name TEXT, manual_override INTEGER DEFAULT 0, photo_url TEXT,
      last_update_date TEXT, pending_edit TEXT, pending_delete INTEGER DEFAULT 0,
      submitted_at TEXT, edited_at TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
      lat REAL, lng REAL, area TEXT
    );
    CREATE TABLE IF NOT EXISTS venues (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, lat REAL, lng REAL,
      address TEXT, website TEXT, area TEXT, photo_url TEXT, place_id TEXT,
      operating_hours TEXT, phone TEXT, created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS areas (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
      lat REAL, lng REAL, zoom INTEGER DEFAULT 14,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
      icon TEXT, emoji TEXT, color TEXT, community_driven INTEGER DEFAULT 0,
      hidden INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, table_name TEXT, row_id TEXT,
      action TEXT, old_data TEXT, new_data TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS ideas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT DEFAULT (datetime('now')),
      resolved_at TEXT
    );
  `);
}

function runMigrations(db: Database.Database) {
  ensureCoreTables(db);

  const spotCols = db.prepare("PRAGMA table_info(spots)").all() as { name: string }[];
  const spotColNames = new Set(spotCols.map(c => c.name));
  if (!spotColNames.has('lat')) db.prepare("ALTER TABLE spots ADD COLUMN lat REAL").run();
  if (!spotColNames.has('lng')) db.prepare("ALTER TABLE spots ADD COLUMN lng REAL").run();
  if (!spotColNames.has('area')) db.prepare("ALTER TABLE spots ADD COLUMN area TEXT").run();

  const actCols = db.prepare("PRAGMA table_info(activities)").all() as { name: string }[];
  const actColNames = new Set(actCols.map(c => c.name));
  if (!actColNames.has('hidden')) db.prepare("ALTER TABLE activities ADD COLUMN hidden INTEGER DEFAULT 0").run();

  const venueCols = db.prepare("PRAGMA table_info(venues)").all() as { name: string }[];
  const venueColNames = new Set(venueCols.map(c => c.name));
  if (!venueColNames.has('phone')) db.prepare("ALTER TABLE venues ADD COLUMN phone TEXT").run();

  db.prepare("CREATE INDEX IF NOT EXISTS idx_spots_source_status ON spots(source, status)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_spots_type ON spots(type)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_venues_area ON venues(area)").run();
}

// ── Spot type for API responses ─────────────────────────────────
export interface SpotRow {
  id: number;
  venue_id: string | null;
  title: string;
  type: string;
  source: string;
  status: string;
  description: string | null;
  promotion_time: string | null;
  promotion_list: string | null;
  source_url: string | null;
  submitter_name: string | null;
  manual_override: number;
  photo_url: string | null;
  last_update_date: string | null;
  pending_edit: string | null;
  pending_delete: number;
  submitted_at: string | null;
  edited_at: string | null;
  created_at: string;
  updated_at: string;
  lat: number | null;
  lng: number | null;
  area: string | null;
}

export interface VenueRow {
  id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  area: string | null;
  website: string | null;
  phone: string | null;
  photo_url: string | null;
  types: string | null;
  raw_google_data: string | null;
  operating_hours: string | null;
  hours_source: string | null;
  hours_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AreaRow {
  name: string;
  display_name: string | null;
  description: string | null;
  center_lat: number | null;
  center_lng: number | null;
  radius_meters: number | null;
  bounds: string | null;
  zip_codes: string | null;
  created_at: string;
}

export interface ActivityRow {
  name: string;
  icon: string | null;
  emoji: string | null;
  color: string | null;
  community_driven: number;
  hidden: number;
}

// ── Venues ──────────────────────────────────────────────────────
export const venues = {
  getAll(): VenueRow[] {
    return getDb().prepare('SELECT * FROM venues ORDER BY name').all() as VenueRow[];
  },

  getById(id: string): VenueRow | undefined {
    return getDb().prepare('SELECT * FROM venues WHERE id = ?').get(id) as VenueRow | undefined;
  },

  getByArea(area: string): VenueRow[] {
    return getDb().prepare('SELECT * FROM venues WHERE LOWER(area) LIKE ? ORDER BY name')
      .all(`%${area.toLowerCase()}%`) as VenueRow[];
  },
};

// ── Spots ───────────────────────────────────────────────────────
export const spots = {
  count(): number {
    return (getDb().prepare('SELECT COUNT(*) as cnt FROM spots').get() as { cnt: number }).cnt;
  },

  getAll(opts?: { visibleOnly?: boolean }): SpotRow[] {
    if (opts?.visibleOnly) {
      return getDb().prepare(
        "SELECT * FROM spots WHERE status != 'expired' AND (source = 'automated' OR status = 'approved' OR status IS NULL) ORDER BY id",
      ).all() as SpotRow[];
    }
    return getDb().prepare('SELECT * FROM spots ORDER BY id').all() as SpotRow[];
  },

  getById(id: number): SpotRow | undefined {
    return getDb().prepare('SELECT * FROM spots WHERE id = ?').get(id) as SpotRow | undefined;
  },

  insert(s: Record<string, any>): number {
    const info = getDb().prepare(`
      INSERT INTO spots (venue_id, title, type, source, status, description,
        promotion_time, promotion_list, source_url, submitter_name,
        manual_override, photo_url, last_update_date, pending_edit,
        pending_delete, submitted_at, edited_at, lat, lng, area, updated_at)
      VALUES (@venue_id, @title, @type, @source, @status, @description,
        @promotion_time, @promotion_list, @source_url, @submitter_name,
        @manual_override, @photo_url, @last_update_date, @pending_edit,
        @pending_delete, @submitted_at, @edited_at, @lat, @lng, @area, datetime('now'))
    `).run({
      venue_id: s.venueId || s.venue_id || null,
      title: s.title,
      type: s.type || 'Happy Hour',
      source: s.source || 'manual',
      status: s.status || 'pending',
      description: s.description || null,
      promotion_time: s.promotionTime || s.promotion_time || null,
      promotion_list: s.promotionList ? JSON.stringify(s.promotionList) : (s.promotion_list || null),
      source_url: s.sourceUrl || s.source_url || null,
      submitter_name: s.submitterName || s.submitter_name || null,
      manual_override: s.manualOverride ? 1 : 0,
      photo_url: s.photoUrl || s.photo_url || null,
      last_update_date: s.lastUpdateDate || s.last_update_date || null,
      pending_edit: null,
      pending_delete: 0,
      submitted_at: s.submittedAt || new Date().toISOString(),
      edited_at: null,
      lat: s.lat ?? null,
      lng: s.lng ?? null,
      area: s.area ?? null,
    });
    logAudit('spots', Number(info.lastInsertRowid), 'INSERT', null, s);
    return Number(info.lastInsertRowid);
  },

  update(id: number, fields: Record<string, any>): boolean {
    const existing = this.getById(id);
    if (!existing) return false;

    const ALLOWED_COLUMNS = new Set([
      'title', 'description', 'type', 'source', 'status',
      'promotion_time', 'promotion_list', 'source_url',
      'submitter_name', 'manual_override', 'photo_url',
      'last_update_date', 'pending_edit', 'pending_delete',
      'submitted_at', 'edited_at', 'lat', 'lng', 'area', 'venue_id',
    ]);

    const setClauses: string[] = [];
    const params: Record<string, any> = { id };
    for (const [key, val] of Object.entries(fields)) {
      const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (!ALLOWED_COLUMNS.has(col)) continue;
      setClauses.push(`${col} = @${col}`);
      if (val !== null && typeof val === 'object') {
        params[col] = JSON.stringify(val);
      } else {
        params[col] = val;
      }
    }
    if (setClauses.length === 0) return false;
    setClauses.push("updated_at = datetime('now')");
    getDb().prepare(`UPDATE spots SET ${setClauses.join(', ')} WHERE id = @id`).run(params);
    logAudit('spots', id, 'UPDATE', existing, fields);
    return true;
  },

  delete(id: number): boolean {
    const existing = this.getById(id);
    if (!existing) return false;
    getDb().prepare('DELETE FROM spots WHERE id = ?').run(id);
    logAudit('spots', id, 'DELETE', existing, null);
    return true;
  },
};

// ── Areas ───────────────────────────────────────────────────────
export const areasDb = {
  getAll(): AreaRow[] {
    return getDb().prepare('SELECT * FROM areas ORDER BY name').all() as AreaRow[];
  },

  getNames(): string[] {
    return (getDb().prepare('SELECT name FROM areas ORDER BY name').all() as { name: string }[]).map(r => r.name);
  },
};

// ── Activities ──────────────────────────────────────────────────
export const activitiesDb = {
  getAll(): ActivityRow[] {
    return getDb().prepare('SELECT * FROM activities ORDER BY name').all() as ActivityRow[];
  },
};

// ── Ideas (backlog) ─────────────────────────────────────────────
export interface IdeaRow {
  id: number;
  text: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
}

export const ideas = {
  add(text: string): IdeaRow {
    const stmt = getDb().prepare('INSERT INTO ideas (text) VALUES (?)');
    const result = stmt.run(text);
    return getDb().prepare('SELECT * FROM ideas WHERE id = ?').get(result.lastInsertRowid) as IdeaRow;
  },

  getOpen(): IdeaRow[] {
    return getDb().prepare("SELECT * FROM ideas WHERE status = 'open' ORDER BY created_at ASC").all() as IdeaRow[];
  },

  getAll(): IdeaRow[] {
    return getDb().prepare('SELECT * FROM ideas ORDER BY created_at DESC').all() as IdeaRow[];
  },

  resolve(id: number): boolean {
    const result = getDb().prepare("UPDATE ideas SET status = 'resolved', resolved_at = datetime('now') WHERE id = ?").run(id);
    return result.changes > 0;
  },

  setStatus(id: number, status: string): boolean {
    const result = getDb().prepare('UPDATE ideas SET status = ? WHERE id = ?').run(status, id);
    return result.changes > 0;
  },
};

// ── Audit ───────────────────────────────────────────────────────
function logAudit(tableName: string, rowId: number | string, action: string, oldData: any, newData: any) {
  try {
    getDb().prepare(
      `INSERT INTO audit_log (table_name, row_id, action, old_data, new_data)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      tableName,
      String(rowId),
      action,
      oldData ? JSON.stringify(oldData) : null,
      newData ? JSON.stringify(newData) : null
    );
  } catch (err) {
    console.warn('Audit log write failed:', err);
  }
}

export { getDb, getDbPath };
