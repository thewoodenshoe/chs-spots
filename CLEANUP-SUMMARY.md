# Cleanup Summary

## Removed Folders ✅

- `data/cache/` - Migrated to `data/raw/`
- `data/extracted/` - Deprecated (old extraction pipeline)
- `data/scraped/` - Deprecated (old scraping pipeline)

## Removed Files ✅

- `data/url-patterns.json` - Deprecated
- `data/restaurants-submenus.json` - Deprecated

## Archived Scripts ✅

Moved to `scripts/archive/`:
- `update-happy-hours.js` - Replaced by new pipeline
- `extract-happy-hours.js` - Deprecated
- `extract-happy-hours-rule-based.js` - Deprecated
- `extract-happy-hours-incremental.js` - Deprecated
- `prepare-bulk-for-grok.js` - Temporary script
- `scan-happy-hour-patterns.js` - Temporary script
- `combine-grok-results.js` - Temporary script
- `test-update-happy-hours.js` - Test script
- `test-rule-based-extraction.js` - Test script
- `RUN-UPDATE-HAPPY-HOURS.md` - Old documentation

## Active Pipeline

1. **data/raw/** - Raw HTML files (source of truth)
2. **data/silver_merged/** - Merged files per venue
3. **data/silver_matched/** - Venues with "happy hour" text

## Active Scripts

- `download-raw-html.js` - Step 1: Download raw HTML
- `merge-raw-files.js` - Step 2: Merge raw files
- `filter-happy-hour.js` - Step 3: Filter happy hour
- `migrate-cache-to-raw.js` - Migration script (one-time use)
- `seed-venues.js` - Venue discovery
- `seed-incremental.js` - Incremental venue updates
- `validate-venue-areas.js` - Area validation
- `fix-venue-assignments.js` - Fix area assignments

## Preserved

- `data/backup/` - Kept as requested
