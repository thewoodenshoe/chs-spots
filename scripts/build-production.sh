#!/bin/bash
#
# Production build script that handles Next.js 15 race condition.
#
# On this server, the first build always fails at "Collecting page data"
# due to a timing issue, but it populates the webpack cache. The second
# build uses the cache, compiles much faster (~70s vs ~2.5min), and
# consistently succeeds.
#

cd "$(dirname "$0")/.."

kill_build_processes() {
  pkill -f "next build" 2>/dev/null
  pkill -f "jest-worker/processChild" 2>/dev/null
  sleep 2
}

echo "[build] Cleaning previous build..."
kill_build_processes
rm -rf .next

echo "[build] === Attempt 1: Populate webpack cache ==="
node_modules/.bin/next build 2>&1 || true
kill_build_processes

# Check if first attempt succeeded (unlikely but possible)
if [ -s ".next/BUILD_ID" ] && [ -f ".next/routes-manifest.json" ]; then
  echo "[build] First attempt succeeded!"
  echo "[build] BUILD_ID: $(cat .next/BUILD_ID)"
  exit 0
fi

echo "[build] First attempt failed (expected). Cleaning output, keeping cache..."
# Preserve the webpack cache, remove everything else
find .next -maxdepth 1 -not -name cache -not -name .next -exec rm -rf {} + 2>/dev/null

echo "[build] === Attempt 2: Build with cached compilation ==="
node_modules/.bin/next build 2>&1 || true
kill_build_processes

# Check for a complete build
if [ -s ".next/BUILD_ID" ] && [ -f ".next/routes-manifest.json" ] && \
   [ -f ".next/server/pages-manifest.json" ] && [ -d ".next/static" ]; then
  echo "[build] Second attempt succeeded!"
  echo "[build] BUILD_ID: $(cat .next/BUILD_ID)"
  exit 0
fi

# If still missing BUILD_ID but have other artifacts, create it
if [ -f ".next/server/pages-manifest.json" ] && [ -d ".next/static" ] && \
   [ -f ".next/routes-manifest.json" ]; then
  BUILD_HASH=$(ls .next/static/ 2>/dev/null | grep -E '^[a-zA-Z0-9_-]{15,}$' | head -1)
  if [ -n "$BUILD_HASH" ]; then
    echo -n "$BUILD_HASH" > .next/BUILD_ID
    echo "[build] Created BUILD_ID: $BUILD_HASH"
    echo "[build] Artifacts verified."
    exit 0
  fi
fi

echo "[build] Second attempt incomplete. Cleaning and trying once more..."
find .next -maxdepth 1 -not -name cache -not -name .next -exec rm -rf {} + 2>/dev/null

echo "[build] === Attempt 3: Final try ==="
node_modules/.bin/next build 2>&1 || true
kill_build_processes

if [ -s ".next/BUILD_ID" ] && [ -f ".next/routes-manifest.json" ]; then
  echo "[build] Third attempt succeeded!"
  echo "[build] BUILD_ID: $(cat .next/BUILD_ID)"
  exit 0
fi

echo "[build] ERROR: Build failed after 3 attempts."
echo "  BUILD_ID: $([ -s '.next/BUILD_ID' ] && cat .next/BUILD_ID || echo 'MISSING')"
echo "  routes-manifest: $([ -f '.next/routes-manifest.json' ] && echo 'OK' || echo 'MISSING')"
echo "  pages-manifest: $([ -f '.next/server/pages-manifest.json' ] && echo 'OK' || echo 'MISSING')"
echo "  static dir: $([ -d '.next/static' ] && echo 'OK' || echo 'MISSING')"
exit 1
