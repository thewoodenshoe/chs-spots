#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$HOME/projects/chs-spots"
LOG_DIR="$APP_DIR/logs/ops"
STATE_DIR="$APP_DIR/.ops"
STAMP_FILE="$STATE_DIR/last-seed-epoch"
mkdir -p "$LOG_DIR" "$STATE_DIR"

NOW_EPOCH="$(date +%s)"
LAST_EPOCH=0
if [ -f "$STAMP_FILE" ]; then
  LAST_EPOCH="$(cat "$STAMP_FILE" || echo 0)"
fi

SECONDS_14_DAYS=$((14 * 24 * 60 * 60))
DELTA=$((NOW_EPOCH - LAST_EPOCH))

if [ "$DELTA" -lt "$SECONDS_14_DAYS" ]; then
  echo "Skipping seed-venues; last run ${DELTA}s ago (<14 days)."
  exit 0
fi

TIMESTAMP="$(date +%F-%H%M%S)"
LOG_FILE="$LOG_DIR/biweekly-seed-$TIMESTAMP.log"

cd "$APP_DIR"
set -a
source "$APP_DIR/.env.local"
set +a
export GOOGLE_PLACES_ENABLED=true

node scripts/seed-venues.js --confirm >> "$LOG_FILE" 2>&1
printf "%s" "$NOW_EPOCH" > "$STAMP_FILE"

echo "seed-venues completed and stamp updated"
