#!/bin/bash
# Recently Opened Pipeline Orchestrator
# Cron: 0 5 * * *  (5:00 AM nightly, after coming-soon pipeline)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs/ops"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/recently-opened-$(date +%Y%m%d-%H%M%S).log"

cd "$PROJECT_DIR"
source .env.local 2>/dev/null || true
export GOOGLE_PLACES_ENABLED=true

echo "=== Recently Opened Pipeline started at $(date) ===" >> "$LOG_FILE"

node scripts/pipelines/recently-opened/run.js >> "$LOG_FILE" 2>&1 || true

# Revalidate ISR pages
source "$PROJECT_DIR/scripts/ops/revalidate-pages.sh"
revalidate_pages "$LOG_FILE"

echo "=== Recently Opened Pipeline completed at $(date) ===" >> "$LOG_FILE"
