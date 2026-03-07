#!/bin/bash
# Revalidate all ISR pages via the Next.js revalidation API.
# Called at the end of each pipeline to refresh explore/venue/sitemap pages.
# Usage: source scripts/ops/revalidate-pages.sh && revalidate_pages [LOG_FILE]

revalidate_pages() {
  local log_file="${1:-/dev/null}"
  local secret="${REVALIDATE_SECRET:-}"

  echo "--- Revalidating SEO pages ---" >> "$log_file"

  if [ -z "$secret" ]; then
    echo "REVALIDATE_SECRET not set — skipping SEO revalidation" >> "$log_file"
    return 0
  fi

  local response
  response=$(curl -s -w "\n%{http_code}" -X POST "http://localhost:3000/api/revalidate" \
    -H "x-revalidate-secret: $secret" \
    -H "Content-Type: application/json" 2>&1)

  local http_code
  http_code=$(echo "$response" | tail -1)
  local body
  body=$(echo "$response" | sed '$d')

  if [ "$http_code" = "200" ]; then
    echo "Revalidation OK: $body" >> "$log_file"
  else
    echo "Revalidation FAILED (HTTP $http_code): $body" >> "$log_file"
  fi
  echo "SEO revalidation finished at $(date)" >> "$log_file"
}
