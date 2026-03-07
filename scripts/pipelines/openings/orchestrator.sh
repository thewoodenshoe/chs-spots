#!/bin/bash
# Openings Pipeline Orchestrator
# Cron: 0 3 * * *  (3:00 AM nightly)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs/ops"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/openings-$(date +%Y%m%d-%H%M%S).log"

cd "$PROJECT_DIR"
source .env.local 2>/dev/null || true
export GOOGLE_PLACES_ENABLED=true

echo "=== Openings Pipeline started at $(date) ===" >> "$LOG_FILE"

node scripts/pipelines/openings/run.js >> "$LOG_FILE" 2>&1 || true

# Revalidate ISR pages
source "$PROJECT_DIR/scripts/ops/revalidate-pages.sh"
revalidate_pages "$LOG_FILE"

echo "=== Openings Pipeline completed at $(date) ===" >> "$LOG_FILE"
