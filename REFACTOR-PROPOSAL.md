# Refactoring Proposal: Remove Raw Layer Comparison

## Current Flow (Problematic)
```
1. download-raw-html.js
   → raw/today/ (all 879 venues)

2. delta-raw-files.js ❌ REMOVE THIS STEP
   → Compares raw HTML (too sensitive to dynamic content)
   → raw/incremental/ (244 false positives)

3. merge-raw-files.js
   → Reads from raw/incremental/ (only 244 venues)
   → silver_merged/today/ + silver_merged/incremental/

4. trim-silver-html.js
   → Reads from silver_merged/incremental/ (only 244 venues)
   → silver_trimmed/today/

5. delta-trimmed-files.js
   → Compares normalized trimmed content (accurate)
   → silver_trimmed/incremental/ (real changes only)
```

## Proposed Flow (Fixed)
```
1. download-raw-html.js
   → raw/today/ (all 879 venues)
   → NO COMPARISON - just download everything

2. merge-raw-files.js ✅ PROCESS ALL
   → Reads from raw/today/ (ALL 879 venues)
   → silver_merged/today/ (ALL 879 venues)
   → NO incremental/ needed at this layer

3. trim-silver-html.js ✅ PROCESS ALL
   → Reads from silver_merged/today/ (ALL 879 venues)
   → silver_trimmed/today/ (ALL 879 venues)
   → NO incremental/ needed at this layer

4. delta-trimmed-files.js ✅ ONLY COMPARISON STEP
   → Compares silver_trimmed/today/ vs silver_trimmed/previous/
   → Uses normalized content hashes (removes timestamps, tracking, etc.)
   → silver_trimmed/incremental/ (only real changes, ~5-20 venues)
```

## Benefits
1. ✅ Eliminates 244 false positives at raw layer
2. ✅ Processes all venues through merge/trim (consistent data)
3. ✅ Only one comparison step (at trimmed layer where it matters)
4. ✅ More accurate change detection (normalized content)
5. ✅ Simpler pipeline logic

## Changes Required

### 1. run-incremental-pipeline.js
**Remove Step 1.5 (delta-raw-files.js)**
```javascript
// REMOVE THIS ENTIRE BLOCK:
// Delta comparison
console.log('\n🔍 Step 1.5: Delta Comparison (Raw HTML)');
updateConfigField('last_run_status', 'running_raw');
try {
  await runScript('delta-raw-files.js');
  updateConfigField('last_run_status', 'running_merged');
} catch (error) {
  // ...
}
```

### 2. merge-raw-files.js
**Change from incremental mode to full mode**

**Current (reads from raw/incremental/):**
```javascript
function getVenueRawFiles(venueId) {
  const RAW_INCREMENTAL_DIR = path.join(__dirname, '../data/raw/incremental');
  const venueDir = path.join(RAW_INCREMENTAL_DIR, venueId);
  // ...
}
```

**Proposed (reads from raw/today/):**
```javascript
function getVenueRawFiles(venueId) {
  // FULL MODE: Read from raw/today/ (all files)
  const venueDir = path.join(RAW_TODAY_DIR, venueId);
  if (!fs.existsSync(venueDir)) {
    return [];
  }
  
  const files = fs.readdirSync(venueDir).filter(f => f.endsWith('.html'));
  return files.map(file => {
    const filePath = path.join(venueDir, file);
    const stats = fs.statSync(filePath);
    return {
      file,
      filePath,
      modifiedAt: stats.mtime
    };
  });
}
```

**Remove incremental logic:**
```javascript
// REMOVE: needsUpdate() check (line 177)
// REMOVE: Writing to silver_merged/incremental/ (lines 222-227)
// KEEP: Writing to silver_merged/today/ (line 219)
```

**Change main loop:**
```javascript
// Current: Gets venues from raw/incremental/
// Proposed: Get ALL venues from raw/today/
const todayVenueDirs = fs.readdirSync(RAW_TODAY_DIR).filter(item => {
  const itemPath = path.join(RAW_TODAY_DIR, item);
  return fs.statSync(itemPath).isDirectory();
});
```

### 3. trim-silver-html.js
**Change from incremental mode to full mode**

**Current (reads from silver_merged/incremental/):**
```javascript
// Get venue files from silver_merged/incremental/ (incremental mode)
let venueFiles = [];
if (fs.existsSync(SILVER_MERGED_INCREMENTAL_DIR)) {
  venueFiles = fs.readdirSync(SILVER_MERGED_INCREMENTAL_DIR).filter(file => file.endsWith('.json'));
}
```

**Proposed (reads from silver_merged/today/):**
```javascript
// FULL MODE: Get ALL venue files from silver_merged/today/
let venueFiles = [];
if (fs.existsSync(SILVER_MERGED_TODAY_DIR)) {
  venueFiles = fs.readdirSync(SILVER_MERGED_TODAY_DIR).filter(file => file.endsWith('.json'));
}
```

**Update processVenueFile():**
```javascript
// Current: Reads from SILVER_MERGED_INCREMENTAL_DIR
const silverFilePath = path.join(SILVER_MERGED_INCREMENTAL_DIR, `${venueId}.json`);

// Proposed: Reads from SILVER_MERGED_TODAY_DIR
const silverFilePath = path.join(SILVER_MERGED_TODAY_DIR, `${venueId}.json`);
```

**Remove incremental skip logic:**
```javascript
// REMOVE: needsUpdate() check can stay (optimization)
// But process ALL files, not just incremental
```

### 4. delta-trimmed-files.js
**NO CHANGES NEEDED** - This is the only comparison step and it's correct.

### 5. Directory Structure
**After refactor:**
```
raw/
  today/          ← All downloaded HTML (879 venues)
  previous/       ← Yesterday's baseline (for reference only)
  incremental/    ← UNUSED (can be removed or kept empty)

silver_merged/
  today/          ← All merged JSON (879 venues)
  previous/       ← Yesterday's baseline (for reference only)
  incremental/    ← UNUSED (can be removed)

silver_trimmed/
  today/          ← All trimmed JSON (879 venues)
  previous/       ← Yesterday's baseline (for comparison)
  incremental/    ← Only changed files (~5-20 venues) ✅
```

## Implementation Steps

1. ✅ Update `run-incremental-pipeline.js` - Remove Step 1.5
2. ✅ Update `merge-raw-files.js` - Read from `raw/today/` instead of `raw/incremental/`
3. ✅ Update `trim-silver-html.js` - Read from `silver_merged/today/` instead of `silver_merged/incremental/`
4. ✅ Test with same-day rerun (should get ~0 changes)
5. ✅ Test with new day (should get ~5-20 real changes)

## Expected Results

**Same-day rerun:**
- Raw incremental: 0 (not used)
- Silver merged incremental: 0 (not used)
- Silver trimmed incremental: 0-5 (real changes only) ✅

**New day:**
- Raw incremental: 0 (not used)
- Silver merged incremental: 0 (not used)
- Silver trimmed incremental: 5-20 (real changes only) ✅
