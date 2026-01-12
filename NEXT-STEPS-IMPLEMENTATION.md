# Next Steps Implementation Summary

## ✅ Completed

### 1. Diff Comparison Script (`compare-raw-files.js`)
- Compares `raw/previous/` vs `raw/` 
- Identifies changed venues (new, modified, removed, unchanged)
- Saves change report to `data/raw/changes-YYYY-MM-DD.json`
- Can be used to process only changed venues in downstream steps

## 📝 In Progress

### 2. Extraction Script (`extract-happy-hours.js`)
**Status**: Architecture designed, needs implementation

**Purpose**: Extract structured happy hour data from `silver_matched/` files

**Input**: `data/silver_matched/<venue-id>.json` (files with "happy hour" text)

**Output**: `data/gold/<venue-id>.json` (extracted structured data)

**Approach**:
- Rule-based extraction first (patterns, regex)
- LLM refinement for low-confidence cases (future)
- Accept partial data (create spots even with incomplete info)

**Structure**:
```json
{
  "venueId": "...",
  "venueName": "...",
  "extractedAt": "2026-01-12T...",
  "happyHour": {
    "found": true,
    "times": "4pm-7pm",
    "days": "Monday-Friday",
    "specials": ["$5 beers", "Half price apps"],
    "source": "http://..."
  },
  "confidence": 0.95,
  "needsLLM": false
}
```

### 3. Spot Creation Script (`create-spots.js`)
**Status**: Architecture designed, needs implementation

**Purpose**: Create `spots.json` entries from extracted data

**Input**: `data/gold/<venue-id>.json` (extracted structured data)

**Output**: `data/spots.json` (formatted spots)

**Process**:
1. Load extracted data from `gold/`
2. Match to `venues.json` by venueId
3. Create spot entries with formatted descriptions
4. Handle missing data gracefully
5. Avoid duplicates

**Spot Format**:
```json
{
  "id": 1,
  "lat": 32.xxx,
  "lng": -79.xxx,
  "title": "Venue Name",
  "description": "Happy Hour: Mon-Fri 4pm-7pm. $5 beers, Half price apps. — source: website.com",
  "type": "Happy Hour"
}
```

## 🔄 Pipeline Flow

```
1. download-raw-html.js
   ↓ (raw HTML files)
   
2. merge-raw-files.js  
   ↓ (merged JSON per venue)
   
3. filter-happy-hour.js
   ↓ (only venues with "happy hour" text)
   
4. extract-happy-hours.js (NEXT)
   ↓ (structured extracted data)
   
5. create-spots.js (NEXT)
   ↓ (spots.json entries)
```

## 🎯 Implementation Priority

1. ✅ Diff comparison script (completed)
2. ⏭️ Extraction script (next)
3. ⏭️ Spot creation script (next)
4. ⏭️ Unit tests (next)
5. ⏭️ Documentation & commit (final)

## 📊 Expected Results

- **164 venues** with "happy hour" text (from `silver_matched/`)
- **~100-120 venues** with rule-based extraction (60-70% success)
- **~40-60 venues** needing LLM refinement (30-40%)
- **~100-150 spots** created (vs 3 currently)
