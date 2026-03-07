#!/bin/bash
# Promotions (HH/Brunch) Pipeline Orchestrator
# Runs after the nightly scrape: extract → create spots → critical fill → quality check → SEO → report

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs/ops"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/promotions-$(date +%Y%m%d-%H%M%S).log"

cd "$PROJECT_DIR"
source .env.local 2>/dev/null || true

echo "=== Promotions Pipeline started at $(date) ===" >> "$LOG_FILE"

# Step 1+2: Extract promotions from silver_trimmed via LLM
echo "--- Step 1: Extract Promotions ---" >> "$LOG_FILE"
node scripts/extract-promotions.js --incremental >> "$LOG_FILE" 2>&1 || true

# Step 3: Create spots from gold extractions (includes enrichment + logic checks)
echo "--- Step 3: Create Spots ---" >> "$LOG_FILE"
node scripts/create-spots.js >> "$LOG_FILE" 2>&1 || true

# Step 4: Critical fill — targeted LLM for missing times/days
echo "--- Step 4: Critical Fill ---" >> "$LOG_FILE"
node scripts/pipelines/promotions/critical-fill.js >> "$LOG_FILE" 2>&1 || true

# Step 5: Quality check — scan for remaining anomalies
echo "--- Step 5: Quality Check ---" >> "$LOG_FILE"
node scripts/pipelines/promotions/quality-check.js >> "$LOG_FILE" 2>&1 || true

# Step 6: SEO — Revalidate ISR pages
source "$PROJECT_DIR/scripts/ops/revalidate-pages.sh"
revalidate_pages "$LOG_FILE"

echo "=== Promotions Pipeline completed at $(date) ===" >> "$LOG_FILE"
