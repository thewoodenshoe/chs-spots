/**
 * Supporting DAL — gold extractions, areas, activities, watchlist, confidence reviews.
 */

const { getDb, logAudit } = require('./db-core');

const gold = {
  get(venueId) {
    return getDb().prepare('SELECT * FROM gold_extractions WHERE venue_id = ?').get(venueId);
  },
  getAll() {
    return getDb().prepare('SELECT * FROM gold_extractions ORDER BY venue_id').all();
  },
  upsert(g) {
    const db = getDb();
    const venueId = g.venue_id || g.venueId;
    const existing = this.get(venueId);
    db.prepare(`
      INSERT INTO gold_extractions (venue_id, venue_name, promotions, source_hash, normalized_source_hash, processed_at, updated_at)
      VALUES (@venue_id, @venue_name, @promotions, @source_hash, @normalized_source_hash, @processed_at, datetime('now'))
      ON CONFLICT(venue_id) DO UPDATE SET
        venue_name=@venue_name, promotions=@promotions, source_hash=@source_hash,
        normalized_source_hash=@normalized_source_hash, processed_at=@processed_at,
        updated_at=datetime('now')
    `).run({
      venue_id: venueId,
      venue_name: g.venue_name || g.venueName || null,
      promotions: typeof g.promotions === 'string' ? g.promotions : JSON.stringify(g.promotions),
      source_hash: g.source_hash || g.sourceHash || null,
      normalized_source_hash: g.normalized_source_hash || g.normalizedSourceHash || null,
      processed_at: g.processed_at || g.processedAt || null,
    });
    logAudit('gold_extractions', venueId, existing ? 'UPDATE' : 'INSERT', existing, g);
  },
  count() {
    return getDb().prepare('SELECT COUNT(*) as cnt FROM gold_extractions').get().cnt;
  },
  getWithPromotions() {
    return getDb().prepare(`
      SELECT * FROM gold_extractions
      WHERE json_extract(promotions, '$.found') = 1
      ORDER BY venue_id
    `).all();
  },
};

const areas = {
  getAll() {
    return getDb().prepare('SELECT * FROM areas ORDER BY name').all();
  },
  getNames() {
    return getDb().prepare('SELECT name FROM areas ORDER BY name').all().map(r => r.name);
  },
  upsert(a) {
    getDb().prepare(`
      INSERT INTO areas (name, display_name, description, center_lat, center_lng, radius_meters, bounds, zip_codes)
      VALUES (@name, @display_name, @description, @center_lat, @center_lng, @radius_meters, @bounds, @zip_codes)
      ON CONFLICT(name) DO UPDATE SET
        display_name=@display_name, description=@description,
        center_lat=@center_lat, center_lng=@center_lng,
        radius_meters=@radius_meters, bounds=@bounds, zip_codes=@zip_codes
    `).run({
      name: a.name,
      display_name: a.displayName || a.display_name || null,
      description: a.description || null,
      center_lat: a.center?.lat || a.center_lat || null,
      center_lng: a.center?.lng || a.center_lng || null,
      radius_meters: a.radiusMeters || a.radius_meters || null,
      bounds: a.bounds ? (typeof a.bounds === 'string' ? a.bounds : JSON.stringify(a.bounds)) : null,
      zip_codes: (a.zipCodes || a.zip_codes)
        ? (typeof (a.zipCodes || a.zip_codes) === 'string' ? (a.zipCodes || a.zip_codes) : JSON.stringify(a.zipCodes || a.zip_codes))
        : null,
    });
  },
};

const activities = {
  getAll() {
    return getDb().prepare('SELECT * FROM activities ORDER BY name').all();
  },
  upsert(a) {
    getDb().prepare(`
      INSERT INTO activities (name, icon, emoji, color, community_driven)
      VALUES (@name, @icon, @emoji, @color, @community_driven)
      ON CONFLICT(name) DO UPDATE SET
        icon=@icon, emoji=@emoji, color=@color, community_driven=@community_driven
    `).run({
      name: a.name,
      icon: a.icon || null,
      emoji: a.emoji || null,
      color: a.color || null,
      community_driven: (a.communityDriven || a.community_driven) ? 1 : 0,
    });
  },
};

const watchlist = {
  getAll() {
    return getDb().prepare('SELECT * FROM watchlist ORDER BY name').all();
  },
  getExcluded() {
    return getDb().prepare("SELECT * FROM watchlist WHERE status = 'excluded'").all();
  },
  getExcludedIds() {
    return new Set(
      getDb().prepare("SELECT venue_id FROM watchlist WHERE status = 'excluded'").all().map(r => r.venue_id),
    );
  },
  getFlagged() {
    return getDb().prepare("SELECT * FROM watchlist WHERE status = 'flagged'").all();
  },
  getFlaggedIds() {
    return new Set(
      getDb().prepare("SELECT venue_id FROM watchlist WHERE status = 'flagged'").all().map(r => r.venue_id),
    );
  },
  upsert(w) {
    getDb().prepare(`
      INSERT INTO watchlist (venue_id, name, area, status, reason, updated_at)
      VALUES (@venue_id, @name, @area, @status, @reason, datetime('now'))
      ON CONFLICT(venue_id) DO UPDATE SET
        name=@name, area=@area, status=@status, reason=@reason, updated_at=datetime('now')
    `).run({
      venue_id: w.venue_id || w.venueId,
      name: w.name || null,
      area: w.area || null,
      status: w.status,
      reason: w.reason || null,
    });
  },
  count() {
    return getDb().prepare('SELECT COUNT(*) as cnt FROM watchlist').get().cnt;
  },
};

const confidenceReviews = {
  get(venueId, activityType) {
    return getDb().prepare(
      'SELECT * FROM confidence_reviews WHERE venue_id = ? AND activity_type = ?',
    ).get(venueId, activityType);
  },
  getAll() {
    return getDb().prepare('SELECT * FROM confidence_reviews ORDER BY reviewed_at DESC').all();
  },
  getDecisionMap() {
    const rows = getDb().prepare('SELECT * FROM confidence_reviews').all();
    const map = new Map();
    for (const r of rows) map.set(`${r.venue_id}::${r.activity_type}`, r);
    return map;
  },
  upsert(r) {
    getDb().prepare(`
      INSERT INTO confidence_reviews (venue_id, activity_type, decision, reason,
        reviewed_source_hash, effective_confidence, flags, source, llm_confidence, reviewed_at)
      VALUES (@venue_id, @activity_type, @decision, @reason,
        @reviewed_source_hash, @effective_confidence, @flags, @source, @llm_confidence, datetime('now'))
      ON CONFLICT(venue_id, activity_type) DO UPDATE SET
        decision=@decision, reason=@reason, reviewed_source_hash=@reviewed_source_hash,
        effective_confidence=@effective_confidence, flags=@flags, source=@source,
        llm_confidence=@llm_confidence, reviewed_at=datetime('now')
    `).run({
      venue_id: r.venue_id || r.venueId,
      activity_type: r.activity_type || r.activityType,
      decision: r.decision,
      reason: r.reason || null,
      reviewed_source_hash: r.reviewed_source_hash || r.reviewedSourceHash || null,
      effective_confidence: r.effective_confidence || r.effectiveConfidence || null,
      flags: r.flags ? (typeof r.flags === 'string' ? r.flags : JSON.stringify(r.flags)) : null,
      source: r.source || 'manual',
      llm_confidence: r.llm_confidence || r.llmConfidence || null,
    });
  },
  count() {
    return getDb().prepare('SELECT COUNT(*) as cnt FROM confidence_reviews').get().cnt;
  },
  countByDecision() {
    return getDb().prepare(
      'SELECT decision, COUNT(*) as cnt FROM confidence_reviews GROUP BY decision',
    ).all();
  },
};

module.exports = { gold, areas, activities, watchlist, confidenceReviews };
