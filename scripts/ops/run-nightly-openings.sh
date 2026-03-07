#!/bin/bash
# Nightly venue discovery — runs Coming Soon and Recently Opened pipelines.
# Cron: 0 2 * * *
# Each activity has its own modular pipeline with independent quality gates.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Starting Coming Soon pipeline ===" >&2
"$SCRIPT_DIR/../pipelines/coming-soon/orchestrator.sh" "$@"

echo "=== Starting Recently Opened pipeline ===" >&2
"$SCRIPT_DIR/../pipelines/recently-opened/orchestrator.sh" "$@"
