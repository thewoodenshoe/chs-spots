# Charleston Local Spots

A crowdsourced map application for discovering and sharing local hotspots in Charleston, SC areas including Daniel Island, Mount Pleasant, James Island, Downtown Charleston, and Sullivan's Island.

## Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/thewoodenshoe/chs-spots.git
   cd chs-spots
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up environment variables:**
   Create `.env.local` file:
   ```bash
   NEXT_PUBLIC_GOOGLE_MAPS_KEY=your_google_maps_api_key_here
   ```

4. **Start the development server:**
   ```bash
   npm run dev
   ```

## Configuration

Configuration files are stored in `data/config/`:

- **`data/config/areas.json`** - Geographic area definitions (bounds, centers, zip codes)
- **`data/config/llm-instructions.txt`** - LLM prompt template for happy hour extraction
- **`data/config/submenu-keywords.json`** - Keywords used to discover submenu pages (menu, events, specials, etc.)

You can edit these files directly to adjust:
- Area boundaries and definitions
- LLM extraction instructions and prompts
- Website submenu discovery keywords

## Initial Run / Initial Load

Run these scripts **once** to set up the initial data:

1. **Create areas configuration:**
   ```bash
   node scripts/create-areas.js
   ```
   Creates `data/config/areas.json` with area definitions.

2. **Seed venues from Google Places (MANUAL ONLY):**
   
   ⚠️  **WARNING:** This script uses Google Maps API and can incur significant costs.
   
   Venues are now treated as **STATIC** - this script should only be run manually when:
   - You need to add new venues
   - You need to update existing venue data
   - You explicitly want to refresh venue information
   
   **Requirements:**
   - `--confirm` flag is **REQUIRED**
   - `GOOGLE_PLACES_ENABLED=true` environment variable is **REQUIRED**
   - `NEXT_PUBLIC_GOOGLE_MAPS_KEY` or `GOOGLE_PLACES_KEY` must be set in `.env.local`
   
   **Run:**
   ```bash
   GOOGLE_PLACES_ENABLED=true node scripts/seed-venues.js --confirm
   ```
   
   This discovers all venues and creates `data/reporting/venues.json`.
   
   **Cost Warning:** Google Maps API charges per request. A full venue seed can make thousands of API calls.
   Monitor your usage in the Google Cloud Console.

3. **Run the happy hour pipeline:**
   ```bash
   node scripts/download-raw-html.js
   node scripts/merge-raw-files.js
   ```
   Note: The `silver_matched` filtering layer has been removed. All data now flows through `silver_merged/all/`.
   The download script uses keywords from `data/config/submenu-keywords.json` to discover submenu pages.

4. **Extract happy hours (Grok API - bulk):**
   ```bash
   node scripts/extract-happy-hours.js
   ```
   This uses Grok API (xAI) to extract happy hour information from all venues.
   Requires `GROK_API_KEY` environment variable.
   Uses instructions from `data/config/llm-instructions.txt`.

5. **Create spots:**
   ```bash
   node scripts/create-spots.js
   ```

## Incremental Load / Daily Run

### Quick Start: Run Full Incremental Pipeline

The easiest way to run the daily pipeline is using the master script:

```bash
node scripts/run-incremental-pipeline.js
```

Or for a specific area:
```bash
node scripts/run-incremental-pipeline.js "Daniel Island"
```

This script automatically:
1. Downloads raw HTML (only on new days, or new venues on same day)
2. Runs delta comparison to find changes
3. Merges only changed raw files
4. Trims only changed merged files
5. Runs delta comparison on trimmed content (filters out dynamic noise)
6. Extracts happy hours with LLM (only for actual content changes)
7. Updates spots from gold data

**Note:** Venues are treated as **STATIC**. This pipeline does NOT call Google Maps API.
To add/update venues, manually run: `node scripts/seed-venues.js --confirm`

### Manual Step-by-Step (Advanced)

If you need to run steps individually:

1. **Download new/updated websites:**
   ```bash
   node scripts/download-raw-html.js
   ```
   Or for a specific area:
   ```bash
   node scripts/download-raw-html.js "Daniel Island"
   ```

2. **Delta comparison (raw HTML):**
   ```bash
   node scripts/delta-raw-files.js
   ```
   Compares `raw/all/` vs `raw/previous/` and populates `raw/incremental/` with only changed files.

3. **Merge raw files:**
   ```bash
   node scripts/merge-raw-files.js
   ```
   Only processes files in `raw/incremental/`.

4. **Trim silver HTML:**
   ```bash
   node scripts/trim-silver-html.js
   ```
   Only processes files in `silver_merged/incremental/`.

5. **Delta comparison (trimmed content):**
   ```bash
   node scripts/delta-trimmed-files.js
   ```
   Compares `silver_trimmed/all/` vs `silver_trimmed/previous/` using content hashes and populates `silver_trimmed/incremental/` with only actual content changes.

6. **Extract happy hours (Grok API - incremental):**
   ```bash
   node scripts/extract-happy-hours.js --incremental
   ```
   Only processes files in `silver_trimmed/incremental/`.

7. **Update spots:**
   ```bash
   node scripts/create-spots.js
   ```

## Quick Start (TLDR)

1. **Create Areas Config**: `node scripts/create-areas.js`
2. **Seed Venues**: `node scripts/seed-venues.js` (requires Google Maps API key)
3. **Download Raw HTML**: `node scripts/download-raw-html.js`
4. **Merge Raw Files**: `node scripts/merge-raw-files.js`
5. Extract Happy Hours (Grok LLM): `node scripts/extract-happy-hours.js` (bulk) or `npm run extract:incremental` (daily)

That's it! Run `npm run dev` to start the website.

## Features

- 🗺️ **Interactive Google Maps** with curated spots
- 🍹 **Activity Filtering** - Filter by Happy Hour, Fishing Spots, Sunset Spots, Pickleball Games, Bike Routes, Golf Cart Hacks, and more
- 📍 **Area Selection** - Browse spots by specific Charleston area
- ➕ **Add Your Own Spots** - Community-driven content
- 📱 **Mobile-First Design** - Responsive layout optimized for mobile devices
- 🔍 **Closest Nearby** - Find the nearest spot to your location
- 🔴 **Show All Venues** - Toggle to visualize all discovered venues as red markers (debugging/testing feature)
- ✏️ **Edit & Delete** - Manage your contributed spots

## Tech Stack

- **Next.js 16** - React framework
- **TypeScript** - Type safety
- **Google Maps API** - Interactive map with markers and clustering
- **Grok API (xAI)** - AI-powered happy hour extraction
- **Tailwind CSS** - Styling
- **Playwright** - End-to-end testing

## Getting Started

### Prerequisites

- Node.js 18+ (for built-in fetch support)
- Google Maps API Key

### Installation

1. Clone the repository:
```bash
git clone https://github.com/thewoodenshoe/chs-spots.git
cd chs-spots
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env.local` file:
```bash
NEXT_PUBLIC_GOOGLE_MAPS_KEY=your_google_maps_api_key_here
```

4. Run the development server:
```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser

## Data Pipeline

The application uses a multi-stage data pipeline to discover venues and extract happy hour information:

### Step 1: Create Areas Configuration

**Script:** `scripts/create-areas.js`

Creates `data/config/areas.json` with area definitions for all Charleston areas. This file must be created before running venue seeding scripts.

**Run:**
```bash
node scripts/create-areas.js
```

**Output:**
- `data/config/areas.json` - Area configuration with center coordinates, radius, bounds, and descriptions for 8 Charleston areas

---

### Step 2: Seed Venues from Google Places

**Script:** `scripts/seed-venues.js`

Fetches alcohol-serving venues from Google Places API for all areas defined in `areas.json`.

**Features:**
- Uses Google Places Nearby Search API with grid-based search (4 overlapping quadrants per area)
- Queries multiple venue types: bar, restaurant, brewery, night_club, wine_bar, breakfast
- Covers all areas defined in `areas.json` (Daniel Island, Mount Pleasant, James Island, Downtown Charleston, Sullivan's Island, North Charleston, West Ashley, Isle of Palms)
- **Parallel Processing**: 5 parallel workers for website fetching (faster execution)
- **Google Search Fallback**: Free Google search to find websites when Places API doesn't have them
- **Retry Logic**: Up to 3 retries with exponential backoff for failed API calls
- **Backup System**: Automatically creates timestamped backups in `data/backup/` before writing
- **Area Filtering**: Can run for specific areas only (preserves other areas)
- Fetches website details from Google Places Details API
- Deduplicates by place_id
- Appends to existing `/data/venues.json` without overwriting

**Requirements:**
- `data/config/areas.json` must exist (created in Step 1)
- `NEXT_PUBLIC_GOOGLE_MAPS_KEY` or `GOOGLE_PLACES_KEY` environment variable
- Optional: `GOOGLE_SEARCH_API_KEY` and `GOOGLE_SEARCH_ENGINE_ID` for website fallback (free tier available)

**Run:**
```bash
# Run for all areas
node scripts/seed-venues.js

# Run for specific area only (preserves other areas)
node scripts/seed-venues.js "Isle of Palms"
```

**Expected Runtime:**
- ~8-10 minutes for all areas (with parallel processing)
- Website success rate: ~89% (Places API) + ~6% (Google search fallback) = ~95% total

**Output:**
- `data/venues.json` - All discovered venues with name, address, coordinates, website, types, and area assignment
- `data/backup/venues-YYYY-MM-DDTHH-MM-SS.json` - Timestamped backup before each write

---

### Step 3: Download Raw HTML

**Script:** `scripts/download-raw-html.js`

Downloads raw HTML from venue websites and subpages. This is the first step in the happy hour extraction pipeline.

**Features:**
- Downloads raw, untouched HTML (source of truth)
- Downloads homepage + relevant subpages (keywords defined in `data/config/submenu-keywords.json`: menu, happy-hour, happyhour, hh, specials, events, bar, drinks, deals, promos, promotions, offers, happenings, whats-on, calendar, cocktails, wine, beer, location)
- **Daily Caching**: Per-venue daily cache (skips re-download if already downloaded today)
- **Previous Day Archive**: Archives previous day's downloads to `raw/previous/` for diff comparison
- **Directory Structure**: All downloads go to `raw/all/<venue-id>/`, previous day in `raw/previous/<venue-id>/`
- Handles multi-location sites (finds location-specific pages using 'location' keyword)

**Requirements:**
- `venues.json` must exist (created in Step 2)
- Venues with websites are processed

**Run:**
```bash
node scripts/download-raw-html.js
```

**Expected Runtime:**
- ~10-15 minutes for 741 venues (first run)
- ~1-2 minutes on subsequent runs the same day (uses cache)

**Output:**
- `data/raw/all/<venue-id>/` - Raw HTML files per venue (one directory per venue)
- `data/raw/all/<venue-id>/*.html` - Individual HTML files (hashed filenames)
- `data/raw/all/<venue-id>/metadata.json` - URL to hash mapping
- `data/raw/previous/<venue-id>/` - Previous day's downloads (for diff comparison)
- `data/raw/incremental/` - Incremental files (for new/changed venues)

---

### Step 4: Merge Raw Files

**Script:** `scripts/merge-raw-files.js`

Merges all raw HTML files per venue into single JSON files. This is the second step in the pipeline.

**Features:**
- Combines all HTML files per venue into a single merged JSON file
- Preserves metadata (URLs, download timestamps, hashes)
- One file per venue
- **Directory Structure**: All merged files go to `silver_merged/all/<venue-id>.json`, previous day in `silver_merged/previous/<venue-id>.json`

**Requirements:**
- `data/raw/all/` directory with raw HTML files (created in Step 3)

**Run:**
```bash
node scripts/merge-raw-files.js
```

**Expected Runtime:**
- ~1-2 minutes for 741 venues

**Output:**
- `data/silver_merged/all/<venue-id>.json` - Merged JSON file per venue (all pages combined with metadata)
- `data/silver_merged/previous/<venue-id>.json` - Previous day's merged files (for diff comparison)
- `data/silver_merged/incremental/` - Incremental files (for new/changed venues)

**Note:** The `silver_matched` filtering layer has been removed. All venues (with or without happy hour text) are now in `silver_merged/all/`. The HTML is cleaned in the next step before LLM extraction.

---

### Step 5: Trim Silver HTML

**Script:** `scripts/trim-silver-html.js`

Removes irrelevant HTML tags and extracts only visible text content. This step significantly reduces LLM input size (80-90% reduction) and improves accuracy by focusing on actual content.

**Features:**
- Removes non-visible elements: `<script>`, `<style>`, `<head>`, `<header>`, `<footer>`, `<nav>`, `<noscript>`, `<iframe>`
- Removes hidden elements: `display: none`, `hidden` attribute
- Extracts visible text while preserving basic structure (paragraphs, lists)
- Includes page title for context
- Calculates size reduction metrics

**Requirements:**
- `data/silver_merged/all/` directory with merged files (created in Step 4)

**Run:**
```bash
node scripts/trim-silver-html.js
```

Or for a specific area:
```bash
node scripts/trim-silver-html.js "Daniel Island"
```

**Expected Runtime:**
- ~1-2 minutes for 741 venues
- ~80-90% size reduction per file

**Output:**
- `data/silver_trimmed/all/<venue-id>.json` - Trimmed JSON file per venue (with `text` field instead of `html`)
- `data/silver_trimmed/previous/<venue-id>.json` - Previous day's trimmed files
- `data/silver_trimmed/incremental/` - Incremental files (for new/changed venues)

**Output Format:**
```json
{
  "venueId": "ChIJ...",
  "venueName": "Venue Name",
  "pages": [
    {
      "url": "https://example.com/menu",
      "text": "[Page Title: Menu]\n\nHappy Hour\nMonday-Friday 4pm-7pm\n$5 beers\nHalf off appetizers",
      "hash": "abc123",
      "downloadedAt": "2026-01-12T15:33:13.976Z",
      "trimmedAt": "2026-01-12T16:00:00.000Z",
      "sizeReduction": "85%"
    }
  ]
}
```

---

### Step 6: Extract Happy Hours (Grok LLM)

**Script:** `scripts/extract-happy-hours.js`

This script uses **Grok API (xAI)** to extract structured happy hour data from trimmed venue content. It processes all venues from `silver_trimmed/all/` (cleaned text) and uses AI to identify and extract happy hour information.

**Features:**
- **Automated LLM Extraction**: Uses Grok API for intelligent happy hour detection
- **Bulk Mode**: Processes all venues (one-time initial run)
- **Incremental Mode**: Only processes new or changed venues (daily updates)
- **Smart Detection**: Recognizes happy hours even with non-standard names (e.g., "Heavy's Hour")
- **Hash-based Change Detection**: Skips unchanged venues in incremental mode
- **Rate Limiting**: Built-in delays to respect API limits (1 second between calls)

**Note:** The LLM extraction processes all venues from `silver_trimmed/all/` (cleaned text, not raw HTML) and determines which ones have happy hour information based on the prompt. It differentiates happy hours from regular business hours.

#### Bulk Extraction (One-Time Initial Run)

This is typically done once to establish a baseline of happy hour data for all venues.

**Run:**
```bash
node scripts/extract-happy-hours.js
```
or
```bash
npm run extract:incremental  # (without --incremental flag, runs bulk)
```

This command:
- Processes **all** venues from `silver_trimmed/all/` (cleaned text)
- Calls Grok API for each venue to extract happy hour information
- Saves results to `data/gold/<venue-id>.json`
- Creates `.bulk-complete` flag when done (required for incremental mode)

**Expected Runtime:**
- ~12-15 minutes for 758 venues (with 1 second delay between API calls)

#### Incremental Extraction (Automated Daily)

This mode is designed for daily, automated updates, only processing new or changed venue data.

**Run:**
```bash
npm run extract:incremental
```
or
```bash
node scripts/extract-happy-hours.js --incremental
```

This command:
- Identifies new or updated venues by comparing content hashes from `silver_trimmed/all/`
- **Only processes changed venues** (significantly faster)
- Calls Grok API for changed venues only
- Requires `.bulk-complete` flag to exist (bulk extraction must be done first)

**Requirements:**
- `data/silver_trimmed/all/` directory with trimmed files (created in Step 4)
- `GROK_API_KEY` environment variable (required)
- `.bulk-complete` flag must exist (for incremental mode)

**Output:**
- `data/gold/<venue-id>.json` - Extracted structured happy hour data per venue (ALL venues: found:true AND found:false). Full representation of silver→gold transformation.
- `data/reporting/spots.json` - **Final output**: Only venues with `found:true`. Filtered from gold for frontend consumption.
- `data/reporting/venues.json` - Copy of `venues.json` for frontend consumption.
- `data/reporting/areas.json` - Copy of `data/config/areas.json` for frontend consumption.

**Architecture Note**: 
- `gold/` contains **ALL** venues (complete silver→gold representation)
- `reporting/` contains **only found:true** venues plus supporting data (venues.json, areas.json) for frontend
- This separation ensures full audit trail in `gold/` while keeping `reporting/` lightweight with only relevant spots

The gold files contain:
  - `found`: boolean (whether happy hour was found)
  - `times`: string (e.g., "4pm-7pm")
  - `days`: string (e.g., "Monday-Friday")
  - `specials`: array (e.g., ["$5 draft beers", "half-off appetizers"])
  - `source`: string (URL where happy hour was found)
  - `confidence`: number (1-100, LLM's confidence in extraction)
- `sourceHash`: MD5 hash of source content (for change detection)
- `processedAt`: ISO timestamp

**Note:** The script uses automated Grok API extraction. For one-time manual bulk extraction via Grok UI, you can use `npm run extract:bulk:prepare` and `npm run extract:bulk:process` if preferred.

---

### Step 7: Incremental Venue Updates (MANUAL ONLY - Optional)

**Script:** `scripts/seed-incremental.js --confirm`

⚠️  **WARNING:** This script uses Google Maps API and can incur significant costs.

Venues are now treated as **STATIC** - this script should only be run manually when you need to find new venues incrementally.

**Requirements:**
- `--confirm` flag is **REQUIRED**
- `GOOGLE_PLACES_ENABLED=true` environment variable is **REQUIRED**
- `NEXT_PUBLIC_GOOGLE_MAPS_KEY` or `GOOGLE_PLACES_KEY` must be set in `.env.local`

**Run:**
```bash
GOOGLE_PLACES_ENABLED=true node scripts/seed-incremental.js --confirm
```

**Original Features (now manual only):**
- Appends new venues from Google Places API (finds venues not already in `venues.json`)
- Uses efficient Strategy 3: Only searches `bar`, `restaurant`, `brewery` types
- Uses 50% reduced radius for faster execution
- Skips venues that already have websites
- Uses robust area assignment logic from `seed-venues.js`
- Safe to run multiple times (only adds new venues, doesn't overwrite)

**Additional Requirements:**
- `areas.json` and `venues.json` must exist (created in Steps 1-2)
- `NEXT_PUBLIC_GOOGLE_MAPS_KEY` or `GOOGLE_PLACES_KEY` must be set in `.env.local`

**Output:**
- `data/reporting/venues.json` - Updated with new venues and enriched website information

---

## Complete Pipeline Summary

```
1. create-areas.js        → data/config/areas.json
2. seed-venues.js         → data/venues.json
3. download-raw-html.js   → data/raw/all/<venue-id>/
4. merge-raw-files.js     → data/silver_merged/all/<venue-id>.json
5. trim-silver-html.js    → data/silver_trimmed/all/<venue-id>.json (cleaned text)
6. extract-happy-hours.js → data/gold/<venue-id>.json (uses LLM)
```

**Note:** The `silver_matched` filtering layer (Step 5) has been removed. All data flows through `silver_merged/all/`.

---

## Incremental Pipeline: 3-Day Scenario

The incremental pipeline is designed to minimize LLM API costs by only processing actual changes. Here's how it works across multiple days:

### Day 1: First Run Ever

**Initial State:**
- All folders are empty (`raw/all/`, `raw/previous/`, `raw/incremental/`)

**What Happens:**
1. `download-raw-html.js` detects no previous download date
2. Downloads all venues from `venues.json` → saves to `raw/all/`
3. Proceeds to silver layer (merge, trim)
4. LLM extraction processes all venues → saves to `gold/`

**Result:**
- `raw/all/` contains all downloaded HTML files
- `gold/` contains extracted happy hour data for all venues

**If you run again on Day 1:**
- `download-raw-html.js` detects same day → checks for new venues only
- If no new venues found → skips download entirely
- Pipeline stops early (no changes to process)

### Day 2: New Day, Full Download

**Initial State:**
- `raw/all/` contains Day 1's data
- `raw/previous/` is empty
- `raw/incremental/` is empty

**What Happens:**
1. `download-raw-html.js` detects new day (Day 2 vs Day 1)
2. **Archives Day 1:** Moves `raw/all/` → `raw/previous/` (clears `raw/previous/` first if needed)
3. **Downloads all venues again** → saves to `raw/all/`
4. `delta-raw-files.js` compares `raw/all/` (Day 2) vs `raw/previous/` (Day 1)
   - Finds changed/new files → copies to `raw/incremental/`
   - Unchanged files are NOT copied to incremental
5. `merge-raw-files.js` processes only `raw/incremental/` → saves to `silver_merged/all/` and `silver_merged/incremental/`
6. `trim-silver-html.js` processes only `silver_merged/incremental/` → saves to `silver_trimmed/all/`
7. `delta-trimmed-files.js` compares `silver_trimmed/all/` vs `silver_trimmed/previous/` using **trimmed content hashes**
   - Finds actual content changes (ignores dynamic HTML noise) → copies to `silver_trimmed/incremental/`
8. `extract-happy-hours.js --incremental` processes only `silver_trimmed/incremental/` → updates `gold/`
9. `create-spots.js` updates `reporting/spots.json` from `gold/`

**Result:**
- `raw/all/` contains Day 2's full download
- `raw/previous/` contains Day 1's archived data
- `raw/incremental/` contains only changed/new files from Day 2
- `silver_trimmed/incremental/` contains only venues with actual content changes
- `gold/` updated only for changed venues (minimizes LLM API costs)

**If you run again on Day 2:**
- `download-raw-html.js` detects same day → checks for new venues only
- If no new venues found → skips download
- Pipeline stops early (no changes to process)

### Day 3: New Day, Full Download Again

**Initial State:**
- `raw/all/` contains Day 2's data
- `raw/previous/` contains Day 1's data
- `raw/incremental/` is empty (cleared at start of pipeline)

**What Happens:**
1. `download-raw-html.js` detects new day (Day 3 vs Day 2)
2. **Archives Day 2:** Moves `raw/all/` → `raw/previous/` (Day 1's data is overwritten)
3. **Downloads all venues again** → saves to `raw/all/`
4. `delta-raw-files.js` compares `raw/all/` (Day 3) vs `raw/previous/` (Day 2)
   - Finds changed/new files → copies to `raw/incremental/`
5. Pipeline continues as in Day 2...

**Key Points:**
- **Same Day:** Only checks for new venues, skips if none found
- **New Day:** Full download, then delta comparison finds only changes
- **Raw Delta:** Compares raw HTML (may include dynamic content noise)
- **Trimmed Delta:** Compares trimmed text content (filters out noise, only actual changes)
- **LLM Only:** Processes venues with actual content changes (minimizes API costs)

### Why Two Delta Steps?

1. **Raw Delta (`delta-raw-files.js`):**
   - Compares raw HTML files
   - May flag many files as "changed" due to dynamic content (ads, timestamps, tracking scripts)
   - Used to filter which files proceed to silver layer

2. **Trimmed Delta (`delta-trimmed-files.js`):**
   - Compares trimmed text content (visible text only)
   - Filters out dynamic HTML noise
   - Only flags actual content changes
   - **This is the final filter before LLM extraction** (minimizes API costs)

**Example:**
- Raw HTML changes: 491 venues flagged (50% of total)
- Trimmed content changes: 5 venues flagged (0.5% of total)
- LLM processes: Only 5 venues (saves ~99% API costs)

**For a fresh setup, run these commands in order:**

```bash
# Step 1: Create areas configuration
node scripts/create-areas.js

# Step 2: Seed venues (requires Google Maps API key)
node scripts/seed-venues.js

# Step 3: Download raw HTML
node scripts/download-raw-html.js

# Step 4: Merge raw files
node scripts/merge-raw-files.js

# Step 5: Trim HTML (remove irrelevant tags, extract visible text)
node scripts/trim-silver-html.js

# Step 6: Extract happy hours (Grok API)
node scripts/extract-happy-hours.js  # Bulk (one-time initial run)
# ... then for daily updates ...
npm run extract:incremental  # Incremental (daily, only changed venues)

# Step 7: Run development server
npm run dev
```

---

## Data Files and Git Tracking

### Git Ignore Policy

**All JSON files in `data/` are ignored by git** (except configuration files). This includes:
- `data/venues.json` (generated by `seed-venues.js`)
- `data/reporting/*.json` (generated by pipeline scripts)
- `data/silver_trimmed/**/*.json` (generated by `trim-silver-html.js`)
- `data/silver_merged/**/*.json` (generated by `merge-raw-files.js`)
- `data/gold/**/*.json` (generated by `extract-happy-hours.js`)
- All other generated JSON files

**Exception:** Configuration files in `data/config/` are tracked:
- `data/config/areas.json` (should be tracked)
- `data/config/submenu-keywords.json` (should be tracked)

This policy ensures:
- Generated data files (which can be large and change frequently) are not committed
- Configuration files (which define system behavior) are version controlled
- Each developer/environment regenerates data files locally as needed

### Data File Formats

#### `/data/reporting/venues.json`
All alcohol-serving venues discovered from Google Places API.
```json
{
  "id": "place_id",
  "name": "Venue Name",
  "address": "123 Main St, Charleston",
  "lat": 32.845,
  "lng": -79.908,
  "website": "https://example.com",
  "types": ["restaurant", "bar"],
  "area": "Daniel Island"
}
```

#### `/data/reporting/spots.json`
Curated spots with activity information.
```json
{
  "title": "Venue Name",
  "lat": 32.845,
  "lng": -79.908,
  "description": "• Happy hour 4-6 PM daily — source: https://example.com/menu",
  "type": "Happy Hour",
  "area": "Daniel Island"
}
```

### Pipeline Data Structure

```
data/
├── config/                 # Configuration files
│   ├── areas.json         # Area configuration
│   ├── llm-instructions.txt # LLM prompt template
│   └── submenu-keywords.json # Submenu discovery keywords
├── venues.json             # All discovered venues
├── reporting/
│   ├── spots.json          # Curated spots with activities (only found:true)
│   ├── venues.json         # Copy of venues.json for frontend
│   └── areas.json          # Copy of areas.json for frontend
├── backup/                 # Timestamped backups
├── raw/                    # Raw HTML files (Step 3)
│   ├── all/                # All downloaded HTML files
│   │   └── <venue-id>/
│   │       ├── <hash>.html # Individual HTML files
│   │       └── metadata.json # URL to hash mapping
│   ├── previous/           # Previous day's downloads (for diff)
│   │   └── <venue-id>/
│   └── incremental/        # Incremental files (new/changed)
├── silver_merged/          # Merged JSON per venue (Step 4)
│   ├── all/                # All merged files
│   │   └── <venue-id>.json # All pages combined (with HTML)
│   ├── previous/           # Previous day's merged files
│   │   └── <venue-id>.json
│   └── incremental/        # Incremental files (new/changed)
├── silver_trimmed/         # Trimmed JSON per venue (Step 5)
│   ├── all/                # All trimmed files
│   │   └── <venue-id>.json # Cleaned text (no HTML tags)
│   ├── previous/           # Previous day's trimmed files
│   │   └── <venue-id>.json
│   └── incremental/        # Incremental files (new/changed)
└── gold/                   # LLM extracted structured data (Step 6)
    ├── <venue-id>.json     # Extracted happy hour data
    ├── .bulk-complete      # Flag: Bulk extraction done
    ├── bulk-input.json     # For manual Grok UI
    ├── bulk-results.json   # From manual Grok UI
    └── incremental-history/ # Archived incremental files
```

**Note:** The `silver_matched/` directory has been removed. All venues (with or without happy hour text) are in `silver_merged/all/`.

---

## Testing

### Run Unit Tests (Jest)
```bash
npm test
```

### Run Pipeline Validation Tests
```bash
npm run test:pipeline
```

### Run E2E Tests
```bash
npm run test:e2e
```

### Run E2E Tests with UI
```bash
npm run test:e2e:ui
```

**Test Coverage:**
- **Unit Tests**: 27+ test suites, 386+ test cases covering:
  - Pipeline scripts (download, merge, trim, delta comparison)
  - LLM extraction and processing
  - Data validation and structure checks
  - Safety checks for Google Places API scripts
  - React components and contexts
  - API routes
- **Integration Tests**: Pipeline integration test validates full pipeline flow with normalization (<20 delta threshold)
- **E2E Tests**: Playwright tests for map interactions, modals, and CRUD operations
- **All tests run automatically on push/PR via GitHub Actions CI workflow**

## Continuous Integration

The project uses GitHub Actions for CI/CD:

### CI Workflow (`.github/workflows/ci.yml`)

Runs on:
- Push to `main` or `feature/**` branches
- Pull requests to `main` or `feature/**` branches

**CI Steps:**
1. **Build & Test**: Runs Jest unit tests across Node.js 18.x and 20.x
2. **Pipeline Validation**: Validates data structures and pipeline logic
3. **Pipeline Integration Test**: Tests full pipeline flow with normalization (<20 delta threshold)
4. **Security Audit**: Runs `npm audit` to check for known vulnerabilities
5. **Linting**: Runs ESLint for code quality checks
6. **E2E Tests**: Runs Playwright end-to-end tests

**Note:** CD (Continuous Deployment) is not yet implemented. A commented template exists in `ci.yml` for future deployment setup.

---

## Project Structure

```
chs-spots/
├── data/                      # Data files
│   ├── config/               # Configuration files
│   │   ├── areas.json        # Area configuration
│   │   ├── llm-instructions.txt # LLM prompt template
│   │   └── submenu-keywords.json # Submenu discovery keywords
│   ├── venues.json           # All venues from Google Places
│   ├── spots.json            # Curated spots with activities
│   ├── backup/               # Timestamped backups
│   ├── raw/                  # Raw HTML files (all/, previous/, incremental/)
│   ├── silver_merged/        # Merged JSON per venue (all/, previous/, incremental/)
├── silver_trimmed/       # Trimmed JSON per venue (all/, previous/, incremental/)
└── gold/                 # LLM extracted structured data
├── scripts/                   # Node.js scripts
│   ├── create-areas.js       # Create areas.json
│   ├── seed-venues.js        # Seed venues (with parallel processing)
│   ├── seed-incremental.js   # Incremental venue updates
│   ├── download-raw-html.js  # Download raw HTML (pipeline Step 1)
│   ├── merge-raw-files.js    # Merge raw files (pipeline Step 2)
│   ├── trim-silver-html.js   # Trim HTML to extract visible text (pipeline Step 3)
│   ├── delta-raw-files.js    # Delta comparison for raw HTML (pipeline Step 1.5)
│   ├── delta-trimmed-files.js # Delta comparison for trimmed content (pipeline Step 3.5)
│   ├── extract-happy-hours.js # Extract structured data using Grok LLM API (pipeline Step 4)
│   ├── prepare-bulk-llm-extraction.js # Bulk LLM preparation (one-time manual)
│   ├── process-bulk-llm-results.js    # Process bulk LLM results (one-time manual)
│   ├── create-spots.js       # Create spots.json from gold data (pipeline Step 5)
│   ├── compare-raw-files.js  # Compare raw files for diffs
│   └── __tests__/            # Script unit tests
├── src/
│   ├── app/                  # Next.js app directory
│   │   ├── page.tsx         # Main page component
│   │   ├── layout.tsx       # Root layout with providers
│   │   └── api/             # API routes
│   │       ├── spots/       # Spots CRUD
│   │       ├── venues/      # Venues GET
│   │       └── areas/       # Areas config
│   ├── components/           # React components
│   │   ├── MapComponent.tsx # Google Maps integration
│   │   ├── VenuesToggle.tsx # Show/hide venues toggle
│   │   ├── FilterModal.tsx  # Activity selection
│   │   ├── SubmissionModal.tsx  # Add new spot
│   │   ├── EditSpotModal.tsx    # Edit/delete spot
│   │   ├── AreaSelector.tsx     # Area dropdown
│   │   └── ActivityChip.tsx     # Activity display
│   └── contexts/
│       ├── SpotsContext.tsx  # Global spots state
│       └── VenuesContext.tsx # Global venues state
└── e2e/                      # Playwright E2E tests
    └── app.spec.ts
```

---

## Manual Venue Refresh

### Overview

Venues are treated as **STATIC** by default. The pipeline does NOT call Google Maps API automatically.

To add or update venues, you must manually run the venue seeding scripts with explicit confirmation.

### Prerequisites

1. **Set up environment variables** in `.env.local`:
   ```bash
   NEXT_PUBLIC_GOOGLE_MAPS_KEY=your_google_maps_api_key_here
   # Optional: For website finding fallback
   GOOGLE_SEARCH_API_KEY=your_search_api_key_here
   GOOGLE_SEARCH_ENGINE_ID=your_search_engine_id_here
   ```

2. **Enable Google Places API** in your Google Cloud Console:
   - Enable "Places API"
   - Enable "Places API (New)" if available
   - Set up billing (API calls are charged per request)

### Full Venue Refresh

To refresh all venues from scratch:

```bash
GOOGLE_PLACES_ENABLED=true node scripts/seed-venues.js --confirm
```

**Cost Warning:** This can make thousands of API calls. Monitor usage in Google Cloud Console.

### Incremental Venue Update

To find only new venues (more cost-effective):

```bash
GOOGLE_PLACES_ENABLED=true node scripts/seed-incremental.js --confirm
```

**Safety Features:**
- Requires `--confirm` flag (prevents accidental execution)
- Requires `GOOGLE_PLACES_ENABLED=true` (double confirmation)
- Scripts exit with clear error messages if flags are missing
- No API calls are made until both requirements are met

### Cost Management

- **Monitor usage:** Check Google Cloud Console regularly
- **Set budget alerts:** Configure billing alerts in Google Cloud
- **Use incremental updates:** Prefer `seed-incremental.js` over full refresh
- **Limit area scope:** Scripts support area filtering to reduce API calls

---

## Environment Variables

Create `.env.local` in the project root:

```bash
# Required
NEXT_PUBLIC_GOOGLE_MAPS_KEY=your_google_maps_api_key_here

# Optional (can use same as Maps key)
GOOGLE_PLACES_KEY=your_google_places_api_key_here

# Optional (for website finding fallback - free tier available)
GOOGLE_SEARCH_API_KEY=your_google_search_api_key_here
GOOGLE_SEARCH_ENGINE_ID=your_search_engine_id_here

# Required for LLM extraction (Happy Hour)
GROK_API_KEY=your_grok_api_key_here
```

---

## Deployment

The app is ready to deploy on Vercel, Netlify, or any Next.js-compatible platform.

### Build for Production

```bash
npm run build
npm start
```

**Note:** Continuous Deployment (CD) is not yet configured. The CI workflow includes a commented CD template for future implementation.

---

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm run test:e2e`
5. Commit and push
6. Open a pull request

---

## License

MIT

---

## Troubleshooting

### Google Maps Not Loading

- Verify `NEXT_PUBLIC_GOOGLE_MAPS_KEY` is set in `.env.local`
- Check API key has Maps JavaScript API enabled
- Ensure billing is enabled on Google Cloud project

### Script Errors

- Ensure Node.js 18+ is installed: `node --version`
- Check API keys are set in environment
- Review rate limiting - scripts have built-in delays
- Check network connectivity for website scraping

For more details on the pipeline, see `scripts/README-PIPELINE.md`.
