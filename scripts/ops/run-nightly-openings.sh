#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$HOME/projects/chs-spots"
LOG_DIR="$APP_DIR/logs/ops"
mkdir -p "$LOG_DIR"

TIMESTAMP="$(date +%F-%H%M%S)"
LOG_FILE="$LOG_DIR/nightly-openings-$TIMESTAMP.log"

cd "$APP_DIR"
set -a
source "$APP_DIR/.env.local"
set +a
export GOOGLE_PLACES_ENABLED=true

node scripts/discover-openings.js >> "$LOG_FILE" 2>&1
echo "discover-openings completed at $(date)" >> "$LOG_FILE"

echo "--- Checking Coming Soon lifecycle ---" >> "$LOG_FILE"
node scripts/check-opening-status.js >> "$LOG_FILE" 2>&1
echo "check-opening-status completed at $(date)" >> "$LOG_FILE"

source "$(dirname "$0")/revalidate-pages.sh"
revalidate_pages "$LOG_FILE"

echo "nightly-openings completed at $(date)"
