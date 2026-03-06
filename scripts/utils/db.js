/**
 * Data Access Layer (DAL) for CHS Spots SQLite database.
 *
 * Re-exports all sub-modules for backward-compatible access:
 *   const db = require('./db');
 *   db.venues.getAll();
 *   db.spots.insert({ ... });
 *
 * Sub-modules: db-core, db-venues, db-spots, db-support, db-pipeline.
 */

const {
  getDb, getDbPath, closeDb, ensureSchema,
  syncActivityFlags, ACTIVITY_FLAG_MAP,
  transaction, setAuditContext, generateVenueId, logAudit,
} = require('./db-core');
const venues = require('./db-venues');
const spots = require('./db-spots');
const { gold, areas, activities, watchlist, confidenceReviews } = require('./db-support');
const { config, pipelineRuns, streaks, audit } = require('./db-pipeline');

module.exports = {
  getDb, getDbPath, closeDb, ensureSchema,
  syncActivityFlags, ACTIVITY_FLAG_MAP,
  setAuditContext, generateVenueId, logAudit,
  venues, spots, gold, areas, activities,
  watchlist, confidenceReviews, config,
  pipelineRuns, streaks, audit, transaction,
};
