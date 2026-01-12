# LLM Extraction Architecture - Bulk vs Incremental

## ✅ Current State

- **164 venues** in `data/silver_matched/` (contain "happy hour" text)
- All 164 need **initial LLM extraction** (one-time bulk)
- After bulk, only **incremental changes** need LLM (new venues or updated content)

## Proposed Folder Structure

```
data/
├── raw/                    # Step 1: Raw HTML (untouched)
│   ├── <venue-id>/
│   └── previous/          # Previous day's data
│
├── silver_merged/         # Step 2: Merged per venue
│   └── <venue-id>.json
│
├── silver_matched/        # Step 3: Contains "happy hour" text
│   └── <venue-id>.json    # 164 venues currently
│
└── gold/                  # Step 4: LLM Extracted (final structured data)
    ├── <venue-id>.json    # Extracted happy hour data per venue
    └── .bulk-complete     # Flag file (created after bulk extraction)
```

## Design Principles

### 1. **File Existence = Extraction Status**
- `data/gold/<venue-id>.json` exists → venue has been extracted
- `data/gold/<venue-id>.json` doesn't exist → venue needs extraction

### 2. **Timestamp Comparison for Changes**
Compare file modification times:
- `silver_matched/<venue-id>.json` (mtime) vs `gold/<venue-id>.json` (mtime)
- If silver is newer → content changed → needs re-extraction

### 3. **Bulk Completion Flag**
- `data/gold/.bulk-complete` - Created after bulk extraction is done
- Used to determine if we're in "bulk mode" or "incremental mode"

## Incremental Detection Logic

```javascript
function shouldExtract(silverMatchedPath, goldPath) {
  // Never extracted
  if (!fs.existsSync(goldPath)) {
    return 'new';
  }
  
  // Compare timestamps
  const silverStats = fs.statSync(silverMatchedPath);
  const goldStats = fs.statSync(goldPath);
  
  // Silver file newer = content changed
  if (silverStats.mtime > goldStats.mtime) {
    return 'changed';
  }
  
  // Already extracted and unchanged
  return 'skip';
}
```

## Workflow

### Phase 1: One-Time Bulk Extraction (Manual)

**Step 1: Prepare Bulk Data**
```bash
node scripts/prepare-bulk-llm-extraction.js
```
- Reads all `data/silver_matched/*.json` (164 venues)
- Formats for manual copy-paste into Grok UI
- Outputs: `data/gold/bulk-input.json`

**Step 2: Manual Extraction in Grok UI**
- Copy-paste `bulk-input.json` content
- Get JSON results back
- Save to: `data/gold/bulk-results.json`

**Step 3: Process Bulk Results**
```bash
node scripts/process-bulk-llm-results.js
```
- Reads `data/gold/bulk-results.json`
- Creates `data/gold/<venue-id>.json` for each venue
- Creates `data/gold/.bulk-complete` flag file

**Result:** All 164 venues now have `data/gold/<venue-id>.json` files

### Phase 2: Incremental Extraction (Automatic)

**Daily Run:**
```bash
node scripts/extract-happy-hours.js --incremental
```

**Script Logic:**
1. Check if `.bulk-complete` exists
   - If not → error (bulk extraction must be done first)
2. Load all venues from `silver_matched/`
3. For each venue:
   - Check if `gold/<venue-id>.json` exists
   - If not → **New venue** → Extract with LLM API
   - If exists → Compare timestamps:
     - `silver_matched` newer → **Changed** → Re-extract with LLM API
     - `gold` newer or same → **Unchanged** → Skip

## Proposed Scripts

### 1. `scripts/prepare-bulk-llm-extraction.js`
**Purpose**: Prepare all silver_matched files for manual Grok UI extraction

**Output**: `data/gold/bulk-input.json`
```json
{
  "total": 164,
  "venues": [
    {
      "venueId": "ChIJ...",
      "venueName": "...",
      "html": "...",  // Combined HTML from all pages
      "url": "..."
    }
  ]
}
```

### 2. `scripts/process-bulk-llm-results.js`
**Purpose**: Process manual Grok UI results into individual gold files

**Input**: `data/gold/bulk-results.json` (from manual extraction)
**Output**: `data/gold/<venue-id>.json` (one per venue)
**Also creates**: `data/gold/.bulk-complete`

### 3. `scripts/extract-happy-hours.js`
**Purpose**: Incremental LLM extraction for new/changed venues

**Modes:**
- `--incremental` (default): Only process new/changed venues
- `--force`: Re-extract all venues (use with caution)

**Logic:**
```javascript
// Check bulk completion
if (!fs.existsSync(path.join(GOLD_DIR, '.bulk-complete'))) {
  log('❌ Bulk extraction not completed. Run prepare-bulk-llm-extraction.js first.');
  process.exit(1);
}

// Find venues needing extraction
const needsExtraction = [];
for (const venueId of silverMatchedVenues) {
  const status = shouldExtract(silverMatchedPath, goldPath);
  if (status === 'new' || status === 'changed') {
    needsExtraction.push({ venueId, status });
  }
}

// Extract only new/changed venues
for (const { venueId, status } of needsExtraction) {
  await extractWithLLM(venueId);
}
```

## Gold File Structure

### `data/gold/<venue-id>.json`
```json
{
  "venueId": "ChIJ...",
  "venueName": "Paul Stewart's Tavern",
  "extractedAt": "2026-01-12T10:00:00.000Z",
  "extractionMethod": "llm-bulk",  // or "llm-incremental", "rule-based"
  "sourceHash": "abc123...",       // Hash of source silver_matched content
  "sourceModifiedAt": "2026-01-12T10:00:00.000Z",
  "happyHour": {
    "found": true,
    "times": "Monday-Friday 4pm-7pm",
    "days": "Monday-Friday",
    "specials": ["$2 off all drinks"],
    "source": "https://example.com",
    "confidence": 0.95
  },
  "needsLLM": false
}
```

## Benefits of This Approach

1. ✅ **Simple Detection**: File existence = extracted
2. ✅ **Automatic Change Detection**: Timestamps handle updates
3. ✅ **Clear Separation**: Bulk (manual) vs Incremental (automatic)
4. ✅ **No Tracking Files**: No manifest to maintain (except `.bulk-complete` flag)
5. ✅ **Idempotent**: Can re-run safely (only processes what's needed)

## Daily Run Flow

```
1. download-raw-html.js
   ↓ Downloads/updates raw HTML

2. merge-raw-files.js
   ↓ Merges updated venues

3. filter-happy-hour.js
   ↓ Filters venues with "happy hour"

4. extract-happy-hours.js --incremental
   ↓ Only extracts new/changed venues
   ↓ Compares silver_matched vs gold timestamps
   ↓ Uses LLM API only for new/changed

5. create-spots.js
   ↓ Creates spots.json from gold/
```

## Example: Paul Stewart's Tavern Scenario

### Day 1: Bulk Extraction (Manual)
- Venue in `silver_matched/` but no happy hour
- Bulk extraction creates `gold/<venue-id>.json` with `happyHour.found: false`

### Day 2: Website Updated
- `download-raw-html.js` downloads new content
- `merge-raw-files.js` updates `silver_merged/`
- `filter-happy-hour.js` finds happy hour → updates `silver_matched/`
- `extract-happy-hours.js --incremental`:
  - Compares timestamps: `silver_matched` is newer
  - Detects change → Extracts with LLM API
  - Updates `gold/<venue-id>.json` with happy hour data

## Implementation Status

✅ **Architecture Designed**  
⏭️ **Scripts to Implement**:
- `prepare-bulk-llm-extraction.js`
- `process-bulk-llm-results.js`
- `extract-happy-hours.js` (incremental mode)

## Testing Strategy

### Unit Test: Bulk vs Incremental
```javascript
// Test that bulk extraction creates all gold files
// Test that incremental only processes new/changed
// Test that unchanged venues are skipped
```

### Test Data: Paul Stewart's Tavern
- Day 1: No happy hour → Bulk extraction → `gold/<venue-id>.json` with `found: false`
- Day 2: Happy hour added → Incremental detects change → Re-extracts → `gold/<venue-id>.json` updated
