# Analysis: Venue Area Misassignments

## Summary
After running `seed-venues.js` for all areas and validating venue assignments, **42 venues (4.6%)** were identified as potentially misassigned out of 913 total venues.

## Root Causes

### 1. **Ambiguous Street Names** (Most Common Issue)
Some streets span multiple areas, making address-based assignment unreliable:

- **Meeting Street**: Runs through both Downtown Charleston (lower numbers 1-400) and North Charleston (higher numbers 400+). The validation script incorrectly flagged 11 Downtown venues because "Meeting Street" was mapped to "North Charleston" in address keywords.

- **King Street**: Runs through Downtown Charleston (lower numbers 1-600) and West Ashley (higher numbers 1300+). 23 Mount Pleasant venues on King Street (400-600 range) are actually in Downtown Charleston based on coordinates, but were assigned to Mount Pleasant due to overlapping bounds.

- **East Bay Street**: Primarily Downtown Charleston, but was not in address keywords.

### 2. **Overlapping Geographic Bounds**
Mount Pleasant's bounds overlap significantly with Downtown Charleston, causing venues on King Street and East Bay Street to be incorrectly assigned to Mount Pleasant when they should be Downtown.

### 3. **Clements Ferry Road Extensions**
Clements Ferry Road extends beyond Daniel Island into North Charleston. Some venues on Clements Ferry Road are correctly in North Charleston (further north), but the validation script flagged them because "Clements Ferry" was mapped to "Daniel Island".

## Fixes Applied

### 1. **Removed Ambiguous Street Mappings**
- Removed "Meeting Street" from address keywords (relies on coordinates/bounds instead)
- Removed "Clements Ferry" from automatic address mapping (relies on zip code validation instead)

### 2. **Added Street Number-Based Logic**
- **King Street**: Added logic to check street numbers:
  - Numbers 1-600 → Downtown Charleston
  - Numbers 1300+ → West Ashley
  - Numbers 600-1300 → Rely on coordinates/bounds (ambiguous zone)

### 3. **Added Downtown Charleston Street Keywords**
- Added "East Bay Street" → Downtown Charleston

### 4. **Improved Priority Order**
The area assignment logic now follows this priority:
1. Google sublocality (most reliable)
2. Address string parsing (with street number logic for King Street)
3. Zip code matching (with bounds validation)
4. Bounds checking (last resort, sorted by area size)

## Expected Improvements

After applying these fixes and rerunning `seed-venues.js`:
- **King Street venues (400-600 range)** should be correctly assigned to Downtown Charleston instead of Mount Pleasant
- **East Bay Street venues** should be correctly assigned to Downtown Charleston
- **Meeting Street venues** will continue to be assigned correctly via coordinates (no false positives from address keywords)
- **Clements Ferry Road venues** will be assigned correctly via zip code validation (29492 = Daniel Island, others = North Charleston)

## Validation Results (Before Fixes)

- **Total venues**: 913
- **Misassigned**: 42 (4.6%)
- **Accuracy**: 95.4%

### Breakdown by Area:
- **Downtown Charleston**: 11 misassigned (mostly false positives from "Meeting Street" keyword)
- **Mount Pleasant**: 23 misassigned (King Street and East Bay Street venues)
- **North Charleston**: 4 misassigned (Clements Ferry Road false positives)
- **West Ashley**: 4 misassigned (King Street venues)

## Next Steps

1. ✅ Applied fixes to `extractAreaFromAddress` function
2. ⏳ Rerun `seed-venues.js` for all areas
3. ⏳ Re-validate venue assignments
4. ⏳ Re-run unit tests to ensure Daniel Island venues are still found
