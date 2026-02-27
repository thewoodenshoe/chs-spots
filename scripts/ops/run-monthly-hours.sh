#!/usr/bin/env bash
set -uo pipefail

APP_DIR="$HOME/projects/chs-spots"
LOG_DIR="$APP_DIR/logs/ops"
mkdir -p "$LOG_DIR"

TIMESTAMP="$(date +%F-%H%M%S)"
LOG_FILE="$LOG_DIR/monthly-hours-$TIMESTAMP.log"

cd "$APP_DIR"

set -a
# shellcheck disable=SC1091
source "$APP_DIR/.env.local" 2>/dev/null || true
set +a

echo "=== Monthly Hours Extraction: $(date) ===" | tee "$LOG_FILE"

node scripts/extract-hours.js --force 2>&1 | tee -a "$LOG_FILE"
EXIT_CODE=${PIPESTATUS[0]}

echo "" | tee -a "$LOG_FILE"
echo "=== Finished: $(date) (exit $EXIT_CODE) ===" | tee -a "$LOG_FILE"

# Clean up logs older than 90 days
find "$LOG_DIR" -name "monthly-hours-*.log" -mtime +90 -delete 2>/dev/null

exit "$EXIT_CODE"
