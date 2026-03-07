#!/bin/bash
# Daily Live Music — delegates to the modular pipeline orchestrator.
# Cron: 0 13 * * *  (1:00 PM EST daily)
# This is a thin wrapper for cron compatibility.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$SCRIPT_DIR/../pipelines/live-music/orchestrator.sh" "$@"
