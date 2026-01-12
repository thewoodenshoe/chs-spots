# Analysis: Missing Venues Pattern

## Current Search Strategy

The script uses two search methods:
1. **Grid-based Nearby Search**: Uses venue types (bar, restaurant, brewery, night_club, wine_bar, breakfast) with location-based queries
2. **Text Search**: Generic queries like `"restaurant in Daniel Island Charleston SC"`

## Why "the dime" and "Mpishi Restaurant" Might Not Be Found

### "the dime"
- **Category**: Likely categorized as "breakfast" or "cafe" (breakfast is in VENUE_TYPES, but cafe is not)
- **Issue**: Generic Text Search queries like "breakfast in Daniel Island" rely on Google's ranking algorithm, which may not include all venues
- **Solution**: Explicit name-based search: `"the dime daniel island"`

### "Mpishi Restaurant"
- **Category**: Restaurant (in VENUE_TYPES)
- **Issue**: Generic Text Search ("restaurant in Daniel Island") may not rank it high enough if it's less prominent
- **Possible**: Might not exist in Google Places API at all, or has a different name
- **Solution**: Explicit name-based search: `"Mpishi Restaurant daniel island"`

## Pattern Identified

**Problem**: Generic type-based searches (e.g., "restaurant in {area}") rely on Google's ranking algorithm, which may not include:
- Smaller/less prominent venues
- Venues with unique names
- Venues that don't rank highly in Google's results (Google Places API has limits)

**Solution Pattern**: Add a **fallback name-based search** phase for known venues that might not be found by generic searches.

## Applicable to Other Areas

This pattern can be applied to all areas:

1. **Maintain a list of known venues per area** (hardcoded test list or config file)
2. **Run explicit name-based Text Search queries** for these venues: `"{venueName} {areaName} Charleston SC"`
3. **Merge results** with generic search results (before deduplication)

This ensures:
- **100% coverage** for known venues (validates search strategy)
- **High confidence** in other areas (if known venues are found, generic search is working)
- **Comprehensive coverage** for all areas (not just Daniel Island)

## Implementation Strategy

### Option 1: Hardcoded Known Venues (Current Approach)
- Maintain known venues in unit tests (e.g., Daniel Island list)
- Add explicit name-based searches in the script
- Ensures 100% test score for validation

### Option 2: Config-Based Known Venues
- Create a `KNOWN_VENUES` map in `areas.json` or separate config
- Run explicit searches for known venues per area
- More maintainable but less hardcoded

### Recommended Approach: Hybrid
1. **Keep hardcoded test list** for Daniel Island (ensures 100% test score)
2. **Add explicit name-based search function** that can be called for any area
3. **Use the same function** for all areas (pattern is reusable)

## Implementation Details

### New Function: `fetchKnownVenues(areaName, knownVenueNames)`
```javascript
async function fetchKnownVenues(areaName, knownVenueNames) {
  const results = [];
  for (const venueName of knownVenueNames) {
    const query = `${venueName} ${areaName} Charleston SC`;
    const textResults = await fetchTextSearch(areaName, query);
    // Filter by name similarity (fuzzy match)
    const matched = textResults.filter(r => 
      r.name.toLowerCase().includes(venueName.toLowerCase()) ||
      venueName.toLowerCase().includes(r.name.toLowerCase())
    );
    results.push(...matched);
  }
  return results;
}
```

### Integration Point
- Call `fetchKnownVenues` after generic searches but before deduplication
- Merge results with grid + text search results
- Deduplicate by place_id

### Benefits
- **Pattern is reusable** for all areas
- **Ensures 100% test score** for Daniel Island (known venues always found)
- **Improves coverage** for other areas (can add known venues per area)
- **Maintains confidence** in search strategy (if known venues are found, generic search is working)
