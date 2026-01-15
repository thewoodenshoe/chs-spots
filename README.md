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

4. **Bulk LLM extraction (one-time manual):**
   ```bash
   npm run extract:bulk:prepare
   # Upload to Grok UI, extract, save as data/gold/bulk-results.json
   npm run extract:bulk:process
   ```

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

3. **Prepare incremental venues for LLM:**
   ```bash
   node scripts/prepare-incremental-llm-extraction.js
   ```
   Creates `data/gold/incremental-input-YYYY-MM-DD.json` (archives old files to `incremental-history/`).

5. **Manual LLM extraction:**
   - Upload `incremental-input-YYYY-MM-DD.json` to Grok UI
   - Extract happy hour information
   - Save results as `data/gold/incremental-results-YYYY-MM-DD.json`

5. **Process incremental results:**
   ```bash
   node scripts/process-incremental-llm-results.js
   ```

6. **Update spots:**
   ```bash
   node scripts/create-spots.js
   ```

## Quick Start (TLDR)

1. **Create Areas Config**: `node scripts/create-areas.js`
2. **Seed Venues**: `node scripts/seed-venues.js` (requires Google Maps API key)
3. **Download Raw HTML**: `node scripts/download-raw-html.js`
4. **Merge Raw Files**: `node scripts/merge-raw-files.js`
5. **Extract Happy Hours** (Optional): `npm run extract:incremental` or bulk LLM extraction

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

### Step 5: Extract Happy Hours (LLM)

**Script:** `scripts/extract-happy-hours.js`

Extracts structured happy hour data from `silver_merged/all/` files using LLM. This is the final step in the pipeline.

**Note:** Since the `silver_matched` layer has been removed, LLM extraction processes all venues from `silver_merged/all/` and determines which ones have happy hour information.

**Workflow:**

#### Bulk Extraction (One-Time Manual)

1. **Prepare bulk data:**
```bash
npm run extract:bulk:prepare
```
Creates `data/gold/bulk-input.json` for manual Grok UI extraction.

2. **Manual extraction:** Copy-paste into Grok UI, extract, save results to `data/gold/bulk-results.json`

3. **Process bulk results:**
```bash
npm run extract:bulk:process
```
Creates `data/gold/<venue-id>.json` for each venue and marks bulk as complete.

#### Incremental Extraction (Daily Automated)

```bash
npm run extract:incremental
```

Extracts structured happy hour data using LLM API.
- Only processes new/changed venues (compares timestamps)
- Requires `.bulk-complete` flag to exist (bulk must be done first)
- Uses LLM API for extraction

**Requirements:**
- `data/silver_merged/all/` directory with merged files (created in Step 4)
- Bulk extraction must be completed first (for incremental mode)

**Output:**
- `data/gold/<venue-id>.json` - Extracted structured happy hour data per venue

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
5. extract-happy-hours.js → data/gold/<venue-id>.json
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

# Step 5: Extract happy hours (bulk + incremental)
npm run extract:bulk:prepare
# ... manual Grok UI extraction ...
npm run extract:bulk:process
# ... then for daily updates ...
npm run extract:incremental

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

### `/data/spots.json`
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
├── spots.json              # Curated spots with activities
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
