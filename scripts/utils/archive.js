/**
 * Archive utilities for the pipeline.
 * Handles rolling directory snapshots and retention-based cleanup.
 */

const fs = require('fs');
const path = require('path');

const EXCLUDE_DIRS = new Set(['archive', 'archive-incremental', 'incremental-history', '.bulk-complete']);

/**
 * Snapshot a source directory into a dated archive folder.
 * Copies files and one level of subdirectories.
 *
 * @param {string} sourceDir - directory to archive
 * @param {string} archiveBase - parent of date-labeled archive dirs
 * @param {string} dateLabel - e.g. "20260211"
 * @param {Function} [log=console.log]
 */
function archiveDirectory(sourceDir, archiveBase, dateLabel, log = console.log) {
  if (!fs.existsSync(sourceDir)) return;
  const files = fs.readdirSync(sourceDir).filter(f => !f.startsWith('.') && !EXCLUDE_DIRS.has(f));
  if (files.length === 0) return;

  const archiveDir = path.join(archiveBase, dateLabel);
  if (fs.existsSync(archiveDir)) {
    log(`   📦 Archive ${archiveDir} already exists — skipping`);
    return;
  }
  fs.mkdirSync(archiveDir, { recursive: true });

  let count = 0;
  for (const item of files) {
    const src = path.join(sourceDir, item);
    const dst = path.join(archiveDir, item);
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
      fs.mkdirSync(dst, { recursive: true });
      for (const sf of fs.readdirSync(src)) {
        if (fs.statSync(path.join(src, sf)).isFile()) {
          fs.copyFileSync(path.join(src, sf), path.join(dst, sf));
        }
      }
      count++;
    } else if (stat.isFile()) {
      fs.copyFileSync(src, dst);
      count++;
    }
  }
  log(`   📦 Archived ${count} item(s) to ${archiveDir}`);
}

/**
 * Remove archive directories older than the retention window.
 *
 * @param {string} archiveBase - parent directory containing YYYYMMDD folders
 * @param {number} retentionDays
 * @param {Function} [log=console.log]
 */
function cleanOldArchives(archiveBase, retentionDays = 14, log = console.log) {
  if (!fs.existsSync(archiveBase)) return;
  const cutoff = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
  const dirs = fs.readdirSync(archiveBase).filter(d => /^\d{8}$/.test(d));
  for (const d of dirs) {
    const y = parseInt(d.substring(0, 4));
    const m = parseInt(d.substring(4, 6)) - 1;
    const dd = parseInt(d.substring(6, 8));
    if (new Date(y, m, dd).getTime() < cutoff) {
      fs.rmSync(path.join(archiveBase, d), { recursive: true, force: true });
      log(`   🗑️  Cleaned old archive: ${d}`);
    }
  }
}

module.exports = { archiveDirectory, cleanOldArchives };
