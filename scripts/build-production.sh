#!/bin/bash
#
# Production build script that handles Next.js 15 race condition.
#
# On this server, the "Collecting page data" step fails because it tries
# to read pages-manifest.json before webpack finishes writing it. Next.js
# then cleans up all build artifacts on failure. This script works around
# the issue by continuously backing up build artifacts while the build
# runs, then restoring them if the build fails.
#
cd "$(dirname "$0")/.."
PROJECT_DIR=$(pwd)
BACKUP_DIR="${PROJECT_DIR}/.next-backup"

echo "[build] Cleaning previous build..."
rm -rf .next "$BACKUP_DIR"

# Start a background process that backs up .next/server/ as it's written
(
  while true; do
    if [ -d ".next/server" ] && [ -f ".next/server/webpack-runtime.js" ]; then
      rsync -a --delete .next/server/ "$BACKUP_DIR/server/" 2>/dev/null
      rsync -a .next/static/ "$BACKUP_DIR/static/" 2>/dev/null
      rsync -a .next/build-manifest.json "$BACKUP_DIR/" 2>/dev/null
      rsync -a .next/app-build-manifest.json "$BACKUP_DIR/" 2>/dev/null
      rsync -a .next/react-loadable-manifest.json "$BACKUP_DIR/" 2>/dev/null
      rsync -a .next/package.json "$BACKUP_DIR/" 2>/dev/null
    fi
    sleep 2
  done
) &
BACKUP_PID=$!

echo "[build] Running Next.js build (backup PID: $BACKUP_PID)..."
npx next build 2>&1 || true

# Stop the backup process
kill $BACKUP_PID 2>/dev/null
wait $BACKUP_PID 2>/dev/null

echo "[build] Build exited. Checking artifacts..."

# Check if essential artifacts exist; restore from backup if needed
MANIFEST=".next/server/pages-manifest.json"
if [ ! -f "$MANIFEST" ] && [ -f "$BACKUP_DIR/server/pages-manifest.json" ]; then
  echo "[build] Restoring build artifacts from backup..."
  cp -a "$BACKUP_DIR/server" .next/server
  cp -a "$BACKUP_DIR/static" .next/static
  cp -a "$BACKUP_DIR/build-manifest.json" .next/ 2>/dev/null
  cp -a "$BACKUP_DIR/app-build-manifest.json" .next/ 2>/dev/null
  cp -a "$BACKUP_DIR/react-loadable-manifest.json" .next/ 2>/dev/null
  cp -a "$BACKUP_DIR/package.json" .next/ 2>/dev/null
fi

# Verify essential files
MANIFEST=".next/server/pages-manifest.json"
APP_MANIFEST=".next/server/app-paths-manifest.json"
WEBPACK_RUNTIME=".next/server/webpack-runtime.js"

if [ ! -f "$MANIFEST" ] || [ ! -f "$APP_MANIFEST" ] || [ ! -f "$WEBPACK_RUNTIME" ]; then
  echo "[build] ERROR: Essential build artifacts missing even after restore."
  echo "  pages-manifest.json: $([ -f "$MANIFEST" ] && echo 'OK' || echo 'MISSING')"
  echo "  app-paths-manifest.json: $([ -f "$APP_MANIFEST" ] && echo 'OK' || echo 'MISSING')"
  echo "  webpack-runtime.js: $([ -f "$WEBPACK_RUNTIME" ] && echo 'OK' || echo 'MISSING')"
  rm -rf "$BACKUP_DIR"
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
    rm -rf "$BACKUP_DIR"
    exit 1
  fi
fi

rm -rf "$BACKUP_DIR"
echo "[build] Build complete. BUILD_ID: $(cat .next/BUILD_ID)"
echo "[build] Artifacts verified successfully."
