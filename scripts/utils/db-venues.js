/**
 * Venue DAL — CRUD and status management for the venues table.
 * Every write method logs to audit_log via logAudit.
 */

const { getDb, logAudit, generateVenueId, transaction } = require('./db-core');

const ALLOWED_COLUMNS = new Set([
  'name', 'address', 'lat', 'lng', 'area', 'website', 'photo_url',
  'types', 'raw_google_data', 'operating_hours', 'hours_source',
  'hours_updated_at', 'phone', 'submitter_name', 'venue_added_at',
  'venue_status', 'expected_open_date', 'google_place_id',
  'is_happy_hour', 'is_brunch', 'is_live_music', 'is_rooftop_bar',
  'is_coffee_shop', 'is_landmark', 'is_dog_friendly', 'is_waterfront',
]);

const venues = {
  getAll() {
    return getDb().prepare('SELECT * FROM venues ORDER BY name').all();
  },

  getById(id) {
    return getDb().prepare('SELECT * FROM venues WHERE id = ?').get(id);
  },

  getByArea(area) {
    return getDb().prepare('SELECT * FROM venues WHERE area = ? ORDER BY name').all(area);
  },

  getByStatus(status) {
    return getDb().prepare(
      'SELECT * FROM venues WHERE venue_status = ? ORDER BY name',
    ).all(status);
  },

  getByGooglePlaceId(placeId) {
    return getDb().prepare(
      'SELECT * FROM venues WHERE google_place_id = ?',
    ).get(placeId);
  },

  upsert(v) {
    const db = getDb();
    const existing = this.getById(v.id);
    const addedAt = v.venue_added_at
      || (existing ? undefined : new Date().toISOString().slice(0, 10));
    db.transaction(() => {
      db.prepare(`
        INSERT INTO venues (id, name, address, lat, lng, area, website, photo_url, types,
          raw_google_data, venue_added_at, venue_status, submitter_name, google_place_id, updated_at)
        VALUES (@id, @name, @address, @lat, @lng, @area, @website, @photo_url, @types,
          @raw_google_data, @venue_added_at, @venue_status, @submitter_name, @google_place_id, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          name=@name, address=COALESCE(@address, address), lat=@lat, lng=@lng,
          area=COALESCE(@area, area),
          website=COALESCE(@website, website),
          photo_url=COALESCE(@photo_url, photo_url),
          types=@types, raw_google_data=@raw_google_data,
          venue_status=COALESCE(@venue_status, venue_status),
          google_place_id=COALESCE(@google_place_id, google_place_id),
          updated_at=datetime('now')
      `).run({
        id: v.id,
        name: v.name,
        address: v.address || null,
        lat: v.lat,
        lng: v.lng,
        area: v.area || null,
        website: v.website || null,
        photo_url: v.photo_url || v.photoUrl || null,
        types: v.types
          ? (typeof v.types === 'string' ? v.types : JSON.stringify(v.types))
          : null,
        raw_google_data: v.raw_google_data
          ? (typeof v.raw_google_data === 'string' ? v.raw_google_data : JSON.stringify(v.raw_google_data))
          : null,
        venue_added_at: addedAt || null,
        venue_status: v.venue_status || 'active',
        submitter_name: v.submitter_name || v.submitterName || null,
        google_place_id: v.google_place_id || v.googlePlaceId || null,
      });
      logAudit('venues', v.id, existing ? 'UPDATE' : 'INSERT', existing, v);
    })();
  },

  update(id, fields) {
    const db = getDb();
    const existing = this.getById(id);
    if (!existing) return false;
    const setClauses = [];
    const params = {};
    for (const [key, val] of Object.entries(fields)) {
      const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (!ALLOWED_COLUMNS.has(col)) continue;
      setClauses.push(`${col} = @${col}`);
      params[col] = (val !== null && typeof val === 'object') ? JSON.stringify(val) : val;
    }
    if (setClauses.length === 0) return false;
    setClauses.push("updated_at = datetime('now')");
    params.id = id;
    db.prepare(`UPDATE venues SET ${setClauses.join(', ')} WHERE id = @id`).run(params);
    logAudit('venues', id, 'UPDATE', existing, fields);
    return true;
  },

  updatePhotoUrl(id, photoUrl) {
    const existing = this.getById(id);
    getDb().prepare(
      "UPDATE venues SET photo_url = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(photoUrl, id);
    logAudit('venues', id, 'UPDATE', existing, { photo_url: photoUrl });
  },

  updateStatus(id, status, expectedOpenDate) {
    const existing = this.getById(id);
    const params = { id, status };
    let sql = "UPDATE venues SET venue_status = @status, updated_at = datetime('now')";
    if (expectedOpenDate !== undefined) {
      sql += ', expected_open_date = @expected_open_date';
      params.expected_open_date = expectedOpenDate;
    }
    if (status === 'recently_opened') {
      sql += ", venue_added_at = date('now')";
    }
    sql += ' WHERE id = @id';
    getDb().prepare(sql).run(params);
    logAudit('venues', id, 'UPDATE', existing, { venue_status: status, expected_open_date: expectedOpenDate });
  },

  count() {
    return getDb().prepare('SELECT COUNT(*) as cnt FROM venues').get().cnt;
  },

  generateId() {
    return generateVenueId();
  },
};

module.exports = venues;
