/**
 * Spot DAL — CRUD and lifecycle management for the spots table.
 * Geo data (lat, lng, area) lives on venues; spots carry activity-specific data.
 * After every mutation that affects type or status, venue activity flags are synced.
 */

const { getDb, logAudit, syncActivityFlags, transaction } = require('./db-core');

function serializeJson(val) {
  if (!val) return null;
  return typeof val === 'string' ? val : JSON.stringify(val);
}

const spots = {
  getAll(filters) {
    let sql = 'SELECT * FROM spots';
    const params = [];
    const clauses = [];
    if (filters) {
      if (filters.source) { clauses.push('source = ?'); params.push(filters.source); }
      if (filters.type) { clauses.push('type = ?'); params.push(filters.type); }
      if (filters.venueId) { clauses.push('venue_id = ?'); params.push(filters.venueId); }
      if (filters.status) { clauses.push('status = ?'); params.push(filters.status); }
      if (filters.visibleOnly) {
        clauses.push("status != 'expired' AND (source = 'automated' OR status = 'approved' OR status IS NULL)");
      }
    }
    if (clauses.length > 0) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY id';
    return getDb().prepare(sql).all(...params);
  },

  getById(id) {
    return getDb().prepare('SELECT * FROM spots WHERE id = ?').get(id);
  },

  getByVenueAndType(venueId, type) {
    return getDb().prepare(
      'SELECT * FROM spots WHERE venue_id = ? AND type = ?',
    ).get(venueId, type);
  },

  insert(s) {
    const db = getDb();
    const venueId = s.venue_id || s.venueId || null;
    const params = {
      venue_id: venueId,
      title: s.title,
      type: s.type || 'Happy Hour',
      source: s.source || 'automated',
      status: s.status || 'approved',
      description: s.description || null,
      promotion_time: s.promotion_time || s.promotionTime || null,
      promotion_list: s.promotion_list || serializeJson(s.promotionList),
      time_start: s.time_start || s.timeStart || null,
      time_end: s.time_end || s.timeEnd || null,
      days: s.days || null,
      specific_date: s.specific_date || s.specificDate || null,
      source_url: s.source_url || s.sourceUrl || null,
      submitter_name: s.submitter_name || s.submitterName || null,
      manual_override: (s.manual_override || s.manualOverride) ? 1 : 0,
      photo_url: s.photo_url || s.photoUrl || null,
      last_update_date: s.last_update_date || s.lastUpdateDate || null,
      pending_edit: serializeJson(s.pending_edit || s.pendingEdit),
      pending_delete: (s.pending_delete || s.pendingDelete) ? 1 : 0,
      submitted_at: s.submitted_at || s.submittedAt || null,
      edited_at: s.edited_at || s.editedAt || null,
    };
    let newId;
    db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO spots (venue_id, title, type, source, status, description,
          promotion_time, promotion_list, time_start, time_end, days, specific_date,
          source_url, submitter_name, manual_override, photo_url, last_update_date,
          pending_edit, pending_delete, submitted_at, edited_at, updated_at)
        VALUES (@venue_id, @title, @type, @source, @status, @description,
          @promotion_time, @promotion_list, @time_start, @time_end, @days, @specific_date,
          @source_url, @submitter_name, @manual_override, @photo_url, @last_update_date,
          @pending_edit, @pending_delete, @submitted_at, @edited_at, datetime('now'))
      `).run(params);
      newId = Number(info.lastInsertRowid);
      logAudit('spots', newId, 'INSERT', null, { ...s, id: newId });
      syncActivityFlags(venueId);
    })();
    return newId;
  },

  update(id, fields, opts = {}) {
    const db = getDb();
    const existing = this.getById(id);
    if (!existing) return false;
    if (existing.manual_override && !opts.force) {
      const isManualEdit = fields.manual_override !== undefined || fields.manualOverride !== undefined;
      if (!isManualEdit) {
        console.warn(`[db-spots:update] WARNING: updating manual_override=1 spot #${id} without force=true`);
      }
    }
    const setClauses = [];
    const params = {};
    for (const [key, val] of Object.entries(fields)) {
      const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      setClauses.push(`${col} = @${col}`);
      params[col] = (val !== null && typeof val === 'object') ? JSON.stringify(val) : val;
    }
    setClauses.push("updated_at = datetime('now')");
    params.id = id;
    db.transaction(() => {
      db.prepare(`UPDATE spots SET ${setClauses.join(', ')} WHERE id = @id`).run(params);
      logAudit('spots', id, 'UPDATE', existing, fields);
      if (fields.type || fields.status) syncActivityFlags(existing.venue_id);
    })();
    return true;
  },

  delete(id) {
    const db = getDb();
    const existing = this.getById(id);
    if (!existing) return false;
    db.prepare('DELETE FROM spots WHERE id = ?').run(id);
    logAudit('spots', id, 'DELETE', existing, null);
    syncActivityFlags(existing.venue_id);
    return true;
  },

  upsertAutomated(s) {
    const venueId = s.venue_id || s.venueId || null;
    const type = s.type || 'Happy Hour';
    if (!venueId) return this.insert(s);

    const existing = getDb().prepare(
      "SELECT id, manual_override FROM spots WHERE venue_id = ? AND type = ? AND source = 'automated'",
    ).get(venueId, type);

    if (existing) {
      if (existing.manual_override) return existing.id;

      const db = getDb();
      const old = this.getById(existing.id);
      db.transaction(() => {
        db.prepare(`
          UPDATE spots SET title=@title, description=@description,
            promotion_time=@promotion_time, promotion_list=@promotion_list,
            time_start=@time_start, time_end=@time_end, days=@days,
            specific_date=@specific_date, source_url=@source_url,
            photo_url=COALESCE(@photo_url, photo_url),
            last_update_date=@last_update_date,
            status='approved', updated_at=datetime('now')
          WHERE id = @id
        `).run({
          id: existing.id,
          title: s.title,
          description: s.description || null,
          promotion_time: s.promotion_time || s.promotionTime || null,
          promotion_list: s.promotion_list || serializeJson(s.promotionList),
          time_start: s.time_start || s.timeStart || null,
          time_end: s.time_end || s.timeEnd || null,
          days: s.days || null,
          specific_date: s.specific_date || s.specificDate || null,
          source_url: s.source_url || s.sourceUrl || null,
          photo_url: s.photo_url || s.photoUrl || null,
          last_update_date: s.last_update_date || s.lastUpdateDate || null,
        });
        logAudit('spots', existing.id, 'UPDATE', old, s);
        syncActivityFlags(venueId);
      })();
      return existing.id;
    }
    return this.insert(s);
  },

  archiveStaleAutomated(types, activeKeys) {
    const db = getDb();
    if (!types || types.length === 0) return 0;
    const ph = types.map(() => '?').join(',');
    const guard = "AND (pending_edit IS NULL OR pending_edit = '') AND pending_delete = 0";
    const stale = db.prepare(
      `SELECT id, venue_id, type FROM spots WHERE source = 'automated' AND manual_override = 0 AND status = 'approved' ${guard} AND type IN (${ph})`,
    ).all(...types);
    const touched = new Set();
    let count = 0;
    for (const row of stale) {
      if (!activeKeys.has(`${row.venue_id}::${row.type}`)) {
        db.prepare("UPDATE spots SET status = 'expired', updated_at = datetime('now') WHERE id = ?").run(row.id);
        logAudit('spots', row.id, 'UPDATE', row, { status: 'expired' });
        if (row.venue_id) touched.add(row.venue_id);
        count++;
      }
    }
    for (const vid of touched) syncActivityFlags(vid);
    return count;
  },

  archiveByType(type, condition, params) {
    const db = getDb();
    const base = `type = ? AND source = 'automated' AND status = 'approved' AND manual_override = 0 AND ${condition}`;
    const cnt = db.prepare(`SELECT COUNT(*) as cnt FROM spots WHERE ${base}`).get(type, ...params).cnt;
    if (cnt > 0) {
      const rows = db.prepare(`SELECT DISTINCT venue_id FROM spots WHERE ${base}`).all(type, ...params);
      db.prepare(`UPDATE spots SET status = 'expired', updated_at = datetime('now') WHERE ${base}`).run(type, ...params);
      for (const r of rows) { if (r.venue_id) syncActivityFlags(r.venue_id); }
    }
    return cnt;
  },

  deleteAutomated(types) {
    if (!types || types.length === 0) {
      throw new Error('deleteAutomated requires explicit types');
    }
    const db = getDb();
    const guard = "AND (pending_edit IS NULL OR pending_edit = '') AND pending_delete = 0";
    const ph = types.map(() => '?').join(',');
    const where = `source = 'automated' AND manual_override = 0 ${guard} AND type IN (${ph})`;
    const rows = db.prepare(`SELECT DISTINCT venue_id FROM spots WHERE ${where}`).all(...types);
    const cnt = db.prepare(`SELECT COUNT(*) as cnt FROM spots WHERE ${where}`).get(...types).cnt;
    db.prepare(`DELETE FROM spots WHERE ${where}`).run(...types);
    for (const r of rows) { if (r.venue_id) syncActivityFlags(r.venue_id); }
    return cnt;
  },

  getPendingActionSpots() {
    return getDb().prepare(
      "SELECT * FROM spots WHERE (pending_edit IS NOT NULL AND pending_edit != '') OR pending_delete = 1",
    ).all();
  },

  maxId() {
    return getDb().prepare('SELECT MAX(id) as max_id FROM spots').get().max_id || 0;
  },

  count() {
    return getDb().prepare('SELECT COUNT(*) as cnt FROM spots').get().cnt;
  },
};

module.exports = spots;
