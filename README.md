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

## Initial Run / Initial Load

Run these scripts **once** to set up the initial data:

1. **Create areas configuration:**
   ```bash
   node scripts/create-areas.js
   ```

2. **Seed venues from Google Places:**
   ```bash
   node scripts/seed-venues.js
   ```
   This discovers all venues and creates `data/venues.json`.

3. **Run the happy hour pipeline:**
   ```bash
   node scripts/download-raw-html.js
   node scripts/merge-raw-files.js
   ```
   Note: The `silver_matched` filtering layer has been removed. All data now flows through `silver_merged/all/`.

4. **Extract happy hours (Gemini API - bulk):**
   ```bash
   node scripts/extract-happy-hours.js
   ```
   This uses Google Gemini API to extract happy hour information from all venues.
   Requires `GEMINI_API_KEY` environment variable.

5. **Create spots:**
   ```bash
   node scripts/create-spots.js
   ```

## Incremental Load / Daily Run

Run these scripts **daily** to update data:

1. **Download new/updated websites:**
   ```bash
   node scripts/download-raw-html.js
   ```
   Or for a specific area:
   ```bash
   node scripts/download-raw-html.js "Daniel Island"
   ```

2. **Merge raw files:**
   ```bash
   node scripts/merge-raw-files.js
   ```
   Or for a specific area:
   ```bash
   node scripts/merge-raw-files.js "Daniel Island"
   ```

3. **Extract happy hours (Gemini API - incremental):**
   ```bash
   npm run extract:incremental
   ```
   This automatically processes only new or changed venues using Gemini API.
   Requires `GEMINI_API_KEY` environment variable and `.bulk-complete` flag.

6. **Update spots:**
   ```bash
   node scripts/create-spots.js
   ```

## Quick Start (TLDR)

1. **Create Areas Config**: `node scripts/create-areas.js`
2. **Seed Venues**: `node scripts/seed-venues.js` (requires Google Maps API key)
3. **Download Raw HTML**: `node scripts/download-raw-html.js`
4. **Merge Raw Files**: `node scripts/merge-raw-files.js`
5. Extract Happy Hours (Gemini LLM): `node scripts/extract-happy-hours.js` (bulk) or `npm run extract:incremental` (daily)

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
- **Google Gemini API** - AI-powered happy hour extraction
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

Creates `data/areas.json` with area definitions for all Charleston areas. This file must be created before running venue seeding scripts.

**Run:**
```bash
node scripts/create-areas.js
```

**Output:**
- `data/areas.json` - Area configuration with center coordinates, radius, bounds, and descriptions for 8 Charleston areas

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
- `areas.json` must exist (created in Step 1)
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
- Downloads homepage + relevant subpages (menu, happy-hour, happyhour, hh, specials, events, bar, drinks, deals, promos, promotions, offers, happenings, whats-on, calendar, cocktails, wine, beer, **location**)
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

**Note:** The `silver_matched` filtering layer has been removed. All venues (with or without happy hour text) are now in `silver_merged/all/`. LLM extraction will process all venues and filter based on content.

---

### Step 5: Extract Happy Hours (Gemini LLM)

**Script:** `scripts/extract-happy-hours.js`

This script uses **Google Gemini API** to extract structured happy hour data from merged venue content. It processes all venues from `silver_merged/all/` and uses AI to identify and extract happy hour information.

**Features:**
- **Automated LLM Extraction**: Uses Google Gemini API for intelligent happy hour detection
- **Bulk Mode**: Processes all venues (one-time initial run)
- **Incremental Mode**: Only processes new or changed venues (daily updates)
- **Smart Detection**: Recognizes happy hours even with non-standard names (e.g., "Heavy's Hour")
- **Hash-based Change Detection**: Skips unchanged venues in incremental mode
- **Rate Limiting**: Built-in delays to respect API limits (1 second between calls)

**Note:** The LLM extraction processes all venues from `silver_merged/all/` and determines which ones have happy hour information based on the prompt. It differentiates happy hours from regular business hours.

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
- Processes **all** venues from `silver_merged/all/`
- Calls Gemini API for each venue to extract happy hour information
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
- Identifies new or updated venues by comparing content hashes
- **Only processes changed venues** (significantly faster)
- Calls Gemini API for changed venues only
- Requires `.bulk-complete` flag to exist (bulk extraction must be done first)

**Requirements:**
- `data/silver_merged/all/` directory with merged files (created in Step 4)
- `GEMINI_API_KEY` environment variable (required)
- `.bulk-complete` flag must exist (for incremental mode)

**Output:**
- `data/gold/<venue-id>.json` - Extracted structured happy hour data per venue (ALL venues: found:true AND found:false). Full representation of silver→gold transformation.
- `data/reporting/spots.json` - **Final output**: Only venues with `found:true`. Filtered from gold for frontend consumption.
- `data/reporting/venues.json` - Copy of `venues.json` for frontend consumption.
- `data/reporting/areas.json` - Copy of `areas.json` for frontend consumption.

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

**Note:** The script supports both automated bulk and incremental extraction using Gemini API. For manual bulk extraction via Grok UI, you can still use `npm run extract:bulk:prepare` and `npm run extract:bulk:process` if preferred.

---

### Step 7: Incremental Venue Updates (Optional, Run Periodically)

**Script:** `scripts/seed-incremental.js`

Designed to run nightly or on-demand for ongoing maintenance. Finds new venues and enriches missing data.

**Features:**
- Appends new venues from Google Places API (finds venues not already in `venues.json`)
- Uses efficient Strategy 3: Only searches `bar`, `restaurant`, `brewery` types
- Uses 50% reduced radius for faster execution
- Skips venues that already have websites
- Uses robust area assignment logic from `seed-venues.js`
- Safe to run multiple times (only adds new venues, doesn't overwrite)

**Requirements:**
- `areas.json` and `venues.json` must exist (created in Steps 1-2)
- `NEXT_PUBLIC_GOOGLE_MAPS_KEY` or `GOOGLE_PLACES_KEY` environment variable

**Run:**
```bash
npm run seed:incremental
```

**Output:**
- `data/venues.json` - Updated with new venues and enriched website information

---

## Complete Pipeline Summary

```
1. create-areas.js        → data/areas.json
2. seed-venues.js         → data/venues.json
3. download-raw-html.js   → data/raw/all/<venue-id>/
4. merge-raw-files.js     → data/silver_merged/all/<venue-id>.json
5. extract-happy-hours.js → data/gold/<venue-id>.json (uses LLM)
```

**Note:** The `silver_matched` filtering layer (Step 5) has been removed. All data flows through `silver_merged/all/`.

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

# Step 5: Extract happy hours (Gemini API)
node scripts/extract-happy-hours.js  # Bulk (one-time initial run)
# ... then for daily updates ...
npm run extract:incremental  # Incremental (daily, only changed venues)

# Step 7: Run development server
npm run dev
```

---

## Data Files

### `/data/venues.json`
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

### `/data/reporting/spots.json`
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
├── areas.json              # Area configuration
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
│   │   └── <venue-id>.json # All pages combined
│   ├── previous/           # Previous day's merged files
│   │   └── <venue-id>.json
│   └── incremental/        # Incremental files (new/changed)
└── gold/                   # LLM extracted structured data (Step 5)
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
- **Seed Venues**: 4 test files, ~70+ test cases, runs on git push
- **Raw Layer**: 4 test files, ~73+ test cases, runs on git push
- **Silver Layer**: 3 test files, ~50+ test cases, runs on git push (silver_matched layer removed)
- **Total**: 11+ test files, 190+ test cases, all run on git push via GitHub Actions

---

## Project Structure

```
chs-spots/
├── data/                      # Data files
│   ├── venues.json           # All venues from Google Places
│   ├── spots.json            # Curated spots with activities
│   ├── areas.json            # Area configuration
│   ├── backup/               # Timestamped backups
│   ├── raw/                  # Raw HTML files (all/, previous/, incremental/)
│   ├── silver_merged/        # Merged JSON per venue (all/, previous/, incremental/)
│   └── gold/                 # LLM extracted structured data
├── scripts/                   # Node.js scripts
│   ├── create-areas.js       # Create areas.json
│   ├── seed-venues.js        # Seed venues (with parallel processing)
│   ├── seed-incremental.js   # Incremental venue updates
│   ├── download-raw-html.js  # Download raw HTML (pipeline Step 3)
│   ├── merge-raw-files.js    # Merge raw files (pipeline Step 4)
│   ├── extract-happy-hours.js # Extracts structured happy hour data using LLM API (pipeline Step 5)
│   ├── extract-happy-hours.js # Extract structured data (pipeline Step 5)
│   ├── prepare-bulk-llm-extraction.js # Bulk LLM preparation
│   ├── process-bulk-llm-results.js    # Process bulk LLM results
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
GEMINI_API_KEY=your_gemini_api_key_here
```

---

## Deployment

The app is ready to deploy on Vercel, Netlify, or any Next.js-compatible platform.

### Build for Production

```bash
npm run build
npm start
```

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
