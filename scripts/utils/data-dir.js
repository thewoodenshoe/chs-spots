/**
 * Data directory resolver for ETL scripts.
 * Defaults to project data/. Override with DATA_DIR env var if needed.
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
