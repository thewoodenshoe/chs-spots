#!/bin/bash
# Nightly Openings — delegates to the modular pipeline orchestrator.
# Cron: 0 3 * * *
# This is a thin wrapper for cron compatibility.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$SCRIPT_DIR/../pipelines/openings/orchestrator.sh" "$@"
