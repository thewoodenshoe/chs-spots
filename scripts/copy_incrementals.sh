#!/usr/bin/env bash
# scripts/copy_incrementals.sh

TARGET="$HOME/test_results"
mkdir -p "$TARGET" || { echo "Failed to create $TARGET"; exit 1; }

echo "Copying files from data/silver_merged/incremental/ to $TARGET"
echo "With prefixes: incremental-, all-, previous-"
echo ""

# Robust way to get project root (works when sourced or executed)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." &> /dev/null && pwd )"

cd "$PROJECT_ROOT" || { echo "Failed to cd to project root"; exit 1; }

count=0
for file in $(ls -t data/silver_merged/incremental/*.json 2>/dev/null | head -n 20); do
    base=$(basename "$file")

    # Copy incremental
    cp -v "$file" "$TARGET/incremental-$base" 2>/dev/null

    # Copy all/
    all_file="data/silver_merged/all/$base"
    if [[ -f "$all_file" ]]; then
        cp -v "$all_file" "$TARGET/all-$base"
    else
        echo "  (no match in all/ for $base)"
    fi

    # Copy previous/
    prev_file="data/silver_merged/previous/$base"
    if [[ -f "$prev_file" ]]; then
        cp -v "$prev_file" "$TARGET/previous-$base"
    else
        echo "  (no match in previous/ for $base)"
    fi

    echo ""
    ((count++))
done

if [ $count -eq 0 ]; then
    echo "No .json files found in data/silver_merged/incremental/"
fi

echo "Done. Copied $count triplets."
echo "Check: cd $TARGET && ls -l"
echo "Tip: zip -r ../incremental-triplets.zip *.json"
