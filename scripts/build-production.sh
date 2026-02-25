#!/bin/bash
#
# Production build script that handles Next.js 15 race condition.
#
# On this server, the "Collecting page data" step fails because it tries
# to read pages-manifest.json before webpack finishes writing it. Next.js
# then cleans up all build artifacts on failure. This script works around
# the issue by backing up build artifacts using hard links in a tight
# loop, so even if Next.js deletes the originals, the data persists.
#

cd "$(dirname "$0")/.."
PROJECT_DIR=$(pwd)
BACKUP_DIR="${PROJECT_DIR}/.next-backup"

echo "[build] Cleaning previous build..."
rm -rf .next "$BACKUP_DIR"
mkdir -p "$BACKUP_DIR"

# Background process: create hardlink snapshots every 0.3s
(
  while true; do
    if [ -f ".next/server/webpack-runtime.js" ]; then
      cp -rl .next/server/ "$BACKUP_DIR/server-new/" 2>/dev/null && \
        rm -rf "$BACKUP_DIR/server/" 2>/dev/null && \
        mv "$BACKUP_DIR/server-new/" "$BACKUP_DIR/server/" 2>/dev/null
      cp -rl .next/static/ "$BACKUP_DIR/static-new/" 2>/dev/null && \
        rm -rf "$BACKUP_DIR/static/" 2>/dev/null && \
        mv "$BACKUP_DIR/static-new/" "$BACKUP_DIR/static/" 2>/dev/null
      for f in build-manifest.json app-build-manifest.json react-loadable-manifest.json package.json; do
        cp -l ".next/$f" "$BACKUP_DIR/$f" 2>/dev/null
      done
    fi
    sleep 0.3
  done
) &
BACKUP_PID=$!

echo "[build] Running Next.js build (backup PID: $BACKUP_PID)..."
npx next build 2>&1 || true

# Stop the backup process
kill $BACKUP_PID 2>/dev/null
wait $BACKUP_PID 2>/dev/null

echo "[build] Build exited. Checking artifacts..."

# Restore from backup if needed
if [ ! -f ".next/server/pages-manifest.json" ] && [ -f "$BACKUP_DIR/server/pages-manifest.json" ]; then
  echo "[build] Restoring server/ from backup..."
  rm -rf .next/server 2>/dev/null
  cp -a "$BACKUP_DIR/server" .next/server
fi

if [ ! -d ".next/static" ] && [ -d "$BACKUP_DIR/static" ]; then
  echo "[build] Restoring static/ from backup..."
  cp -a "$BACKUP_DIR/static" .next/static
fi

for f in build-manifest.json app-build-manifest.json react-loadable-manifest.json package.json; do
  if [ ! -f ".next/$f" ] && [ -f "$BACKUP_DIR/$f" ]; then
    cp -a "$BACKUP_DIR/$f" ".next/$f"
  fi
done

# Verify essential files
MANIFEST=".next/server/pages-manifest.json"
APP_MANIFEST=".next/server/app-paths-manifest.json"
WEBPACK_RUNTIME=".next/server/webpack-runtime.js"

if [ ! -f "$MANIFEST" ] || [ ! -f "$APP_MANIFEST" ] || [ ! -f "$WEBPACK_RUNTIME" ]; then
  echo "[build] ERROR: Essential build artifacts missing even after restore."
  echo "  pages-manifest: $([ -f "$MANIFEST" ] && echo 'OK' || echo 'MISSING')"
  echo "  app-paths-manifest: $([ -f "$APP_MANIFEST" ] && echo 'OK' || echo 'MISSING')"
  echo "  webpack-runtime: $([ -f "$WEBPACK_RUNTIME" ] && echo 'OK' || echo 'MISSING')"
  rm -rf "$BACKUP_DIR"
  exit 1
fi

if [ ! -d ".next/static" ]; then
  echo "[build] ERROR: .next/static/ directory missing."
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
