# Happy Hour Pipeline

## Overview

The happy hour extraction pipeline is now split into simple, focused steps:

1. **download-raw-html.js** - Downloads raw, untouched HTML
2. **merge-raw-files.js** - Merges raw files per venue
3. **filter-happy-hour.js** - Filters venues with "happy hour" text
4. **extract-happy-hours.js** - LLM extraction (bulk + incremental)
5. **create-spots.js** - Generate spots.json (coming soon)

## Data Structure

```
data/
├── raw/                    # Raw HTML files (untouched)
│   └── <venue-id>/
│       ├── <hash>.html     # Individual HTML files
│       └── metadata.json   # URL to hash mapping
├── silver_merged/          # Merged JSON per venue
│   └── <venue-id>.json     # All pages combined with metadata
├── silver_matched/         # Only venues with "happy hour"
│   └── <venue-id>.json     # Copied from silver_merged if matched
└── gold/                   # LLM extracted structured data
    ├── <venue-id>.json     # Extracted happy hour data per venue
    ├── .bulk-complete      # Flag: Bulk extraction done
    ├── bulk-input.json     # For manual Grok UI extraction
    └── bulk-results.json   # Results from manual Grok UI
```

## Usage

### Step 1: Download Raw HTML
```bash
node scripts/download-raw-html.js [area-filter]
```

Downloads raw HTML from venue websites and subpages to `data/raw/`.

### Step 2: Merge Raw Files
```bash
node scripts/merge-raw-files.js
```

Merges all raw HTML files per venue into single JSON files in `data/silver_merged/`.

### Step 3: Filter Happy Hour
```bash
node scripts/filter-happy-hour.js
```

Filters merged files that contain "happy hour" text to `data/silver_matched/`.

### Step 4: Extract Happy Hours (LLM)

**One-Time Bulk Extraction (Manual):**

```bash
# 1. Prepare bulk data for manual Grok UI extraction
npm run extract:bulk:prepare
# Creates: data/gold/bulk-input.json

# 2. Manual: Copy-paste into Grok UI, extract, save results to:
# data/gold/bulk-results.json

# 3. Process bulk results
npm run extract:bulk:process
# Creates: data/gold/<venue-id>.json for each venue
# Creates: data/gold/.bulk-complete flag
```

**Incremental Extraction (Automatic Daily):**

```bash
npm run extract:incremental
# or
node scripts/extract-happy-hours.js --incremental
```

Extracts structured happy hour data using LLM API.
- Input: `data/silver_matched/`
- Output: `data/gold/<venue-id>.json`
- Only processes new/changed venues (compares timestamps)
- Requires `.bulk-complete` flag to exist (bulk must be done first)

**Force Re-extraction (All Venues):**

```bash
node scripts/extract-happy-hours.js --force
```

### Step 5: Create Spots (Coming Soon)

```bash
node scripts/create-spots.js
```

Creates `spots.json` entries from extracted data.
- Input: `data/gold/`
- Output: `data/spots.json`

## Next Steps

After extraction, you can:
- Review extracted data in `data/gold/`
- Create spots.json entries
- Update frontend to display happy hour spots
