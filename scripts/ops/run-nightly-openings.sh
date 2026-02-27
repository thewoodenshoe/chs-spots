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

echo "discover-openings completed at $(date)"
