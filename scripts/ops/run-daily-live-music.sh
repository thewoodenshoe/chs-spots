#!/bin/bash
# Daily Live Music Pipeline — acquire events, enrich venues, validate, report.
# Cron: 0 13 * * *  (1:00 PM EST daily)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs/ops"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/live-music-refresh-$(date +%Y%m%d).log"

cd "$PROJECT_DIR"
source .env.local 2>/dev/null || true

echo "=== Live Music Pipeline started at $(date) ===" >> "$LOG_FILE"

# Step 1: Acquire — find today's events, create spots/venues for unmatched
echo "--- Step 1: Refresh live music events ---" >> "$LOG_FILE"
node scripts/refresh-live-music.js >> "$LOG_FILE" 2>&1 || true
echo "Refresh finished at $(date)" >> "$LOG_FILE"

# Step 2: Enrich — fill missing venue photos and operating hours
echo "--- Step 2: Venue enrichment ---" >> "$LOG_FILE"
node scripts/enrich-venue-data.js >> "$LOG_FILE" 2>&1 || true
echo "Enrichment finished at $(date)" >> "$LOG_FILE"

# Step 3: Validate & auto-fix — logic checks on activity times
echo "--- Step 3: Auto-fix pass ---" >> "$LOG_FILE"
node scripts/ops/auto-fix.js >> "$LOG_FILE" 2>&1 || true
echo "Auto-fix finished at $(date)" >> "$LOG_FILE"

# Step 4: Report — generate daily quality report
echo "--- Step 4: Generate report ---" >> "$LOG_FILE"
node scripts/ops/generate-report.js >> "$LOG_FILE" 2>&1 || true
echo "Report finished at $(date)" >> "$LOG_FILE"

echo "=== Live Music Pipeline completed at $(date) ===" >> "$LOG_FILE"
