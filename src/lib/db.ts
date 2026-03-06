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

/* eslint-disable @typescript-eslint/no-explicit-any -- better-sqlite3 returns untyped row objects */

let _db: Database.Database | null = null;
let _auditContext = { changeSource: 'admin', scriptName: 'api' };

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
      description TEXT, promotion_time TEXT, promotion_list TEXT,
      time_start TEXT, time_end TEXT, days TEXT, specific_date TEXT,
      source_url TEXT,
      submitter_name TEXT, manual_override INTEGER DEFAULT 0, photo_url TEXT,
      last_update_date TEXT, pending_edit TEXT, pending_delete INTEGER DEFAULT 0,
      submitted_at TEXT, edited_at TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
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
      action TEXT, change_source TEXT DEFAULT 'unknown', script_name TEXT,
      old_data TEXT, new_data TEXT,
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

  const actCols = db.prepare("PRAGMA table_info(activities)").all() as { name: string }[];
  const actColNames = new Set(actCols.map(c => c.name));
  if (!actColNames.has('hidden')) db.prepare("ALTER TABLE activities ADD COLUMN hidden INTEGER DEFAULT 0").run();
  if (!actColNames.has('venue_required')) db.prepare("ALTER TABLE activities ADD COLUMN venue_required INTEGER DEFAULT 1").run();

  if (!spotColNames.has('finding_approved')) db.prepare("ALTER TABLE spots ADD COLUMN finding_approved INTEGER DEFAULT 0").run();
  if (!spotColNames.has('finding_rationale')) db.prepare("ALTER TABLE spots ADD COLUMN finding_rationale TEXT").run();
  if (!spotColNames.has('time_start')) db.prepare("ALTER TABLE spots ADD COLUMN time_start TEXT").run();
  if (!spotColNames.has('time_end')) db.prepare("ALTER TABLE spots ADD COLUMN time_end TEXT").run();
  if (!spotColNames.has('days')) db.prepare("ALTER TABLE spots ADD COLUMN days TEXT").run();
  if (!spotColNames.has('specific_date')) db.prepare("ALTER TABLE spots ADD COLUMN specific_date TEXT").run();

  const venueCols = db.prepare("PRAGMA table_info(venues)").all() as { name: string }[];
  const venueColNames = new Set(venueCols.map(c => c.name));
  if (!venueColNames.has('phone')) db.prepare("ALTER TABLE venues ADD COLUMN phone TEXT").run();
  if (!venueColNames.has('submitter_name')) db.prepare("ALTER TABLE venues ADD COLUMN submitter_name TEXT").run();
  if (!venueColNames.has('venue_added_at')) db.prepare("ALTER TABLE venues ADD COLUMN venue_added_at TEXT DEFAULT '2001-01-01'").run();
  if (!venueColNames.has('venue_status')) db.prepare("ALTER TABLE venues ADD COLUMN venue_status TEXT DEFAULT 'active'").run();
  if (!venueColNames.has('expected_open_date')) db.prepare("ALTER TABLE venues ADD COLUMN expected_open_date TEXT").run();
  if (!venueColNames.has('google_place_id')) db.prepare("ALTER TABLE venues ADD COLUMN google_place_id TEXT").run();
  const flagCols = ['is_happy_hour', 'is_brunch', 'is_live_music', 'is_rooftop_bar',
    'is_coffee_shop', 'is_landmark', 'is_dog_friendly', 'is_waterfront'];
  for (const col of flagCols) {
    if (!venueColNames.has(col)) db.prepare(`ALTER TABLE venues ADD COLUMN ${col} INTEGER DEFAULT 0`).run();
  }

  // Audit log columns
  const auditCols = db.prepare("PRAGMA table_info(audit_log)").all() as { name: string }[];
  const auditColNames = new Set(auditCols.map(c => c.name));
  if (!auditColNames.has('change_source')) {
    try { db.prepare("ALTER TABLE audit_log ADD COLUMN change_source TEXT DEFAULT 'unknown'").run(); } catch { /* already exists */ }
  }
  if (!auditColNames.has('script_name')) {
    try { db.prepare("ALTER TABLE audit_log ADD COLUMN script_name TEXT").run(); } catch { /* already exists */ }
  }

  db.prepare("CREATE INDEX IF NOT EXISTS idx_spots_source_status ON spots(source, status)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_spots_type ON spots(type)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_spots_venue_type ON spots(venue_id, type)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_venues_area ON venues(area)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_venues_status ON venues(venue_status)").run();
}

// ── Activity flag sync ──────────────────────────────────────────

const ACTIVITY_FLAG_MAP: Record<string, string> = {
  'Happy Hour': 'is_happy_hour',
  'Brunch': 'is_brunch',
  'Live Music': 'is_live_music',
  'Rooftop Bar': 'is_rooftop_bar',
  'Coffee Shop': 'is_coffee_shop',
  'Landmarks & Attractions': 'is_landmark',
  'Dog Friendly': 'is_dog_friendly',
  'Waterfront Dining': 'is_waterfront',
};

function syncActivityFlags(venueId: string | null) {
  if (!venueId) return;
  try {
    const setClauses = Object.entries(ACTIVITY_FLAG_MAP).map(
      ([type, col]) =>
        `${col} = (SELECT COUNT(*) > 0 FROM spots WHERE venue_id = @vid AND type = '${type}' AND status = 'approved')`,
    );
    getDb().prepare(`
      UPDATE venues SET ${setClauses.join(', ')}, updated_at = datetime('now')
      WHERE id = @vid
    `).run({ vid: venueId });
  } catch {
    // Flag columns may not exist pre-migration
  }
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
  time_start: string | null;
  time_end: string | null;
  days: string | null;
  specific_date: string | null;
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
}

export interface VenueRow {
  id: string;
  google_place_id: string | null;
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
  submitter_name: string | null;
  venue_added_at: string;
  venue_status: string;
  expected_open_date: string | null;
  is_happy_hour: number;
  is_brunch: number;
  is_live_music: number;
  is_rooftop_bar: number;
  is_coffee_shop: number;
  is_landmark: number;
  is_dog_friendly: number;
  is_waterfront: number;
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
  venue_required: number;
}

// ── Venues ──────────────────────────────────────────────────────

const VENUE_ALLOWED_COLUMNS = new Set([
  'name', 'address', 'lat', 'lng', 'area', 'website', 'photo_url',
  'types', 'raw_google_data', 'operating_hours', 'hours_source',
  'hours_updated_at', 'phone', 'submitter_name', 'venue_added_at',
  'venue_status', 'expected_open_date', 'google_place_id',
  'is_happy_hour', 'is_brunch', 'is_live_music', 'is_rooftop_bar',
  'is_coffee_shop', 'is_landmark', 'is_dog_friendly', 'is_waterfront',
]);

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

  search(query: string, limit = 50): VenueRow[] {
    const term = `%${query.toLowerCase()}%`;
    return getDb().prepare(
      'SELECT * FROM venues WHERE LOWER(name) LIKE ? ORDER BY name LIMIT ?'
    ).all(term, limit) as VenueRow[];
  },

  getByStatus(status: string): VenueRow[] {
    return getDb().prepare(
      'SELECT * FROM venues WHERE venue_status = ? ORDER BY name',
    ).all(status) as VenueRow[];
  },

  upsert(v: Record<string, any>): void {
    const db = getDb();
    const existing = this.getById(v.id);
    db.transaction(() => {
      db.prepare(`
        INSERT INTO venues (id, name, address, lat, lng, area, website, photo_url,
          venue_added_at, venue_status, google_place_id, updated_at)
        VALUES (@id, @name, @address, @lat, @lng, @area, @website, @photo_url,
          @venue_added_at, @venue_status, @google_place_id, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          name=COALESCE(@name, name), address=COALESCE(@address, address),
          lat=COALESCE(@lat, lat), lng=COALESCE(@lng, lng),
          area=COALESCE(@area, area), website=COALESCE(@website, website),
          photo_url=COALESCE(@photo_url, photo_url),
          venue_status=COALESCE(@venue_status, venue_status),
          google_place_id=COALESCE(@google_place_id, google_place_id),
          updated_at=datetime('now')
      `).run({
        id: v.id,
        name: v.name || null,
        address: v.address || null,
        lat: v.lat ?? null,
        lng: v.lng ?? null,
        area: v.area || null,
        website: v.website || null,
        photo_url: v.photoUrl || v.photo_url || null,
        venue_added_at: v.venue_added_at || new Date().toISOString().slice(0, 10),
        venue_status: v.venue_status || null,
        google_place_id: v.google_place_id || v.googlePlaceId || null,
      });
      logAudit('venues', v.id, existing ? 'UPDATE' : 'INSERT', existing, v);
    })();
  },

  update(id: string, fields: Record<string, unknown>): boolean {
    const db = getDb();
    const existing = this.getById(id);
    if (!existing) return false;
    const sets: string[] = [];
    const params: Record<string, unknown> = { id };
    for (const [key, val] of Object.entries(fields)) {
      const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (!VENUE_ALLOWED_COLUMNS.has(col)) continue;
      sets.push(`${col} = @${col}`);
      params[col] = (val !== null && typeof val === 'object') ? JSON.stringify(val) : val;
    }
    if (sets.length === 0) return false;
    sets.push("updated_at = datetime('now')");
    db.transaction(() => {
      db.prepare(`UPDATE venues SET ${sets.join(', ')} WHERE id = @id`).run(params);
      logAudit('venues', id, 'UPDATE', existing, fields);
    })();
    return true;
  },

  updatePhotoUrl(id: string, photoUrl: string): void {
    this.update(id, { photo_url: photoUrl });
  },

  updateStatus(id: string, status: string, expectedOpenDate?: string): void {
    const fields: Record<string, unknown> = { venue_status: status };
    if (expectedOpenDate !== undefined) fields.expected_open_date = expectedOpenDate;
    if (status === 'recently_opened') fields.venue_added_at = new Date().toISOString().slice(0, 10);
    this.update(id, fields);
  },

  generateId(): string {
    return generateVenueId();
  },
};

// ── Spots ───────────────────────────────────────────────────────

const SPOT_ALLOWED_COLUMNS = new Set([
  'title', 'description', 'type', 'source', 'status',
  'promotion_time', 'promotion_list', 'source_url',
  'time_start', 'time_end', 'days', 'specific_date',
  'submitter_name', 'manual_override', 'photo_url',
  'last_update_date', 'pending_edit', 'pending_delete',
  'submitted_at', 'edited_at', 'venue_id',
  'finding_approved', 'finding_rationale',
]);

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
    const db = getDb();
    const venueId = s.venueId || s.venue_id || null;
    let newId: number;
    db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO spots (venue_id, title, type, source, status, description,
          promotion_time, promotion_list, time_start, time_end, days, specific_date,
          source_url, submitter_name,
          manual_override, photo_url, last_update_date, pending_edit,
          pending_delete, submitted_at, edited_at, updated_at)
        VALUES (@venue_id, @title, @type, @source, @status, @description,
          @promotion_time, @promotion_list, @time_start, @time_end, @days, @specific_date,
          @source_url, @submitter_name,
          @manual_override, @photo_url, @last_update_date, @pending_edit,
          @pending_delete, @submitted_at, @edited_at, datetime('now'))
      `).run({
        venue_id: venueId,
        title: s.title,
        type: s.type || 'Happy Hour',
        source: s.source || 'manual',
        status: s.status || 'pending',
        description: s.description || null,
        promotion_time: s.promotionTime || s.promotion_time || null,
        promotion_list: s.promotionList ? JSON.stringify(s.promotionList) : (s.promotion_list || null),
        time_start: s.timeStart || s.time_start || null,
        time_end: s.timeEnd || s.time_end || null,
        days: s.days || null,
        specific_date: s.specificDate || s.specific_date || null,
        source_url: s.sourceUrl || s.source_url || null,
        submitter_name: s.submitterName || s.submitter_name || null,
        manual_override: s.manualOverride ? 1 : 0,
        photo_url: s.photoUrl || s.photo_url || null,
        last_update_date: s.lastUpdateDate || s.last_update_date || null,
        pending_edit: null,
        pending_delete: 0,
        submitted_at: s.submittedAt || new Date().toISOString(),
        edited_at: null,
      });
      newId = Number(info.lastInsertRowid);
      logAudit('spots', newId, 'INSERT', null, { ...s, id: newId });
      syncActivityFlags(venueId);
    })();
    return newId!;
  },

  update(id: number, fields: Record<string, any>): boolean {
    const db = getDb();
    const existing = this.getById(id);
    if (!existing) return false;

    const setClauses: string[] = [];
    const params: Record<string, any> = { id };
    for (const [key, val] of Object.entries(fields)) {
      const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (!SPOT_ALLOWED_COLUMNS.has(col)) continue;
      setClauses.push(`${col} = @${col}`);
      if (val !== null && typeof val === 'object') {
        params[col] = JSON.stringify(val);
      } else {
        params[col] = val;
      }
    }
    if (setClauses.length === 0) return false;
    setClauses.push("updated_at = datetime('now')");
    db.transaction(() => {
      db.prepare(`UPDATE spots SET ${setClauses.join(', ')} WHERE id = @id`).run(params);
      logAudit('spots', id, 'UPDATE', existing, fields);
      if (fields.type || fields.status) syncActivityFlags(existing.venue_id);
    })();
    return true;
  },

  delete(id: number): boolean {
    const db = getDb();
    const existing = this.getById(id);
    if (!existing) return false;
    db.transaction(() => {
      db.prepare('DELETE FROM spots WHERE id = ?').run(id);
      logAudit('spots', id, 'DELETE', existing, null);
      syncActivityFlags(existing.venue_id);
    })();
    return true;
  },

  existsForVenue(venueId: string, type: string): boolean {
    const row = getDb().prepare(
      "SELECT 1 FROM spots WHERE venue_id = ? AND type = ? AND status IN ('approved', 'pending') LIMIT 1"
    ).get(venueId, type);
    return !!row;
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

// ── Venue ID generation ─────────────────────────────────────────

function generateVenueId(): string {
  const row = getDb().prepare(
    "SELECT MAX(CAST(SUBSTR(id, 5) AS INTEGER)) as m FROM venues WHERE id LIKE 'ven_%'",
  ).get() as { m: number | null } | undefined;
  const next = (row?.m || 0) + 1;
  return `ven_${next}`;
}

// ── Audit ───────────────────────────────────────────────────────
function logAudit(tableName: string, rowId: number | string, action: string, oldData: any, newData: any) {
  try {
    getDb().prepare(
      `INSERT INTO audit_log (table_name, row_id, action, change_source, script_name, old_data, new_data)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      tableName,
      String(rowId),
      action,
      _auditContext.changeSource,
      _auditContext.scriptName,
      oldData ? JSON.stringify(oldData) : null,
      newData ? JSON.stringify(newData) : null
    );
  } catch {
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
}

function setAuditContext(changeSource: string, scriptName: string) {
  _auditContext = { changeSource, scriptName };
}

export { getDb, getDbPath, setAuditContext, generateVenueId, syncActivityFlags };
