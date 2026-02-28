#!/bin/bash
# Daily Live Music Event Refresh
# Cron: 0 15 * * *  (3:00 PM EST daily)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs/ops"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/live-music-refresh-$(date +%Y%m%d).log"

cd "$PROJECT_DIR"
source .env.local 2>/dev/null || true

echo "=== Live Music Refresh started at $(date) ===" >> "$LOG_FILE"
node scripts/refresh-live-music.js >> "$LOG_FILE" 2>&1
echo "=== Completed at $(date) ===" >> "$LOG_FILE"
