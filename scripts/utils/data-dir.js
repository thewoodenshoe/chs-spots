/**
 * Data directory resolver for ETL scripts.
 * Respects DATA_DIR env var (e.g. /home/ubuntu/data on server).
 * Falls back to project data/ when unset (local dev).
 */
const path = require('path');

function getDataRoot() {
  return process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
}

function dataPath(...segments) {
  return path.join(getDataRoot(), ...segments);
}

function reportingPath(...segments) {
  return path.join(getDataRoot(), 'reporting', ...segments);
}

function configPath(...segments) {
  return path.join(getDataRoot(), 'config', ...segments);
}

module.exports = { getDataRoot, dataPath, reportingPath, configPath };
