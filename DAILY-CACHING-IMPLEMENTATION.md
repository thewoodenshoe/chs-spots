# Daily Caching Implementation

## Overview

The `download-raw-html.js` script now includes daily caching and previous day archiving to:
1. Prevent multiple downloads on the same day
2. Archive previous day's data for diff comparison
3. Track last download date

## Implementation Details

### Daily Detection

- **`.last-download` file**: Stores the last download date (YYYY-MM-DD format)
- **New Day Detection**: Compares today's date with `.last-download` file
- **If new day**: Archives current `raw/*` to `raw/previous/`

### File Caching

- **Today's Check**: Uses file modification time to check if file was downloaded today
- **Skip if Today**: If file exists and was modified today, skip download
- **Download if Not Today**: If file doesn't exist or wasn't modified today, download

### Archive Process

When a new day is detected:
1. Read `.last-download` to get previous date
2. Move all `raw/<venue-id>/` directories to `raw/previous/<venue-id>/`
3. Clear `raw/` (except `previous/` and `.last-download`)
4. Download all files fresh for today
5. Update `.last-download` with today's date

### Structure

```
data/raw/
├── .last-download          # Tracks last download date (YYYY-MM-DD)
├── previous/               # Previous day's archived data
│   └── <venue-id>/
│       ├── <hash>.html
│       └── metadata.json
└── <venue-id>/             # Current day's data
    ├── <hash>.html
    └── metadata.json
```

## Behavior

### Same Day (Multiple Runs)
- **First run**: Downloads all files
- **Second run**: Skips all files (already downloaded today)
- **Log**: "Using today's raw file for homepage/subpage"

### New Day
- **Archive**: Moves all `raw/<venue-id>/` to `raw/previous/<venue-id>/`
- **Download**: Downloads all files fresh
- **Update**: Updates `.last-download` to today's date
- **Log**: "New day detected", "Archived previous day's data"

## Example Flow

### Day 1 (2026-01-12)
```
1. Run script
2. No .last-download exists
3. Download all files
4. Create .last-download = "2026-01-12"
```

### Day 1 (2026-01-12) - Second Run
```
1. Run script
2. .last-download = "2026-01-12"
3. Today = "2026-01-12"
4. Same day, skip archive
5. Check files - all downloaded today
6. Skip all downloads
```

### Day 2 (2026-01-13)
```
1. Run script
2. .last-download = "2026-01-12"
3. Today = "2026-01-13"
4. New day detected!
5. Archive raw/* to raw/previous/*
6. Download all files fresh
7. Update .last-download = "2026-01-13"
```

## Diff Comparison

After downloading on a new day:
- Previous day's data is in `raw/previous/`
- Current day's data is in `raw/`
- Can compare files to detect changes
- Only changed files need re-processing

## Verification

✅ **Same Day Multiple Runs**: Files not re-downloaded  
✅ **New Day**: Previous day archived, fresh download  
✅ **File Modification Time**: Checks if file was downloaded today  
✅ **Last Download Tracking**: `.last-download` file updated
