# Charleston Local Spots

A crowdsourced map application for discovering and sharing local hotspots in Charleston, SC areas including Daniel Island, Mount Pleasant, James Island, Downtown Charleston, and Sullivan's Island.

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

## UI Features

### Show All Venues Toggle

A debugging/testing feature that displays all venues from `venues.json` as **red markers** on the map.

**Location:** Bottom left, next to "Closest Nearby" button

**Features:**
- **Toggle On/Off**: Click to show/hide all venues
- **Red Markers**: Venues display as red circular markers (32px)
- **Area Filtering**: Automatically filters by selected area
- **InfoWindow**: Click venue marker to see name, area, address, website (no happy hour info)
- **Overlay**: Venues overlay with spots (spots appear on top)
- **Mobile/Desktop**: Responsive button layout
  - Mobile: Icon only, buttons stack vertically
  - Desktop: Icon + text, buttons side-by-side

**Purpose:** Visualize all discovered venues per area for testing and debugging venue assignment accuracy.

## Initial Setup: Running Scripts in Sequence

The project requires running scripts in a specific order to generate the necessary data files. Follow these steps sequentially:

### Step 1: Create Areas Configuration

**Script:** `scripts/create-areas.js`

**What it does:**
- Creates the `data/areas.json` file with area definitions
- Defines 7 Charleston areas: Daniel Island, Mount Pleasant, Downtown Charleston, Sullivan's Island, North Charleston, West Ashley, and James Island
- Each area includes center coordinates, radius, bounds, and description
- This file is required by all subsequent scripts

**Run:**
```bash
node scripts/create-areas.js
```

**Output:**
- `data/areas.json` - Area configuration file used by the app and scripts

---

### Step 2: Seed Venues from Google Places

**Script:** `scripts/seed-venues.js`

**What it does:**
- Fetches alcohol-serving venues from Google Places API for all areas defined in `areas.json`
- Queries multiple venue types: bar, restaurant, brewery, night_club, wine_bar
- Uses the area centers and radii from `areas.json` to search each area
- Fetches website URLs from Google Places Details API
- Deduplicates venues by place_id
- Appends new venues to existing `venues.json` without overwriting (safe to run multiple times)

**Requirements:**
- `areas.json` must exist (created in Step 1)
- `NEXT_PUBLIC_GOOGLE_MAPS_KEY` or `GOOGLE_PLACES_KEY` environment variable

**Run:**
```bash
node scripts/seed-venues.js
```

**Expected Runtime:**
- 10-30 minutes depending on number of areas and venues
- Rate limiting: 1-2 seconds between API calls

**Output:**
- `data/venues.json` - All discovered venues with name, address, coordinates, website, types, and area assignment

---

### Step 3: Scrape Happy Hour Data (Optional)

**Script:** `scripts/update-happy-hours.js`

**What it does:**
- Scrapes restaurant websites to collect raw happy hour data
- **Decoupled Architecture**: Only saves raw scraped data, does NOT modify `venues.json` or `spots.json`
- Detects multi-location/chain restaurant sites and finds location-specific pages
- Discovers relevant subpages (menus, specials, happy hour pages) using 30+ keywords
- Extracts raw happy hour text snippets
- Saves per-venue scraped data to `data/scraped/<venue-id>.json`
- Collects URL patterns for learning (`data/url-patterns.json`)
- **Parallel Processing**: 8 workers for fast execution

**Requirements:**
- `venues.json` must exist (created in Step 2)
- Venues with websites are processed
- Optionally uses `GOOGLE_SEARCH_API_KEY` and `GOOGLE_SEARCH_ENGINE_ID` for website finding (not required)

**Run:**
```bash
node scripts/update-happy-hours.js
```

**Expected Runtime:**
- ~8 minutes for 741 venues (with 8 parallel workers)
- ~3-4 minutes on subsequent runs the same day (uses per-venue cache)
- Rate limiting: 1.5-2.5 seconds between requests (only for fresh fetches)

**Output:**
- `data/scraped/<venue-id>.json` - Raw scraped data per venue (one file per venue)
- `data/url-patterns.json` - All discovered URL path patterns
- `data/cache/*.html` - Daily cached HTML content from venue websites
- `logs/update-happy-hours.log` - Detailed log file with timestamps

**Note:** This script uses per-venue daily caching. See the [Caching Strategy](#caching-strategy) section for details.

---

### Step 4: Extract Happy Hour Information (Optional)

**Script:** `scripts/extract-happy-hours.js`

**What it does:**
- Reads raw scraped data from `data/scraped/`
- Extracts structured happy hour information
- Creates or updates spots in `spots.json`

**Requirements:**
- `data/scraped/` directory with scraped venue files (created in Step 3)

**Run:**
```bash
node scripts/extract-happy-hours.js
```

**Output:**
- `data/spots.json` - Updated with structured happy hour spots

---

### Step 4: Incremental Updates (Optional, Run Periodically)

**Script:** `scripts/seed-incremental.js`

**What it does:**
- Designed to run nightly or on-demand for ongoing maintenance
- Appends new venues from Google Places API (finds venues not already in `venues.json`)
- Enriches missing website URLs using Google Text Search API
- Generates CSV file for venues without websites for manual review
- Safe to run multiple times (only adds new venues, doesn't overwrite)

**Requirements:**
- `areas.json` and `venues.json` must exist (created in Steps 1-2)
- `NEXT_PUBLIC_GOOGLE_MAPS_KEY` or `GOOGLE_PLACES_KEY` environment variable

**Run:**
```bash
node scripts/seed-incremental.js
```

**Output:**
- `data/venues.json` - Updated with new venues and enriched website information
- `data/venue-website-not-found.csv` - CSV file of venues without websites for manual review

---

### Quick Start Summary

For a fresh setup, run these commands in order:

```bash
# Step 1: Create areas configuration
node scripts/create-areas.js

# Step 2: Seed venues (requires Google Maps API key)
node scripts/seed-venues.js

# Step 3: Update happy hours - scrape raw data (optional, ~8 min with parallel processing)
node scripts/update-happy-hours.js

# Step 4: Extract happy hours - process scraped data (optional)
node scripts/extract-happy-hours.js

# Step 5: Run development server
npm run dev
```

## Scripts (Detailed Documentation)

**Note:** For initial setup, follow the sequential steps above. This section provides detailed documentation for each script.

### Data Seeding Scripts

#### 1. Create Areas (`scripts/create-areas.js`)

**Purpose:** Initial setup script to create the areas configuration file.

Creates `data/areas.json` with area definitions for all Charleston areas. This file must be created before running `seed-venues.js` or `seed-incremental.js`.

**Usage:**
```bash
node scripts/create-areas.js
```

**Output:**
- `data/areas.json` - Area configuration with center coordinates, radius, bounds, and descriptions for 7 Charleston areas

**What it does:**
- Defines 7 Charleston areas: Daniel Island, Mount Pleasant, Downtown Charleston, Sullivan's Island, North Charleston, West Ashley, and James Island
- Each area includes center coordinates, radius in meters, bounding box coordinates, and description
- Creates the `data/` directory if it doesn't exist

---

#### 2. Seed Venues (`scripts/seed-venues.js`)

Fetches all alcohol-serving venues from Google Places API for Charleston areas.

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

**Usage:**
```bash
# Run for all areas
node scripts/seed-venues.js

# Run for specific area only (preserves other areas)
node scripts/seed-venues.js "Isle of Palms"
```

**Output:**
- `/data/venues.json` - All discovered venues with name, address, coordinates, website, types, and area
- `/data/backup/venues-YYYY-MM-DDTHH-MM-SS.json` - Timestamped backup before each write

**Configuration:**
- Requires `NEXT_PUBLIC_GOOGLE_MAPS_KEY` or `GOOGLE_PLACES_KEY` in environment
- Optional: `GOOGLE_SEARCH_API_KEY` and `GOOGLE_SEARCH_ENGINE_ID` for website fallback (free tier available)
- Rate limiting: 1-2 seconds between API calls
- Parallel workers: 5 concurrent website fetches (configurable)

**Performance:**
- ~8-10 minutes for all areas (with parallel processing)
- Website success rate: ~89% (Places API) + ~6% (Google search fallback) = ~95% total

---

#### 3. Update Happy Hours (`scripts/update-happy-hours.js`)

Scrapes restaurant websites to discover and extract happy hour information. **Decoupled architecture** - only scrapes raw data, does not modify `venues.json` or `spots.json`.

**Features:**
- **Parallel Processing**: 8 parallel workers for fast execution (~8 minutes for 741 venues)
- **Multi-Location Detection**: Automatically detects chain/restaurant group sites
- **Local Page Discovery**: Finds location-specific pages (e.g., "Daniel Island", "Mount Pleasant")
- **Comprehensive Submenu Discovery**: Finds relevant pages using 30+ keywords:
  - Menu pages: menu, menus, food-menu, drink-menu, dinner, brunch, lunch
  - Drink pages: cocktails, wine, beer, drinks, raw-bar
  - Happy hour pages: happy-hour, happyhour, happier-hour, specials, daily-specials, deals, promotions
  - Event pages: event, events, bar, club, wine-club
  - Other: pdf, overview
- **Per-Venue Caching**: Daily cache per venue (`data/scraped/<venue-id>.json`)
- **URL Pattern Extraction**: Discovers common URL patterns for learning (`data/url-patterns.json`)
- **Website Discovery**: Attempts to find missing websites (free Google search, then Places API)
- **Decoupled Design**: Saves raw scraped data only, extraction handled by separate script

**Usage:**
```bash
# Run for all venues
node scripts/update-happy-hours.js

# Run with custom worker count
node scripts/update-happy-hours.js --workers 10

# Run for specific area
node scripts/update-happy-hours.js "Daniel Island"
```

**Expected Runtime:**
- ~8 minutes for 741 venues (with 8 parallel workers)
- ~3-4 minutes on subsequent runs the same day (uses per-venue cache)
- Rate limiting: 1.5-2.5 seconds between requests (only for fresh fetches)

**Output Files:**
- `/data/scraped/<venue-id>.json` - Raw scraped data per venue (sources, rawMatches, urlPatterns)
- `/data/url-patterns.json` - All discovered URL path patterns (for learning)
- `/data/cache/*.html` - Daily cached HTML content (refreshed daily)

**How It Works:**
1. Loads venues from `/data/venues.json` (read-only)
2. For each venue with a website:
   - Checks if scraped file exists for today (uses cache if available)
   - Fetches homepage
   - Detects if multi-location site
   - If multi-location, searches for local page links matching venue area
   - Extracts internal links matching submenu keywords
   - Fetches homepage/local page + up to 10 relevant subpages
   - Extracts happy hour text snippets (raw matches)
   - Extracts URL patterns from all pages
   - Saves raw data to `/data/scraped/<venue-id>.json`
3. Aggregates all URL patterns into `/data/url-patterns.json`

**Note:** This script does NOT update `spots.json`. Use `extract-happy-hours.js` to process scraped data.

**Logging:**
The script provides detailed progress:
- 🔍 Multi-location detection
- 📍 Local page discovery
- 🔗 Submenu discovery count
- 🍹 Happy hour snippet extraction
- ✅ Success / ❌ Error status
- 📊 Summary statistics

**Example Output:**
```
🍺 Starting Happy Hour Update Agent...

[1/387] Processing: The Kingstide
  🌐 https://thekingstide.com/
  📍 Area: Daniel Island
  🔍 Found multi-location site
  📍 Found 2 potential local page(s)
  ✅ Using local page: https://thekingstide.com/daniel-island
  🔗 Discovered 5 submenu(s)
  🍹 Found 3 happy hour snippet(s)
  ✅ Scanned: 3 happy hour snippet(s) from 5 subpage(s)
  ✨ Created new spot

📊 Summary:
   ✅ Processed: 387 venues
   🍹 Found happy hour info: 45 venues
   🏢 Multi-location sites detected: 23
   📍 Local pages used: 18
   🔗 Total submenus discovered: 156
```

---

## Caching Strategy

The `update-happy-hours.js` script uses **per-venue daily caching** to improve performance and reduce network load:

### How It Works

- **Scraped Data Cache:** `data/scraped/<venue-id>.json` (one file per venue)
- **HTML Cache:** `data/cache/` directory (created automatically)
- **Cache Key:** Venue ID for scraped data, safe filename for HTML (e.g., `thekingstide-com.html`)
- **Cache Duration:** One day (cache is valid until midnight)
- **Cache Behavior:**
  - If scraped file exists and was created today → skip scraping (use cached data)
  - If HTML cache file exists and was modified today → use cached HTML
  - If cache file is missing or from previous day → fetch fresh HTML and save to cache
  - Cache files are overwritten daily (no history kept)

### Benefits

- **Speed:** Subsequent runs the same day are 5-10x faster
- **Network Load:** Reduces HTTP requests by reusing cached content
- **Reliability:** Less dependency on external websites being available
- **Cost:** Reduces API usage if using paid services
- **Reprocessing:** Can re-run extraction without re-scraping

### Cache Files

- **Scraped Data:** `data/scraped/<venue-id>.json` - Complete raw data per venue
- **HTML Cache:** `data/cache/{safe-domain-name}.html` - Raw HTML text (UTF-8 encoding, no images/CSS/JS/assets)
- **Lifecycle:** Automatically refreshed daily
- **Cleanup:** Manual deletion if needed (script will recreate)

---

#### 4. Extract Happy Hours (`scripts/extract-happy-hours.js`)

**Purpose:** Extracts structured happy hour information from raw scraped data.

Processes the raw scraped data from `update-happy-hours.js` and creates structured spots in `spots.json`.

**Usage:**
```bash
node scripts/extract-happy-hours.js
```

**What it does:**
- Reads all scraped files from `/data/scraped/`
- Extracts structured happy hour information using NLP/regex
- Creates or updates spots in `/data/spots.json`
- Handles deduplication and formatting

**Requirements:**
- `/data/scraped/` directory with scraped venue files (created by `update-happy-hours.js`)

**Output:**
- `/data/spots.json` - Updated with structured happy hour spots

---

#### 5. Seed Incremental (`scripts/seed-incremental.js`)

**Purpose:** Ongoing maintenance script to add new venues and enrich existing data.

Designed to run periodically (nightly or on-demand) to keep venue data up-to-date.

**Usage:**
```bash
node scripts/seed-incremental.js
```

**What it does:**
- Appends new venues from Google Places API (finds venues not already in `venues.json`)
- Uses efficient Strategy 3: Only searches `bar`, `restaurant`, `brewery` types
- Uses 50% reduced radius for faster execution
- Skips venues that already have websites
- Uses robust area assignment logic from `seed-venues.js`
- Safe to run multiple times (only adds new venues, doesn't overwrite)

**Requirements:**
- `areas.json` and `venues.json` must exist (created in Steps 1-2)
- `NEXT_PUBLIC_GOOGLE_MAPS_KEY` or `GOOGLE_PLACES_KEY` environment variable

**Output:**
- `data/venues.json` - Updated with new venues and enriched website information
- `data/venue-website-not-found.csv` - CSV file of venues without websites for manual review

---

#### 5. Align Spots to Google (`scripts/align-spots-to-google.js`)

One-time script to align existing curated spots to precise Google Maps locations.

**Usage:**
```bash
node scripts/align-spots-to-google.js
```

**Features:**
- Uses Google Places "Find Place" or "Text Search" API
- Updates lat/lng coordinates for accurate positioning
- Requires `GOOGLE_PLACES_KEY` in environment

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
  "description": "• Happy hour 4-6 PM daily — source: https://example.com/menu\n• Friday specials 5-7 PM — source: https://example.com/specials",
  "activity": "Happy Hour",
  "area": "Daniel Island"
}
```

### `/data/scraped/<venue-id>.json`
Raw scraped data per venue (created by update-happy-hours.js).
```json
{
  "venueId": "ChIJ1...",
  "venueName": "The Kingstide",
  "venueArea": "Daniel Island",
  "website": "https://thekingstide.com/",
  "scrapedAt": "2026-01-12T15:14:47.886Z",
  "sources": [
    {
      "url": "https://thekingstide.com/daniel-island",
      "text": "Happy hour 4-6 PM daily...",
      "pageType": "location-page",
      "scrapedAt": "2026-01-12T15:14:48.314Z"
    }
  ],
  "rawMatches": [
    {
      "text": "Happy hour 4-6 PM daily",
      "source": "https://thekingstide.com/daniel-island"
    }
  ],
  "urlPatterns": ["menu", "happy-hour", "specials"]
}
```

### `/data/url-patterns.json`
All discovered URL path patterns (for learning and improving submenu detection).
```json
[
  "menu",
  "happy-hour",
  "specials",
  "drink-menu",
  "food-menu"
]
```

### `/data/backup/venues-*.json`
Timestamped backups of venues.json (created automatically before each write).

## Testing

### Run E2E Tests
```bash
npm run test:e2e
```

### Run E2E Tests with UI
```bash
npm run test:e2e:ui
```

### Run Unit Tests (Jest)
```bash
npm test
```

**Test Coverage:**
- Page load and header visibility
- Area selector functionality
- Activity filter modal
- Add spot button and submission
- Map display
- Venues toggle functionality (mobile/desktop)
- Mobile responsiveness
- Error handling
- API routes (spots, venues, areas)
- Context providers (SpotsContext, VenuesContext)
- Component interactions

## Project Structure

```
chs-spots/
├── data/                      # Data files
│   ├── venues.json           # All venues from Google Places
│   ├── spots.json            # Curated spots with activities
│   ├── areas.json            # Area configuration
│   ├── backup/               # Timestamped backups
│   │   └── venues-*.json    # Auto-generated backups
│   ├── cache/                # Daily cached HTML
│   ├── scraped/              # Raw scraped data per venue
│   │   └── <venue-id>.json  # One file per venue
│   ├── url-patterns.json     # Discovered URL patterns
│   └── restaurants-submenus.json  # Legacy submenu inventory
├── scripts/                   # Node.js scripts
│   ├── create-areas.js       # Create areas.json
│   ├── seed-venues.js        # Seed venues (with parallel processing)
│   ├── seed-incremental.js   # Incremental venue updates
│   ├── update-happy-hours.js # Scrape raw data (decoupled)
│   ├── extract-happy-hours.js # Extract structured data
│   └── __tests__/            # Script unit tests
├── src/
│   ├── app/                  # Next.js app directory
│   │   ├── page.tsx         # Main page component
│   │   ├── layout.tsx       # Root layout with providers
│   │   └── api/             # API routes
│   │       ├── spots/       # Spots CRUD
│   │       ├── venues/      # Venues GET (new)
│   │       └── areas/       # Areas config
│   ├── components/           # React components
│   │   ├── MapComponent.tsx # Google Maps integration
│   │   ├── VenuesToggle.tsx # Show/hide venues toggle (new)
│   │   ├── FilterModal.tsx  # Activity selection
│   │   ├── SubmissionModal.tsx  # Add new spot
│   │   ├── EditSpotModal.tsx    # Edit/delete spot
│   │   ├── AreaSelector.tsx     # Area dropdown
│   │   └── ActivityChip.tsx     # Activity display
│   └── contexts/
│       ├── SpotsContext.tsx  # Global spots state
│       └── VenuesContext.tsx # Global venues state (new)
└── e2e/                      # Playwright E2E tests
    └── app.spec.ts
```

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

## Deployment

The app is ready to deploy on Vercel, Netlify, or any Next.js-compatible platform.

### Build for Production

```bash
npm run build
npm start
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm run test:e2e`
5. Commit and push
6. Open a pull request

## License

MIT

## Troubleshooting

### SSL Certificate Issues with Git

See `FIX-SSL-AND-RUN-SCRIPT.md` for solutions.

### Google Maps Not Loading

- Verify `NEXT_PUBLIC_GOOGLE_MAPS_KEY` is set in `.env.local`
- Check API key has Maps JavaScript API enabled
- Ensure billing is enabled on Google Cloud project

### Script Errors

- Ensure Node.js 18+ is installed: `node --version`
- Check API keys are set in environment
- Review rate limiting - scripts have built-in delays
- Check network connectivity for website scraping

For more details on running scripts, see:
- `scripts/RUN-UPDATE-HAPPY-HOURS.md`
- `FIX-SSL-AND-RUN-SCRIPT.md`