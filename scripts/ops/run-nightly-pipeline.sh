#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$HOME/projects/chs-spots"
LOG_DIR="$APP_DIR/logs/ops"
mkdir -p "$LOG_DIR"

TIMESTAMP="$(date +%F-%H%M%S)"
LOG_FILE="$LOG_DIR/nightly-pipeline-$TIMESTAMP.log"

cd "$APP_DIR"

# Ensure nightly LLM cap is 100 before run (correct nested path)
node - <<"NODE"
const fs = require("fs");
const path = require("path");
const configPath = path.join(process.cwd(), "data/config/config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
if (!config.pipeline) config.pipeline = {};
config.pipeline.maxIncrementalFiles = 100;
fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
console.log("Set pipeline.maxIncrementalFiles=100");
NODE

# Full all-areas pipeline; no Google seed here
node scripts/run-incremental-pipeline.js --confirm >> "$LOG_FILE" 2>&1
