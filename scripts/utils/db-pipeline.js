/**
 * Pipeline DAL — config/state, pipeline runs, update streaks, and audit queries.
 */

const { getDb, logAudit } = require('./db-core');

const config = {
  get(key) {
    const row = getDb().prepare('SELECT value FROM pipeline_state WHERE key = ?').get(key);
    return row ? row.value : null;
  },
  getAll() {
    const rows = getDb().prepare('SELECT key, value FROM pipeline_state').all();
    const obj = {};
    for (const r of rows) obj[r.key] = r.value;
    return obj;
  },
  set(key, value) {
    getDb().prepare(`
      INSERT INTO pipeline_state (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `).run(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  },
  loadConfig() {
    const all = this.getAll();
    const todayStr = (() => {
      const d = new Date();
      return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    })();
    return {
      run_date: all.run_date || todayStr,
      last_raw_processed_date: all.last_raw_processed_date || null,
      last_merged_processed_date: all.last_merged_processed_date || null,
      last_trimmed_processed_date: all.last_trimmed_processed_date || null,
      last_run_status: all.last_run_status || 'idle',
      pipeline: {
        maxIncrementalFiles: parseInt(all['pipeline.maxIncrementalFiles'] || '15', 10),
      },
    };
  },
  saveConfig(cfg) {
    const db = getDb();
    db.transaction(() => {
      this.set('run_date', cfg.run_date);
      if (cfg.last_raw_processed_date !== undefined) this.set('last_raw_processed_date', cfg.last_raw_processed_date || '');
      if (cfg.last_merged_processed_date !== undefined) this.set('last_merged_processed_date', cfg.last_merged_processed_date || '');
      if (cfg.last_trimmed_processed_date !== undefined) this.set('last_trimmed_processed_date', cfg.last_trimmed_processed_date || '');
      if (cfg.last_run_status !== undefined) this.set('last_run_status', cfg.last_run_status);
      if (cfg.pipeline?.maxIncrementalFiles !== undefined) this.set('pipeline.maxIncrementalFiles', String(cfg.pipeline.maxIncrementalFiles));
    })();
  },
};

const pipelineRuns = {
  create(run) {
    const info = getDb().prepare(`
      INSERT INTO pipeline_runs (started_at, finished_at, status, area_filter, run_date, steps, manifest)
      VALUES (@started_at, @finished_at, @status, @area_filter, @run_date, @steps, @manifest)
    `).run({
      started_at: run.startedAt || run.started_at || null,
      finished_at: run.finishedAt || run.finished_at || null,
      status: run.status || null,
      area_filter: run.areaFilter || run.area_filter || null,
      run_date: run.runDate || run.run_date || null,
      steps: run.steps ? (typeof run.steps === 'string' ? run.steps : JSON.stringify(run.steps)) : null,
      manifest: run.manifest ? (typeof run.manifest === 'string' ? run.manifest : JSON.stringify(run.manifest)) : null,
    });
    return Number(info.lastInsertRowid);
  },
  update(id, fields) {
    const setClauses = [];
    const params = { id };
    for (const [key, val] of Object.entries(fields)) {
      const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      setClauses.push(`${col} = @${col}`);
      params[col] = (val !== null && typeof val === 'object') ? JSON.stringify(val) : val;
    }
    if (setClauses.length === 0) return;
    getDb().prepare(`UPDATE pipeline_runs SET ${setClauses.join(', ')} WHERE id = @id`).run(params);
  },
  latest() {
    return getDb().prepare('SELECT * FROM pipeline_runs ORDER BY id DESC LIMIT 1').get();
  },
  getByDate(runDate) {
    return getDb().prepare('SELECT * FROM pipeline_runs WHERE run_date = ? ORDER BY id DESC').all(runDate);
  },
};

const streaks = {
  get(venueId, type) {
    return getDb().prepare('SELECT * FROM update_streaks WHERE venue_id = ? AND type = ?').get(venueId, type);
  },
  getAll() {
    return getDb().prepare('SELECT * FROM update_streaks ORDER BY streak DESC').all();
  },
  upsert(venueId, type, name, lastDate, streak) {
    getDb().prepare(`
      INSERT INTO update_streaks (venue_id, type, name, last_date, streak)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(venue_id, type) DO UPDATE SET
        name=excluded.name, last_date=excluded.last_date, streak=excluded.streak
    `).run(venueId, type, name, lastDate, streak);
  },
};

const audit = {
  log: logAudit,
  recent(limit = 50) {
    return getDb().prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit);
  },
  byTable(tableName, limit = 50) {
    return getDb().prepare('SELECT * FROM audit_log WHERE table_name = ? ORDER BY id DESC LIMIT ?').all(tableName, limit);
  },
};

module.exports = { config, pipelineRuns, streaks, audit };
