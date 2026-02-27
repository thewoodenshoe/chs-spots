#!/bin/bash
# Weekly Live Music Discovery
# Cron: 0 4 * * 3  (Wednesday 4:00 AM EST)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs/ops"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/live-music-$(date +%Y%m%d).log"

cd "$PROJECT_DIR"
source .env.local 2>/dev/null || true

export GOOGLE_PLACES_ENABLED=true

echo "=== Live Music Discovery started at $(date) ===" >> "$LOG_FILE"
node scripts/discover-live-music.js >> "$LOG_FILE" 2>&1
echo "=== Completed at $(date) ===" >> "$LOG_FILE"
