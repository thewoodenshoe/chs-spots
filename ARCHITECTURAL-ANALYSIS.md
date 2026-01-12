# Architectural Analysis: Happy Hour Extraction Pipeline

## Current State

### The Problem
- **258 files** contain "happy hour" text (grep confirmed)
- **3 venues** extracted by LLM (1.2% success rate)
- **255 venues** with "happy hour" text but not extracted (98.8% failure rate)

### Current Architecture

```
1. Scraping (update-happy-hours.js)
   └─> Saves to data/scraped/<venue-id>.json
       └─> Contains: sources[], rawMatches[], urlPatterns[]

2. Pattern Scanning (scan-happy-hour-patterns.js)
   └─> Finds venues with "happy hour" text
       └─> Saves to happy-hour-pattern-matches.json (138 venues)

3. Bulk LLM Extraction (prepare-bulk-for-grok.js)
   └─> Prepares prompt with scraped content
       └─> User manually processes in Grok UI
           └─> Result: 3 venues extracted (2.2% success)

4. Rule-Based Extraction (extract-happy-hours-rule-based.js)
   └─> Only processes delta (changed) files
       └─> Requires explicit "happy hour" text + valid time patterns
           └─> Result: 0 venues extracted (too strict)
```

## Root Causes

### 1. LLM Extraction Issues
- **Too Conservative**: LLM only extracts when 100% certain of ALL fields (days, times, specials)
- **Large Context**: 90KB+ of scraped content per venue is overwhelming
- **No Partial Data**: Rejects venues with incomplete information
- **Prompt Issues**: May not be clear enough about accepting partial data

### 2. Rule-Based Extraction Issues
- **Delta-Only**: Only processes changed files (83 of 704), not all files
- **Too Strict**: Requires explicit "happy hour" text + valid time patterns
- **No Fallback**: If times can't be extracted, marks as "needsLLM" but doesn't create spot
- **Not Processing All Files**: Should process all 258 files with "happy hour" text

### 3. Architectural Gaps
- **No Hybrid Approach**: Rule-based and LLM are separate, not complementary
- **No Partial Data Acceptance**: System rejects venues with incomplete info
- **No Spot Creation**: Even if "happy hour" text exists, no spot is created without full extraction
- **Inefficient**: Processing same data multiple times through different systems

## Proposed Architecture

### New Hybrid Approach

```
┌─────────────────────────────────────────────────────────────┐
│ Phase 1: Rule-Based Extraction (ALL files with "happy hour")│
├─────────────────────────────────────────────────────────────┤
│ 1. Scan ALL scraped files for "happy hour" text (258 files) │
│ 2. Extract using rule-based patterns:                       │
│    - Days (Monday-Friday, Daily, etc.)                      │
│    - Times (4pm-7pm, etc.)                                  │
│    - Specials ($5 beers, etc.)                              │
│ 3. Classify confidence:                                      │
│    - High (0.8+): Has text + times + days                   │
│    - Medium (0.5-0.8): Has text + times OR days             │
│    - Low (0.3-0.5): Has text only                           │
│ 4. Create spots for ALL confidence levels                   │
│    - High: Full details                                     │
│    - Medium: Partial details                                │
│    - Low: "Happy hour available" (no details)                 │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Phase 2: LLM Refinement (Only for Low/Medium confidence)    │
├─────────────────────────────────────────────────────────────┤
│ 1. Process venues with confidence < 0.8                     │
│ 2. Use LLM to extract missing details                      │
│ 3. Update spots with refined information                    │
│ 4. Accept partial data - don't require all fields          │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Phase 3: Spot Creation                                      │
├─────────────────────────────────────────────────────────────┤
│ 1. Match extracted data with venues.json by venueId         │
│ 2. Create spots.json entries:                               │
│    - id: auto-increment                                      │
│    - lat/lng: from venue.geometry                            │
│    - title: venue.name                                       │
│    - description: formatted happy hour info                 │
│    - type: "Happy Hour"                                      │
│ 3. Format description based on available data:              │
│    - Full: "Happy Hour: Mon-Fri 4pm-7pm. $5 beers..."       │
│    - Partial: "Happy Hour: Mon-Fri 4pm-7pm"                │
│    - Minimal: "Happy hour available"                       │
└─────────────────────────────────────────────────────────────┘
```

## Implementation Plan

### Step 1: Fix Rule-Based Extraction
- **Process ALL files** with "happy hour" text (not just delta)
- **Accept partial data**: Create spots even if only text is found
- **Lower confidence threshold**: Accept 0.3+ confidence
- **Better time extraction**: Improve regex patterns
- **Better day extraction**: Improve day pattern matching

### Step 2: Create Unified Extraction Script
- **Single entry point**: `extract-happy-hours.js`
- **Process all 258 files** with "happy hour" text
- **Rule-based first**: Extract what we can with patterns
- **LLM second**: Only for low-confidence cases
- **Accept partial data**: Don't require all fields

### Step 3: Spot Creation Script
- **Match venues**: Link extracted data to venues.json
- **Create spots**: Generate spots.json entries
- **Format descriptions**: Based on available data
- **Handle missing data**: Gracefully handle incomplete info

### Step 4: Validation & Quality Control
- **Review high-confidence**: Spot-check rule-based extractions
- **Review low-confidence**: Prioritize LLM processing
- **Manual review queue**: For ambiguous cases

## Expected Results

### Before (Current)
- 3 venues extracted (1.2% of 258)
- 255 venues with "happy hour" text ignored
- No spots created for most venues

### After (Proposed)
- 258 venues processed (100% of files with "happy hour" text)
- ~150-200 venues with high/medium confidence (rule-based)
- ~50-100 venues with low confidence (LLM refinement)
- ~200-250 spots created (vs 3 currently)

## Key Principles

1. **Accept Partial Data**: If "happy hour" text exists, create a spot even if details are incomplete
2. **Rule-Based First**: Use patterns/regex before expensive LLM calls
3. **LLM for Refinement**: Only use LLM for low-confidence cases
4. **Process Everything**: Don't skip venues just because extraction is hard
5. **Graceful Degradation**: Better to have partial info than no info

## Next Steps

1. ✅ Analyze current architecture (this document)
2. ⏭️ Refactor rule-based extraction to process ALL files
3. ⏭️ Lower confidence thresholds and accept partial data
4. ⏭️ Create unified extraction script
5. ⏭️ Create spot creation script
6. ⏭️ Test on all 258 files
7. ⏭️ Review results and refine
