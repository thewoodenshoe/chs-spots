#!/usr/bin/env bash
set -uo pipefail

APP_DIR="$HOME/projects/chs-spots"
LOG_DIR="$APP_DIR/logs/ops"
mkdir -p "$LOG_DIR"

TIMESTAMP="$(date +%F-%H%M%S)"
LOG_FILE="$LOG_DIR/nightly-pipeline-$TIMESTAMP.log"

cd "$APP_DIR"

# Load env vars FIRST (needed by config path, pipeline, and report)
# Use || true so a missing/broken .env.local doesn't kill the script
set -a
# shellcheck disable=SC1091
source "$APP_DIR/.env.local" 2>/dev/null || true
set +a

# Ensure nightly LLM cap before run (uses DATA_DIR for config path)
node -e "
const fs = require('fs');
const path = require('path');
const dataRoot = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const configPath = path.join(dataRoot, 'config/config.json');
if (fs.existsSync(configPath)) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (!config.pipeline) config.pipeline = {};
  config.pipeline.maxIncrementalFiles = 80;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log('Set pipeline.maxIncrementalFiles=80');
}
"

export UMAMI_WEBSITE_ID="${NEXT_PUBLIC_UMAMI_WEBSITE_ID:-}"
export SERVER_PUBLIC_URL="${SERVER_PUBLIC_URL:-https://chsfinds.com}"

# Backup SQLite database before pipeline (7-day rolling retention)
BACKUP_DIR="$APP_DIR/backups"
mkdir -p "$BACKUP_DIR"
DB_FILE="$APP_DIR/data/chs-spots.db"
if [ -f "$DB_FILE" ]; then
  BACKUP_FILE="$BACKUP_DIR/chs-spots-$(date +%F).db"
  node -e "
    const Database = require('better-sqlite3');
    const db = new Database('$DB_FILE', { readonly: true });
    db.backup('$BACKUP_FILE').then(() => {
      console.log('Database backed up successfully');
      db.close();
    }).catch(err => {
      console.error('Backup failed:', err);
      db.close();
      process.exit(1);
    });
  " >> "$LOG_FILE" 2>&1 || echo "WARNING: Database backup failed" >> "$LOG_FILE"
  # Keep only last 7 daily backups
  find "$BACKUP_DIR" -name 'chs-spots-*.db' -mtime +7 -delete 2>/dev/null || true
fi

# Full all-areas pipeline
node scripts/run-incremental-pipeline.js --confirm >> "$LOG_FILE" 2>&1 || true
PIPELINE_EXIT=${PIPESTATUS[0]:-$?}

if [ "$PIPELINE_EXIT" -eq 0 ] 2>/dev/null; then
  echo "Pipeline completed successfully at $(date)" >> "$LOG_FILE"
else
  echo "Pipeline FAILED with exit code $PIPELINE_EXIT at $(date)" >> "$LOG_FILE"
fi

# Generate and send daily report (runs REGARDLESS of pipeline outcome)
echo "--- Generating daily report ---" >> "$LOG_FILE"
node scripts/ops/generate-report.js --send-telegram >> "$LOG_FILE" 2>&1 || true
echo "Report generated at $(date)" >> "$LOG_FILE"
