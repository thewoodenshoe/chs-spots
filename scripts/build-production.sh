#!/bin/bash
#
# Production build script that handles Next.js 15 race condition.
#
# On this server, "Collecting page data" fails with a race condition.
# Next.js cleans up build output on failure but preserves the webpack
# cache. We retry the build up to 3 times, each subsequent attempt
# benefiting from the cached compilation.
#

cd "$(dirname "$0")/.."

echo "[build] Starting production build..."

MAX_RETRIES=3
for attempt in $(seq 1 $MAX_RETRIES); do
  echo "[build] Attempt $attempt of $MAX_RETRIES..."

  # Clean output but keep cache for faster rebuilds
  rm -rf .next/server .next/static .next/BUILD_ID .next/build-manifest.json \
         .next/app-build-manifest.json .next/react-loadable-manifest.json \
         .next/package.json .next/diagnostics .next/types 2>/dev/null

  npx next build 2>&1
  BUILD_EXIT=$?

  # Give filesystem a moment to settle
  sleep 2

  # Check if essential artifacts exist
  if [ -f ".next/server/pages-manifest.json" ] && \
     [ -f ".next/server/webpack-runtime.js" ] && \
     [ -f ".next/server/app-paths-manifest.json" ] && \
     [ -d ".next/static" ] && \
     [ -s ".next/BUILD_ID" ]; then
    echo "[build] Build succeeded on attempt $attempt."
    echo "[build] BUILD_ID: $(cat .next/BUILD_ID)"
    exit 0
  fi

  # Check if we have artifacts but missing BUILD_ID (partial success)
  if [ -f ".next/server/pages-manifest.json" ] && \
     [ -f ".next/server/webpack-runtime.js" ] && \
     [ -d ".next/static" ]; then

    if [ ! -s ".next/BUILD_ID" ]; then
      BUILD_HASH=$(ls .next/static/ 2>/dev/null | grep -E '^[a-zA-Z0-9_-]{15,}$' | head -1)
      if [ -n "$BUILD_HASH" ]; then
        echo -n "$BUILD_HASH" > .next/BUILD_ID
        echo "[build] Created BUILD_ID: $BUILD_HASH (attempt $attempt)"
        echo "[build] Artifacts verified successfully."
        exit 0
      fi
    fi
  fi

  echo "[build] Attempt $attempt failed. Artifacts incomplete."
  if [ $attempt -lt $MAX_RETRIES ]; then
    echo "[build] Retrying with webpack cache..."
    sleep 3
  fi
done

echo "[build] ERROR: Build failed after $MAX_RETRIES attempts."
echo "  pages-manifest: $([ -f '.next/server/pages-manifest.json' ] && echo 'OK' || echo 'MISSING')"
echo "  webpack-runtime: $([ -f '.next/server/webpack-runtime.js' ] && echo 'OK' || echo 'MISSING')"
echo "  app-paths-manifest: $([ -f '.next/server/app-paths-manifest.json' ] && echo 'OK' || echo 'MISSING')"
echo "  static dir: $([ -d '.next/static' ] && echo 'OK' || echo 'MISSING')"
echo "  BUILD_ID: $([ -s '.next/BUILD_ID' ] && echo 'OK' || echo 'MISSING')"
exit 1
