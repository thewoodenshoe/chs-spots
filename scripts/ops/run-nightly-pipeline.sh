#!/usr/bin/env bash
set -uo pipefail

APP_DIR="$HOME/projects/chs-spots"
LOG_DIR="$APP_DIR/logs/ops"
mkdir -p "$LOG_DIR"

TIMESTAMP="$(date +%F-%H%M%S)"
LOG_FILE="$LOG_DIR/nightly-pipeline-$TIMESTAMP.log"

cd "$APP_DIR"

# Ensure nightly LLM cap before run
node - <<"NODE"
const fs = require("fs");
const path = require("path");
const configPath = path.join(process.cwd(), "data/config/config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
if (!config.pipeline) config.pipeline = {};
config.pipeline.maxIncrementalFiles = 80;
fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
console.log("Set pipeline.maxIncrementalFiles=80");
NODE

# Load env vars FIRST (needed by both pipeline and report)
# Use || true so a missing/broken .env.local doesn't kill the script
set -a
# shellcheck disable=SC1091
source "$APP_DIR/.env.local" 2>/dev/null || true
set +a

export UMAMI_WEBSITE_ID="${NEXT_PUBLIC_UMAMI_WEBSITE_ID:-}"
export SERVER_PUBLIC_URL="${SERVER_PUBLIC_URL:-https://chsfinds.com}"

# Full all-areas pipeline
node scripts/run-incremental-pipeline.js --confirm >> "$LOG_FILE" 2>&1 || true
PIPELINE_EXIT=${PIPESTATUS[0]:-$?}

if [ "$PIPELINE_EXIT" -eq 0 ] 2>/dev/null; then
  echo "Pipeline completed successfully at $(date)" >> "$LOG_FILE"
else
  echo "Pipeline FAILED with exit code $PIPELINE_EXIT at $(date)" >> "$LOG_FILE"
fi

# Generate and send daily report (runs REGARDLESS of pipeline outcome)
echo "--- Generating daily report ---" >> "$LOG_FILE"
node scripts/ops/generate-report.js --send-telegram >> "$LOG_FILE" 2>&1 || true
echo "Report generated at $(date)" >> "$LOG_FILE"
