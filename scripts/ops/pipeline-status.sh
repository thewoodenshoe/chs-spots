#!/usr/bin/env bash
# pipeline-status.sh — Quick pivot table of the latest pipeline run
# Usage: bash scripts/ops/pipeline-status.sh

set -uo pipefail

APP_DIR="${APP_DIR:-$HOME/projects/chs-spots}"
MANIFEST_DIR="$APP_DIR/logs/pipeline-manifests"
LOG_DIR="$APP_DIR/logs/ops"

# ── Colors ──────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

status_color() {
  case "$1" in
    completed) echo -e "${GREEN}$1${NC}" ;;
    running)   echo -e "${YELLOW}$1${NC}" ;;
    skipped)   echo -e "${CYAN}$1${NC}" ;;
    failed)    echo -e "${RED}$1${NC}" ;;
    pending)   echo -e "$1" ;;
    *)         echo "$1" ;;
  esac
}

to_est() {
  local ts="$1"
  if [ -z "$ts" ] || [ "$ts" = "null" ]; then echo "–"; return; fi
  date -d "$ts" '+%I:%M:%S %p EST' 2>/dev/null || \
  TZ='America/New_York' date -j -f '%Y-%m-%dT%H:%M:%S' "${ts%%.*}" '+%I:%M:%S %p EST' 2>/dev/null || \
  echo "$ts"
}

duration_between() {
  local start="$1" end="$2"
  if [ -z "$start" ] || [ "$start" = "null" ] || [ -z "$end" ] || [ "$end" = "null" ]; then echo "–"; return; fi
  local s_epoch e_epoch
  s_epoch=$(date -d "$start" +%s 2>/dev/null || date -j -f '%Y-%m-%dT%H:%M:%S' "${start%%.*}" +%s 2>/dev/null) || { echo "–"; return; }
  e_epoch=$(date -d "$end" +%s 2>/dev/null || date -j -f '%Y-%m-%dT%H:%M:%S' "${end%%.*}" +%s 2>/dev/null) || { echo "–"; return; }
  local diff=$(( e_epoch - s_epoch ))
  if [ $diff -lt 60 ]; then echo "${diff}s"
  elif [ $diff -lt 3600 ]; then echo "$(( diff / 60 ))m $(( diff % 60 ))s"
  else echo "$(( diff / 3600 ))h $(( (diff % 3600) / 60 ))m"; fi
}

# ── Find latest manifest ────────────────────────────────────────
MANIFEST=$(ls -t "$MANIFEST_DIR"/*.json 2>/dev/null | head -1)
if [ -z "$MANIFEST" ]; then
  echo "No pipeline manifests found in $MANIFEST_DIR"
  exit 1
fi

# ── Parse manifest with basic tools (no jq dependency) ──────────
# Use node for JSON parsing (always available)
read_json() {
  node -e "
    const m = JSON.parse(require('fs').readFileSync('$MANIFEST','utf8'));
    const steps = m.steps || {};
    const stepNames = ['raw','merged','trimmed','delta','extract','spots'];
    console.log('RUN_ID=' + (m.runId || '–'));
    console.log('RUN_STATUS=' + (m.status || '–'));
    console.log('RUN_START=' + (m.startedAt || ''));
    console.log('RUN_END=' + (m.finishedAt || ''));
    console.log('AREA_FILTER=' + (m.areaFilter || ''));
    for (const name of stepNames) {
      const s = steps[name] || {};
      console.log('STEP_' + name + '_STATUS=' + (s.status || 'pending'));
      console.log('STEP_' + name + '_START=' + (s.startedAt || ''));
      console.log('STEP_' + name + '_END=' + (s.finishedAt || ''));
    }
  "
}
eval "$(read_json)"

# ── Gather live progress from the running log ───────────────────
DETAIL_raw="–"; DETAIL_merged="–"; DETAIL_trimmed="–"; DETAIL_delta="–"; DETAIL_extract="–"; DETAIL_spots="–"

# Find the latest pipeline log
# Check both the ops log dir and the manifest's logPath; pick the one most recently modified
LATEST_LOG=""
candidates=""
# manifest logPath
manifest_log=$(node -e "const m=JSON.parse(require('fs').readFileSync('$MANIFEST','utf8'));console.log(m.logPath||'')" 2>/dev/null || true)
if [ -n "$manifest_log" ] && [ -f "$manifest_log" ]; then candidates="$manifest_log"; fi
# ops dir logs
for f in "$LOG_DIR"/nightly-pipeline* "$LOG_DIR"/manual-pipeline*; do
  [ -f "$f" ] && candidates="$candidates $f"
done
if [ -n "$candidates" ]; then
  LATEST_LOG=$(ls -t $candidates 2>/dev/null | head -1)
fi

if [ -n "$LATEST_LOG" ] && [ -f "$LATEST_LOG" ]; then
  # Raw: count downloaded files
  raw_done=$(grep -c 'Saved\|saved' "$LATEST_LOG" 2>/dev/null | tail -1 || echo "0")
  raw_err=$(grep -c 'Failed to download' "$LATEST_LOG" 2>/dev/null | tail -1 || echo "0")
  venues_total=$(grep -oP 'Processing \K\d+' "$LATEST_LOG" 2>/dev/null | tail -1 || true)
  if [ -n "$venues_total" ] && [ "$venues_total" -gt 0 ] 2>/dev/null; then
    DETAIL_raw="${raw_done} saved, ${raw_err} errors (${venues_total} venues)"
  elif [ "$raw_done" -gt 0 ] 2>/dev/null; then
    DETAIL_raw="${raw_done} saved, ${raw_err} errors"
  fi
  # Check if raw was skipped in log
  if grep -q 'skipping download\|raw/today/ not empty' "$LATEST_LOG" 2>/dev/null; then
    DETAIL_raw="skipped (already downloaded today)"
  fi

  # Merge: check merged count
  merged_count=$(grep -oP 'Merged \K\d+|merged.*?(\d+) venue' "$LATEST_LOG" 2>/dev/null | tail -1 || true)
  if [ -n "$merged_count" ]; then DETAIL_merged="${merged_count} venues"; fi
  if grep -q 'No raw files\|nothing to merge\|Skipped merge' "$LATEST_LOG" 2>/dev/null; then
    DETAIL_merged="skipped (no raw files)"
  fi

  # Trim: check trimmed count
  trimmed_count=$(grep -oP 'Trimmed.*\K\d+' "$LATEST_LOG" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$trimmed_count" -gt 0 ] 2>/dev/null; then DETAIL_trimmed="${trimmed_count} venues trimmed"; fi
  # Check if trimming is currently running (last line has Trimmed)
  if [ "$STEP_trimmed_STATUS" = "running" ]; then
    DETAIL_trimmed="${trimmed_count} venues trimmed so far..."
  fi

  # Delta
  delta_new=$(grep -oP 'New venues: \K\d+' "$LATEST_LOG" 2>/dev/null | tail -1 || true)
  delta_changed=$(grep -oP 'Changed venues: \K\d+' "$LATEST_LOG" 2>/dev/null | tail -1 || true)
  delta_total=$(grep -oP 'Total files ready for LLM: \K\d+' "$LATEST_LOG" 2>/dev/null | tail -1 || true)
  if [ -n "$delta_total" ]; then
    DETAIL_delta="${delta_new:-0} new, ${delta_changed:-0} changed → ${delta_total} for LLM"
  fi

  # Extract (LLM)
  llm_processed=$(grep -c 'Successfully processed' "$LATEST_LOG" 2>/dev/null || true)
  llm_processed=${llm_processed:-0}
  llm_skipped=$(grep -c 'Skipping.*changes\|Skipping.*hash match' "$LATEST_LOG" 2>/dev/null || true)
  llm_skipped=${llm_skipped:-0}
  llm_done=$((llm_processed + llm_skipped))
  llm_total=$(grep -oP 'Found \K\d+(?= venue file| incremental)' "$LATEST_LOG" 2>/dev/null | tail -1 || true)
  if [ -n "$llm_total" ] && [ "$llm_total" -gt 0 ] 2>/dev/null; then
    DETAIL_extract="${llm_processed} done, ${llm_skipped} skipped (${llm_done}/${llm_total})"
  fi
  if [ "$STEP_extract_STATUS" = "running" ] && [ -n "$llm_total" ]; then
    DETAIL_extract="${llm_processed} done, ${llm_skipped} skipped (${llm_done}/${llm_total}) processing..."
  fi
  # Check if skipped due to limit
  skip_msg=$(grep -o 'Too many incremental files.*' "$LATEST_LOG" 2>/dev/null | head -1 || true)
  if [ -n "$skip_msg" ]; then
    DETAIL_extract="⚠ $skip_msg"
  fi
  # Check if no changes
  if grep -q 'No incremental changes detected.*skipping LLM' "$LATEST_LOG" 2>/dev/null; then
    DETAIL_extract="no changes detected"
  fi

  # Spots
  spots_new=$(grep -oP 'New automated spots created: \K\d+' "$LATEST_LOG" 2>/dev/null | tail -1 || true)
  spots_total=$(grep -oP 'Total spots.*: \K\d+' "$LATEST_LOG" 2>/dev/null | tail -1 || true)
  if [ -n "$spots_total" ]; then
    DETAIL_spots="${spots_new:-0} new, ${spots_total} total"
  fi
  if grep -q 'No incremental changes detected.*skipping spot' "$LATEST_LOG" 2>/dev/null; then
    DETAIL_spots="skipped (no changes)"
  fi
fi

# ── Check if pipeline is still running ──────────────────────────
RUNNING=""
if pgrep -f "run-incremental-pipeline" > /dev/null 2>&1; then
  RUNNING="  ${YELLOW}⟳ Pipeline is currently RUNNING${NC}"
elif pgrep -f "extract-promotions" > /dev/null 2>&1; then
  RUNNING="  ${YELLOW}⟳ LLM extraction is currently RUNNING${NC}"
fi

# ── Print table ─────────────────────────────────────────────────
echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  CHS Finds Pipeline Status${NC}    Run: ${CYAN}${RUN_ID}${NC}    Status: $(status_color "$RUN_STATUS")"
if [ -n "$AREA_FILTER" ] && [ "$AREA_FILTER" != "" ]; then
  echo -e "  ${RED}⚠ Area filter: ${AREA_FILTER}${NC}"
fi
if [ -n "$RUN_START" ]; then
  echo -e "  Started: $(to_est "$RUN_START")    Ended: $(to_est "${RUN_END:-}")    Duration: $(duration_between "$RUN_START" "${RUN_END:-}")"
fi
if [ -n "$RUNNING" ]; then echo -e "$RUNNING"; fi
echo -e "${BOLD}═══════════════════════════════════════════════════════════════════════════════════════════${NC}"
printf "${BOLD}%-12s %-12s %-14s %-14s %-50s${NC}\n" "Step" "Status" "Start (EST)" "End (EST)" "Detail"
echo "──────────────────────────────────────────────────────────────────────────────────────────"

for step in raw merged trimmed delta extract spots; do
  status_var="STEP_${step}_STATUS"
  start_var="STEP_${step}_START"
  end_var="STEP_${step}_END"
  detail_var="DETAIL_${step}"

  status="${!status_var}"
  start_time=$(to_est "${!start_var}")
  end_time=$(to_est "${!end_var}")
  detail="${!detail_var}"
  dur=$(duration_between "${!start_var}" "${!end_var}")

  # Friendly step names
  case "$step" in
    raw)     label="Download" ;;
    merged)  label="Merge" ;;
    trimmed) label="Trim" ;;
    delta)   label="Delta" ;;
    extract) label="LLM Extract" ;;
    spots)   label="Create Spots" ;;
    *)       label="$step" ;;
  esac

  printf "%-12s " "$label"
  # Print status with color (use echo -n for color)
  status_str=$(status_color "$status")
  echo -ne "$status_str"
  # Pad to 12 chars
  pad=$((12 - ${#status}))
  printf "%${pad}s" ""
  printf "%-14s %-14s %-50s\n" "$start_time" "${end_time} (${dur})" "$detail"
done

echo "──────────────────────────────────────────────────────────────────────────────────────────"

# Spots.json age
SPOTS_FILE="$APP_DIR/data/reporting/spots.json"
if [ -f "$SPOTS_FILE" ]; then
  spots_mod=$(stat -c %Y "$SPOTS_FILE" 2>/dev/null || stat -f %m "$SPOTS_FILE" 2>/dev/null)
  spots_date=$(date -d "@$spots_mod" '+%Y-%m-%d %I:%M %p EST' 2>/dev/null || TZ='America/New_York' date -r "$spots_mod" '+%Y-%m-%d %I:%M %p EST' 2>/dev/null)
  spots_age=$(( ($(date +%s) - spots_mod) / 3600 ))
  echo -e "  spots.json last modified: ${BOLD}${spots_date}${NC} (${spots_age}h ago)"
fi

echo ""
