# Incremental LLM Extraction Workflow

After running the pipeline through `filter-happy-hour.js`, you need to manually extract happy hour data for new/changed venues using LLM.

## Step-by-Step Process

### 1. Prepare Incremental Venues for LLM

```bash
node scripts/prepare-incremental-llm-extraction.js
```

This script:
- Identifies venues in `silver_matched/` that are new or changed
- Checks against existing `gold/` files to see what needs extraction
- Creates `data/gold/incremental-input-YYYY-MM-DD.json` with formatted data

**Output:**
- `data/gold/incremental-input-YYYY-MM-DD.json` - Venues ready for LLM extraction

### 2. Manual LLM Extraction

1. Open `data/gold/incremental-input-YYYY-MM-DD.json`
2. Upload to Grok UI or ChatGPT UI
3. Use the same prompt format as bulk extraction (see `GROK-PROMPT.md`)
4. Extract happy hour information
5. Save results as `data/gold/incremental-results-YYYY-MM-DD.json`

**Expected output format:**
```json
[
  {
    "venueId": "ChIJ...",
    "venueName": "Venue Name",
    "happyHour": {
      "found": true,
      "times": "4pm-7pm",
      "days": "Monday-Friday",
      "specials": ["$5 beers"],
      "source": "https://example.com/menu",
      "confidence": 100
    }
  }
]
```

### 3. Process Incremental Results

```bash
node scripts/process-incremental-llm-results.js
```

Or with specific date:
```bash
node scripts/process-incremental-llm-results.js 2026-01-13
```

This script:
- Reads `data/gold/incremental-results-YYYY-MM-DD.json`
- Creates/updates individual `gold/<venue-id>.json` files
- Marks extraction method as `llm-incremental`

### 4. Create Spots

```bash
node scripts/create-spots.js
```

This updates `spots.json` with all venues that have `happyHour.found === true`.

## How to Identify Incremental Venues

The `prepare-incremental-llm-extraction.js` script automatically identifies:

1. **New venues**: Exist in `silver_matched/` but not in `gold/`
2. **Changed venues**: Exist in both but source file (`silver_matched/`) is newer than `gold/` file
3. **Already extracted**: Have valid `gold/` file with `happyHour.found === true` and source hasn't changed

The script outputs:
- Total venues needing extraction
- Breakdown by reason (new vs changed)
- Formatted JSON file ready for LLM upload

## Example Workflow

```bash
# 1. Run pipeline up to silver_matched
node scripts/download-raw-html.js
node scripts/merge-raw-files.js
node scripts/filter-happy-hour.js

# 2. Prepare incremental venues
node scripts/prepare-incremental-llm-extraction.js
# Output: data/gold/incremental-input-2026-01-13.json

# 3. Manual: Upload to Grok, extract, save as:
# data/gold/incremental-results-2026-01-13.json

# 4. Process results
node scripts/process-incremental-llm-results.js

# 5. Create spots
node scripts/create-spots.js
```

## Notes

- Bulk-extracted venues are preserved (not overwritten) unless source changed
- Only new/changed venues are included in incremental extraction
- The script automatically skips venues that don't need extraction
