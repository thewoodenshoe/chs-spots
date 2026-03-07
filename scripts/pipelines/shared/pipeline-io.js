'use strict';
const fs = require('fs');
const path = require('path');

const RUNS_DIR = path.resolve(__dirname, '..', '..', '..', 'data', 'pipeline-runs');

function getRunDir(pipeline) {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const dir = path.join(RUNS_DIR, pipeline, date);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeStepOutput(pipeline, stepName, data) {
  const dir = getRunDir(pipeline);
  const filePath = path.join(dir, `${stepName}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  return filePath;
}

function readStepOutput(pipeline, stepName) {
  const dir = getRunDir(pipeline);
  const filePath = path.join(dir, `${stepName}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getEstNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function getTodayLabel() {
  const n = getEstNow();
  return `${DAY_NAMES[n.getDay()]}, ${MONTHS[n.getMonth()]} ${n.getDate()}, ${n.getFullYear()}`;
}

function getTodayDate() {
  const n = getEstNow();
  const m = String(n.getMonth() + 1).padStart(2, '0');
  const d = String(n.getDate()).padStart(2, '0');
  return `${n.getFullYear()}-${m}-${d}`;
}

function getTodayDayAbbr() { return DAY_ABBR[getEstNow().getDay()]; }
function getTodayDayNum() { return getEstNow().getDay(); }

module.exports = {
  writeStepOutput, readStepOutput, getRunDir,
  getEstNow, getTodayLabel, getTodayDate, getTodayDayAbbr, getTodayDayNum,
  DAY_NAMES, DAY_ABBR, MONTHS,
};
