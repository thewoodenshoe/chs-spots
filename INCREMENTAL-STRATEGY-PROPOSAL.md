# Incremental Venue Seeding Strategy Proposal

## Current Situation
- **Existing venues**: 913 (821 with websites = 90%)
- **New venues per month**: ~10 across all Charleston
- **Current approach**: Full search (7 areas × 5 types = 35 queries, ~1-2 minutes)
- **Problem**: Inefficient - queries all areas/types even when most venues already exist

## Strategy Options

### **Strategy 1: Text Search Only (Fastest) ⚡**

**Approach:**
- Use Google Places Text Search API with queries like "new restaurant [area]" or "opening [area]"
- Skip all Nearby Search queries
- Only fetch Place Details for venues not in existing set
- Use accurate area assignment from seed-venues.js

**Implementation:**
```javascript
// For each area, do 1-2 text searches:
- "new restaurant [area] Charleston SC"
- "new bar [area] Charleston SC"
// Then verify results against existing venues
```

**Pros:**
- ✅ **Fastest**: ~7-14 queries total (1 per area, maybe 2)
- ✅ **Targeted**: Focuses on "new" keywords
- ✅ **Low API cost**: Minimal requests
- ✅ **Quick execution**: ~30-60 seconds

**Cons:**
- ❌ **May miss venues**: Google doesn't reliably filter by "new" - might return old venues
- ❌ **Less comprehensive**: Text search may not catch all new venues
- ❌ **False positives**: "new" in name doesn't mean newly opened

**Estimated time**: 30-60 seconds
**API calls**: 7-14 queries

---

### **Strategy 2: Text Search + Targeted Nearby Search (Balanced) ⚖️**

**Approach:**
- Start with Text Search for each area (fast initial scan)
- For areas with potential new venues, do targeted Nearby Search
- Use smaller radius (50% of original) to reduce results
- Skip venues already in existing set early

**Implementation:**
```javascript
// Phase 1: Text Search (all areas)
for each area:
  - "restaurant [area] Charleston SC" (1 query)
  
// Phase 2: Targeted Nearby Search (only if new venues found)
if new venues found in area:
  - Nearby Search with smaller radius (50% of original)
```

**Pros:**
- ✅ **Balanced speed/coverage**: Faster than full search, more comprehensive than text-only
- ✅ **Smart filtering**: Only does expensive Nearby Search when needed
- ✅ **Good coverage**: Catches most new venues
- ✅ **Efficient**: Skips areas with no new venues

**Cons:**
- ❌ **Moderate API cost**: More queries than Strategy 1
- ❌ **Still some overhead**: Nearby Search is slower than Text Search

**Estimated time**: 2-4 minutes
**API calls**: 7-21 queries (7 text + up to 14 nearby)

---

### **Strategy 3: Optimized Full Search with Early Exit (Most Comprehensive) 🔍**

**Approach:**
- Use full search (like current) but with optimizations:
  - Skip venue types that rarely have new venues (e.g., skip "breakfast" if no new breakfast places in last 3 months)
  - Use smaller radius (75% of original) to reduce results
  - Early exit: Stop searching area if 10+ consecutive results are duplicates
  - Parallel processing: Search multiple areas simultaneously (with rate limiting)

**Implementation:**
```javascript
// Optimizations:
1. Track which venue types have new venues (skip types with 0 new in last 3 runs)
2. Reduce radius to 75% (fewer results to process)
3. Early exit: if 20 consecutive results are duplicates, skip rest
4. Batch process: 2-3 areas in parallel (with delays)
```

**Pros:**
- ✅ **Most comprehensive**: Catches all new venues
- ✅ **Reliable**: Same approach as seed-venues.js (proven)
- ✅ **Accurate**: Uses full area assignment logic
- ✅ **Configurable**: Can adjust which types to skip

**Cons:**
- ❌ **Slowest**: Still 20-30 queries
- ❌ **Higher API cost**: More requests
- ❌ **More complex**: Requires tracking which types to skip

**Estimated time**: 3-5 minutes
**API calls**: 20-30 queries

---

### **Strategy 4: Hybrid - Text Search + Known Venues Check (Recommended) ⭐**

**Approach:**
- Primary: Text Search for each area (1 query per area = 7 queries)
- Secondary: Check known venues list (if any exist for area)
- Only fetch Place Details for venues not in existing set
- Use accurate area assignment from seed-venues.js
- Optional: Weekly full scan (once per week, not nightly)

**Implementation:**
```javascript
// Nightly (fast):
for each area:
  1. Text Search: "restaurant [area] Charleston SC"
  2. Filter: Skip if place_id in existing venues
  3. Fetch details only for new venues
  4. Assign area using findAreaForVenue logic

// Weekly (comprehensive):
- Run full search like Strategy 3 (once per week)
```

**Pros:**
- ✅ **Fast nightly runs**: ~7 queries, ~1 minute
- ✅ **Comprehensive weekly**: Catches anything missed
- ✅ **Best of both worlds**: Speed + coverage
- ✅ **Low maintenance**: Simple to understand
- ✅ **Accurate**: Uses proven area assignment logic

**Cons:**
- ❌ **Two scripts**: Need to schedule both nightly and weekly
- ❌ **Slight delay**: New venues might take up to 7 days to appear (if missed by text search)

**Estimated time**: 
- Nightly: 1-2 minutes (7 queries)
- Weekly: 3-5 minutes (35 queries)

**API calls**: 
- Nightly: 7 queries
- Weekly: 35 queries

---

## Recommendation: **Strategy 4 (Hybrid)**

### Why Strategy 4?
1. **Efficiency**: Nightly runs are fast (~1 minute) - perfect for scheduled jobs
2. **Coverage**: Weekly full scan ensures nothing is missed
3. **Practical**: ~10 new venues/month means missing 1-2 for a few days is acceptable
4. **Maintainable**: Simple logic, easy to debug
5. **Cost-effective**: Minimal API usage (7 queries nightly vs 35)

### Implementation Details

**Nightly Script (`seed-incremental.js`):**
```javascript
1. Load existing venues (build Set of place_ids)
2. For each area (7 areas):
   - Text Search: "restaurant [area] Charleston SC"
   - Text Search: "bar [area] Charleston SC"  
   - Filter: Skip if place_id exists
   - For new venues:
     * Fetch Place Details (get address_components)
     * Use findAreaForVenue() for accurate assignment
     * Fetch website if missing
3. Append new venues to venues.json
```

**Weekly Script (`seed-incremental-full.js`):**
```javascript
- Same as current seed-incremental.js but:
  * Only run once per week
  * Can be same script with --full flag
```

### Key Optimizations:
1. **Early skip**: Check place_id before fetching details
2. **Reuse logic**: Import area assignment functions from seed-venues.js
3. **Smart filtering**: Skip venue types that haven't had new venues recently
4. **Batch processing**: Process multiple areas with controlled concurrency

---

## Comparison Table

| Strategy | Speed | Coverage | API Calls | Complexity | Recommendation |
|----------|-------|----------|-----------|------------|---------------|
| 1. Text Only | ⚡⚡⚡ | ⚠️ Medium | 7-14 | Low | Good for speed |
| 2. Text + Targeted | ⚡⚡ | ✅ Good | 7-21 | Medium | Balanced |
| 3. Optimized Full | ⚡ | ✅✅ Excellent | 20-30 | High | Most comprehensive |
| **4. Hybrid** | ⚡⚡⚡ | ✅✅ Excellent | 7 nightly + 35 weekly | **Low** | **⭐ Recommended** |

---

## Next Steps

If you approve Strategy 4, I will:
1. Refactor `seed-incremental.js` to use Text Search + accurate area assignment
2. Create `seed-incremental-full.js` (or add `--full` flag) for weekly comprehensive scans
3. Reuse area assignment logic from `seed-venues.js` (extract to shared module)
4. Add early skip logic (check place_id before API calls)
5. Add configuration for which venue types to search
6. Test with existing venues.json to ensure no duplicates

**Estimated implementation time**: 2-3 hours
**Testing time**: 1 hour (verify with existing data)
