# Charleston Local Spots

A crowdsourced map application for discovering and sharing local hotspots in Charleston, SC areas including Daniel Island, Mount Pleasant, James Island, Downtown Charleston, and Sullivan's Island.

## Quick Start (TLDR)

1. **Create Areas Config**: `node scripts/create-areas.js`
2. **Seed Venues**: `node scripts/seed-venues.js` (requires Google Maps API key)
3. **Download Raw HTML**: `node scripts/download-raw-html.js`
4. **Merge Raw Files**: `node scripts/merge-raw-files.js`
5. **Filter Happy Hour**: `node scripts/filter-happy-hour.js`
6. **Extract Happy Hours** (Optional): `npm run extract:incremental` or bulk LLM extraction

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
- Downloads homepage + relevant subpages (menu, happy hour, specials, etc.)
- **Daily Caching**: Per-venue daily cache (skips re-download if already downloaded today)
- **Previous Day Archive**: Archives previous day's downloads for diff comparison
- Extracts URL patterns for learning
- Handles multi-location sites (finds location-specific pages)

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
- `data/raw/<venue-id>/` - Raw HTML files per venue (one directory per venue)
- `data/raw/<venue-id>/*.html` - Individual HTML files (hashed filenames)
- `data/raw/<venue-id>/metadata.json` - URL to hash mapping
- `data/raw/previous/` - Previous day's downloads (for diff comparison)

---

### Step 4: Merge Raw Files

**Script:** `scripts/merge-raw-files.js`

Merges all raw HTML files per venue into single JSON files. This is the second step in the pipeline.

**Features:**
- Combines all HTML files per venue into a single merged JSON file
- Preserves metadata (URLs, download timestamps, hashes)
- One file per venue

**Requirements:**
- `data/raw/` directory with raw HTML files (created in Step 3)

**Run:**
```bash
node scripts/merge-raw-files.js
```

**Expected Runtime:**
- ~1-2 minutes for 741 venues

**Output:**
- `data/silver_merged/<venue-id>.json` - Merged JSON file per venue (all pages combined with metadata)

---

### Step 5: Filter Happy Hour

**Script:** `scripts/filter-happy-hour.js`

Filters merged files that contain "happy hour" text patterns. This is the third step in the pipeline.

**Features:**
- Searches for "happy hour" patterns (case-insensitive, with/without spaces, plural forms)
- Copies matching venues to `silver_matched/` directory
- Preserves all data from merged files

**Requirements:**
- `data/silver_merged/` directory with merged files (created in Step 4)

**Run:**
```bash
node scripts/filter-happy-hour.js
```

**Expected Runtime:**
- ~30 seconds for 741 venues

**Output:**
- `data/silver_matched/<venue-id>.json` - Only venues with "happy hour" text (copied from silver_merged)

---

### Step 6: Extract Happy Hours (LLM)

**Script:** `scripts/extract-happy-hours.js`

Extracts structured happy hour data from `silver_matched` files using LLM. This is the final step in the pipeline.

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
- `data/silver_matched/` directory with filtered files (created in Step 5)
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
3. download-raw-html.js   → data/raw/<venue-id>/
4. merge-raw-files.js     → data/silver_merged/<venue-id>.json
5. filter-happy-hour.js   → data/silver_matched/<venue-id>.json
6. extract-happy-hours.js → data/gold/<venue-id>.json
```

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

# Step 5: Filter happy hour
node scripts/filter-happy-hour.js

# Step 6: Extract happy hours (bulk + incremental)
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
│   └── <venue-id>/
│       ├── <hash>.html     # Individual HTML files
│       └── metadata.json   # URL to hash mapping
├── silver_merged/          # Merged JSON per venue (Step 4)
│   └── <venue-id>.json     # All pages combined
├── silver_matched/         # Only venues with "happy hour" (Step 5)
│   └── <venue-id>.json     # Copied from silver_merged
└── gold/                   # LLM extracted structured data (Step 6)
    ├── <venue-id>.json     # Extracted happy hour data
    ├── .bulk-complete      # Flag: Bulk extraction done
    ├── bulk-input.json     # For manual Grok UI
    └── bulk-results.json   # From manual Grok UI
```

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
- **Silver Layer**: 5 test files, ~110+ test cases, runs on git push
- **Total**: 13+ test files, 250+ test cases, all run on git push via GitHub Actions

---

## Project Structure

```
chs-spots/
├── data/                      # Data files
│   ├── venues.json           # All venues from Google Places
│   ├── spots.json            # Curated spots with activities
│   ├── areas.json            # Area configuration
│   ├── backup/               # Timestamped backups
│   ├── raw/                  # Raw HTML files
│   ├── silver_merged/        # Merged JSON per venue
│   ├── silver_matched/       # Only venues with "happy hour"
│   └── gold/                 # LLM extracted structured data
├── scripts/                   # Node.js scripts
│   ├── create-areas.js       # Create areas.json
│   ├── seed-venues.js        # Seed venues (with parallel processing)
│   ├── seed-incremental.js   # Incremental venue updates
│   ├── download-raw-html.js  # Download raw HTML (pipeline Step 1)
│   ├── merge-raw-files.js    # Merge raw files (pipeline Step 2)
│   ├── filter-happy-hour.js  # Filter happy hour (pipeline Step 3)
│   ├── extract-happy-hours.js # Extract structured data (pipeline Step 4)
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
