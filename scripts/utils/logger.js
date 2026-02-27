/**
 * Shared logging utility for pipeline scripts.
 *
 * Two modes:
 *   1. createLogger(scriptName) — prefixed log/warn/error that write to
 *      stdout AND to logs/<scriptName>.log. Returns { log, warn, error, close }.
 *   2. interceptConsole(scriptName) — hijacks global console.* so child
 *      scripts that use console.log transparently write to the same file.
 *      Returns { logPath, restore }.
 */

const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.resolve(__dirname, '..', '..', 'logs');

function ensureLogsDir() {
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function timestamp() {
  const d = new Date();
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

function logFilePath(scriptName) {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const hms = `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
  return path.join(LOGS_DIR, `${scriptName}-${ymd}-${hms}.log`);
}

function fmt(args) {
  return args.map(a => (typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a))).join(' ');
}

/**
 * Create a prefixed logger that writes to stdout + file.
 * Use for scripts that control their own logging.
 */
function createLogger(scriptName) {
  ensureLogsDir();
  const filePath = logFilePath(scriptName);
  const stream = fs.createWriteStream(filePath, { flags: 'a' });

  const write = (level, ...args) => {
    const msg = fmt(args);
    const line = `[${timestamp()}] [${scriptName}:${level}] ${msg}`;
    if (level === 'error') process.stderr.write(msg + '\n');
    else process.stdout.write(msg + '\n');
    if (!stream.destroyed) stream.write(line + '\n');
  };

  return {
    log: (...args) => write('info', ...args),
    warn: (...args) => write('warn', ...args),
    error: (...args) => write('error', ...args),
    logPath: filePath,
    close: () => { if (!stream.destroyed) stream.end(); },
  };
}

/**
 * Hijack global console.* to tee output to a log file.
 * Use for orchestrator scripts that call child scripts via require().
 */
function interceptConsole(scriptName) {
  ensureLogsDir();
  const filePath = logFilePath(scriptName);
  const stream = fs.createWriteStream(filePath, { flags: 'a' });

  const orig = {
    log: console.log,
    error: console.error,
    info: console.info,
    warn: console.warn,
  };

  const intercept = (level, origFn) => (...args) => {
    origFn(...args);
    if (!stream.destroyed) {
      stream.write(`[${level.toUpperCase()}] ${fmt(args)}\n`);
    }
  };

  console.log = intercept('log', orig.log);
  console.error = intercept('error', orig.error);
  console.info = intercept('info', orig.info);
  console.warn = intercept('warn', orig.warn);

  console.log(`[logger] Writing to: ${filePath}`);

  return {
    logPath: filePath,
    restore: () => {
      Object.assign(console, orig);
      if (!stream.destroyed) stream.end();
    },
  };
}

module.exports = { createLogger, interceptConsole };
