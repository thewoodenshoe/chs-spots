#!/bin/bash
#
# Production build script for the Ubuntu server.
#
# Due to a Next.js 15 race condition on this server, `next build` fails
# intermittently at the "Collecting page data" step. The workaround is
# to build locally (macOS) where it works reliably, then rsync the
# .next directory to the server.
#
# DEPLOYMENT:
#   1. On local machine: npm run build
#   2. rsync -avz --delete .next/ ubuntu:~/projects/chs-spots/.next/
#   3. On server: pm2 restart chs-spots
#
# This script attempts a server-side build with retries as a fallback.
#

cd "$(dirname "$0")/.."

kill_build_processes() {
  pkill -f "next build" 2>/dev/null
  pkill -f "jest-worker/processChild" 2>/dev/null
  sleep 2
}

echo "[build] Starting production build..."

MAX_RETRIES=3
for attempt in $(seq 1 $MAX_RETRIES); do
  echo "[build] Attempt $attempt of $MAX_RETRIES..."

  kill_build_processes

  # Preserve cache, remove everything else
  if [ $attempt -gt 1 ]; then
    find .next -maxdepth 1 -not -name cache -not -name .next -exec rm -rf {} + 2>/dev/null
  fi

  node_modules/.bin/next build 2>&1 || true
  kill_build_processes

  sleep 2

  # Check for complete build
  if [ -s ".next/BUILD_ID" ] && [ -f ".next/routes-manifest.json" ] && \
     [ -f ".next/server/pages-manifest.json" ] && [ -d ".next/static" ]; then
    echo "[build] Build succeeded on attempt $attempt."
    echo "[build] BUILD_ID: $(cat .next/BUILD_ID)"
    exit 0
  fi

  echo "[build] Attempt $attempt incomplete."
done

echo "[build] Server build failed after $MAX_RETRIES attempts."
echo "[build] Use the rsync deployment method instead:"
echo "[build]   Local:  npm run build"
echo "[build]   Sync:   rsync -avz --delete .next/ ubuntu:~/projects/chs-spots/.next/"
echo "[build]   Server: pm2 restart chs-spots"
exit 1
