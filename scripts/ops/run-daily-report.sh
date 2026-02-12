#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$HOME/projects/chs-spots"
LOG_DIR="$APP_DIR/logs/ops"
mkdir -p "$LOG_DIR"

TIMESTAMP="$(date +%F-%H%M%S)"
LOG_FILE="$LOG_DIR/daily-report-$TIMESTAMP.log"

cd "$APP_DIR"

# Load env vars (Telegram tokens, Umami IDs, etc.)
set -a
# shellcheck disable=SC1091
source "$APP_DIR/.env.local"
set +a

# Extra env vars for the report (set in .env.local on server)
export UMAMI_WEBSITE_ID="${NEXT_PUBLIC_UMAMI_WEBSITE_ID:-}"
export SERVER_PUBLIC_URL="${SERVER_PUBLIC_URL:-https://chsfinds.com}"

node scripts/ops/generate-report.js --send-telegram >> "$LOG_FILE" 2>&1

echo "Report generated at $(date)" >> "$LOG_FILE"
