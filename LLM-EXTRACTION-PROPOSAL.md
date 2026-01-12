# LLM Extraction Architecture - Final Proposal

## ✅ Design: Bulk vs Incremental

**Yes, we account for this!** Here's how:

## Folder Structure

```
data/
├── raw/              # Step 1: Raw HTML
├── silver_merged/    # Step 2: Merged per venue
├── silver_matched/   # Step 3: Contains "happy hour" (164 venues)
└── gold/             # Step 4: LLM Extracted (final)
    ├── <venue-id>.json       # Extracted data per venue
    ├── .bulk-complete        # Flag: Bulk extraction done
    ├── bulk-input.json       # For manual Grok UI
    └── bulk-results.json     # Results from manual Grok UI
```

## Detection Logic

**Incremental detection uses file existence + timestamps:**

1. **New Venue**: `gold/<venue-id>.json` doesn't exist
2. **Changed Venue**: `silver_matched/<venue-id>.json` mtime > `gold/<venue-id>.json` mtime
3. **Unchanged**: Already extracted and timestamp same/newer → Skip

## Workflow

### Phase 1: Bulk (One-Time Manual)

1. **Prepare**: `node scripts/prepare-bulk-llm-extraction.js`
   - Reads all 164 venues from `silver_matched/`
   - Creates `data/gold/bulk-input.json`

2. **Manual Extraction**: Copy-paste into Grok UI
   - Extract happy hour data
   - Save results to `data/gold/bulk-results.json`

3. **Process**: `node scripts/process-bulk-llm-results.js`
   - Creates `data/gold/<venue-id>.json` for each venue
   - Creates `data/gold/.bulk-complete` flag

**Result**: All 164 venues have `gold/<venue-id>.json` files

### Phase 2: Incremental (Automatic Daily)

**Daily run**: `node scripts/extract-happy-hours.js --incremental`

**Logic**:
- Checks `.bulk-complete` exists (must complete bulk first)
- For each venue in `silver_matched/`:
  - If `gold/<venue-id>.json` doesn't exist → **New** → Extract with LLM API
  - If `silver_matched` file newer than `gold` → **Changed** → Re-extract with LLM API
  - Otherwise → **Skip**

## Benefits

✅ **Simple**: File existence = extracted  
✅ **Automatic**: Timestamps detect changes  
✅ **Efficient**: Only processes new/changed  
✅ **Clear separation**: Bulk (manual) vs Incremental (API)  
✅ **No manifest**: No tracking file to maintain

## Example: Paul Stewart's Tavern

### Day 1: Bulk Extraction
- Venue in `silver_matched/`
- Bulk extraction → `gold/<venue-id>.json` created

### Day 2: Website Updated
- `silver_matched/<venue-id>.json` updated (newer mtime)
- Incremental run detects change
- Re-extracts with LLM API
- Updates `gold/<venue-id>.json`

