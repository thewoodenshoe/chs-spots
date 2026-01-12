# Happy Hour Pipeline

## Overview

The happy hour extraction pipeline is now split into simple, focused steps:

1. **download-raw-html.js** - Downloads raw, untouched HTML
2. **merge-raw-files.js** - Merges raw files per venue
3. **filter-happy-hour.js** - Filters venues with "happy hour" text

## Data Structure

```
data/
├── raw/                    # Raw HTML files (untouched)
│   └── <venue-id>/
│       ├── <hash>.html     # Individual HTML files
│       └── metadata.json   # URL to hash mapping
├── silver_merged/          # Merged JSON per venue
│   └── <venue-id>.json     # All pages combined with metadata
└── silver_matched/         # Only venues with "happy hour"
    └── <venue-id>.json     # Copied from silver_merged if matched
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

## Next Steps

After filtering, you can:
- Extract structured data from `data/silver_matched/`
- Create spots.json entries
- Use LLM for refinement if needed
