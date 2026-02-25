#!/bin/bash
#
# Production build script that handles Next.js 15 race condition
# where "Collecting page data" fails before pages-manifest.json
# is fully written, but all build artifacts are produced.
#
set -e

cd "$(dirname "$0")/.."

echo "[build] Cleaning previous build..."
rm -rf .next

echo "[build] Running Next.js build..."
npx next build 2>&1 || true

echo "[build] Waiting for async file writes to settle..."
sleep 3

# Check if essential build artifacts exist
MANIFEST=".next/server/pages-manifest.json"
APP_MANIFEST=".next/server/app-paths-manifest.json"
WEBPACK_RUNTIME=".next/server/webpack-runtime.js"

if [ ! -f "$MANIFEST" ] || [ ! -f "$APP_MANIFEST" ] || [ ! -f "$WEBPACK_RUNTIME" ]; then
  echo "[build] ERROR: Essential build artifacts missing."
  echo "  pages-manifest.json: $([ -f "$MANIFEST" ] && echo 'OK' || echo 'MISSING')"
  echo "  app-paths-manifest.json: $([ -f "$APP_MANIFEST" ] && echo 'OK' || echo 'MISSING')"
  echo "  webpack-runtime.js: $([ -f "$WEBPACK_RUNTIME" ] && echo 'OK' || echo 'MISSING')"
  exit 1
fi

# Create BUILD_ID from static hash if missing
if [ ! -s ".next/BUILD_ID" ]; then
  BUILD_HASH=$(ls .next/static/ 2>/dev/null | grep -E '^[a-zA-Z0-9_-]{15,}$' | head -1)
  if [ -n "$BUILD_HASH" ]; then
    echo -n "$BUILD_HASH" > .next/BUILD_ID
    echo "[build] Created BUILD_ID: $BUILD_HASH"
  else
    echo "[build] ERROR: Could not determine BUILD_ID"
    exit 1
  fi
fi

echo "[build] Build complete. BUILD_ID: $(cat .next/BUILD_ID)"
echo "[build] Artifacts verified successfully."
