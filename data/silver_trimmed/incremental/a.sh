for f in $(ls *.json | head -n 20); do
  cp "$f" "../debug-copies/incremental-$f"
  cp "../all/$f"      "../debug-copies/all-$f"      2>/dev/null || true
  cp "../previous/$f" "../debug-copies/previous-$f" 2>/dev/null || true
done
