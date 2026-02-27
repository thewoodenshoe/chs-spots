/**
 * File-based pipeline lock to prevent concurrent ETL/discovery scripts
 * from producing inconsistent DB state.
 *
 * Acquires an exclusive lock by writing a PID file. Stale locks (from
 * crashed processes) are auto-expired after STALE_THRESHOLD_MS.
 */

const fs = require('fs');
const path = require('path');

const LOCK_DIR = path.join(__dirname, '..', '..', '.ops');
const LOCK_FILE = path.join(LOCK_DIR, 'pipeline.lock');
const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

function acquire(scriptName) {
  if (!fs.existsSync(LOCK_DIR)) fs.mkdirSync(LOCK_DIR, { recursive: true });

  if (fs.existsSync(LOCK_FILE)) {
    try {
      const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
      const age = Date.now() - lock.timestamp;
      if (age < STALE_THRESHOLD_MS) {
        return { acquired: false, holder: lock.script, pid: lock.pid, ageMs: age };
      }
      // Stale lock — previous process likely crashed
    } catch {
      // Corrupt lock file, overwrite it
    }
  }

  fs.writeFileSync(LOCK_FILE, JSON.stringify({
    pid: process.pid,
    script: scriptName,
    timestamp: Date.now(),
  }) + '\n', 'utf8');

  return { acquired: true };
}

function release() {
  try {
    if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);
  } catch {
    // Best-effort cleanup
  }
}

module.exports = { acquire, release };
