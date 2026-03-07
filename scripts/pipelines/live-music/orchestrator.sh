#!/bin/bash
# Live Music Pipeline Orchestrator
# Cron: 0 13 * * *  (1:00 PM EST daily)
# Steps: Discover → Critical Fill → Quality Gate → Upsert → Pre-Report → SEO → Report → Telegram

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs/ops"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/live-music-$(date +%Y%m%d-%H%M%S).log"

cd "$PROJECT_DIR"
source .env.local 2>/dev/null || true
export GOOGLE_PLACES_ENABLED=true

echo "=== Live Music Pipeline started at $(date) ===" >> "$LOG_FILE"

# Steps 1-6: Discover, Critical Fill, Quality Gate, Upsert, Pre-Report Check
echo "--- Running pipeline orchestrator ---" >> "$LOG_FILE"
node scripts/pipelines/live-music/run.js >> "$LOG_FILE" 2>&1 || true
echo "Pipeline completed at $(date)" >> "$LOG_FILE"

# Step 7: SEO — Revalidate ISR pages
source "$PROJECT_DIR/scripts/ops/revalidate-pages.sh"
revalidate_pages "$LOG_FILE"

echo "=== Live Music Pipeline completed at $(date) ===" >> "$LOG_FILE"
