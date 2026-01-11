# Charleston Local Spots

A crowdsourced map application for discovering and sharing local hotspots in Charleston, SC areas including Daniel Island, Mount Pleasant, James Island, Downtown Charleston, and Sullivan's Island.

## Features

- 🗺️ **Interactive Google Maps** with curated spots
- 🍹 **Activity Filtering** - Filter by Happy Hour, Fishing Spots, Sunset Spots, Pickleball Games, Bike Routes, Golf Cart Hacks, and more
- 📍 **Area Selection** - Browse spots by specific Charleston area
- ➕ **Add Your Own Spots** - Community-driven content
- 📱 **Mobile-First Design** - Responsive layout optimized for mobile devices
- 🔍 **Closest Nearby** - Find the nearest spot to your location
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

### Step 3: Update Happy Hour Information (Optional)

**Script:** `scripts/update-happy-hours.js`

**What it does:**
- Scrapes restaurant websites to discover and extract happy hour information
- Detects multi-location/chain restaurant sites and finds location-specific pages
- Discovers relevant subpages (menus, specials, happy hour pages) using 30+ keywords
- Extracts happy hour text snippets with context
- Creates or updates spots in `spots.json` with happy hour information
- Generates `restaurants-submenus.json` inventory of discovered submenu URLs

**Requirements:**
- `venues.json` must exist (created in Step 2)
- Venues with websites are processed
- Optionally uses `GOOGLE_SEARCH_API_KEY` and `GOOGLE_SEARCH_ENGINE_ID` for fallback search (not required)

**Run:**
```bash
node scripts/update-happy-hours.js
```

**Expected Runtime:**
- 15-30 minutes for ~400 venues
- Rate limiting: 1.5-2.5 seconds between requests (polite to servers)

**Output:**
- `data/spots.json` - Updated with happy hour spots (title, lat/lng, description with sources, activity: "Happy Hour")
- `data/restaurants-submenus.json` - One-time inventory of all discovered submenu URLs per restaurant
- `logs/update-happy-hours.log` - Detailed log file with timestamps

**Note:** This script creates detailed logs in `logs/update-happy-hours.log` for debugging and monitoring.

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

# Step 3: Update happy hours (optional, takes 15-30 minutes)
node scripts/update-happy-hours.js

# Step 4: Run development server
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
- Validates that Park Circle is not included in the areas list
- Creates the `data/` directory if it doesn't exist

---

#### 2. Seed Venues (`scripts/seed-venues.js`)

Fetches all alcohol-serving venues from Google Places API for Charleston areas.

**Features:**
- Uses Google Places Nearby Search API
- Queries multiple venue types: bar, restaurant, night_club, cafe
- Covers 5 areas: Daniel Island, Mount Pleasant, James Island, Downtown Charleston, Sullivan's Island
- Extended Daniel Island coverage (8000m radius to include Clements Ferry Road)
- Fetches website details from Google Places Details API
- Deduplicates by place_id
- Appends to existing `/data/venues.json` without overwriting

**Usage:**
```bash
node scripts/seed-venues.js
```

**Output:**
- `/data/venues.json` - All discovered venues with name, address, coordinates, website, types, and area

**Configuration:**
- Requires `NEXT_PUBLIC_GOOGLE_MAPS_KEY` or `GOOGLE_PLACES_KEY` in environment
- Rate limiting: 1-2 seconds between API calls
- Automatically fetches missing website information

---

#### 3. Update Happy Hours (`scripts/update-happy-hours.js`)

Scrapes restaurant websites to discover and extract happy hour information.

**Features:**
- **Multi-Location Detection**: Automatically detects chain/restaurant group sites
- **Local Page Discovery**: Finds location-specific pages (e.g., "Daniel Island", "Mount Pleasant")
- **Comprehensive Submenu Discovery**: Finds relevant pages using 30+ keywords:
  - Menu pages: menu, menus, food-menu, drink-menu, dinner, brunch, lunch
  - Drink pages: cocktails, wine, beer, drinks, raw-bar
  - Happy hour pages: happy-hour, happyhour, happier-hour, specials, daily-specials, deals, promotions
  - Event pages: event, events, bar, club, wine-club
  - Other: pdf, overview
- **Smart Extraction**: Extracts happy hour text snippets with context
- **One-Time Inventory**: Creates `/data/restaurants-submenus.json` with all discovered submenu URLs
- **Incremental Updates**: Appends to existing spots without overwriting

**Usage:**
```bash
node scripts/update-happy-hours.js
```

**Expected Runtime:**
- 15-30 minutes for ~400 venues
- Rate limiting: 1.5-2.5 seconds between requests (polite to servers)

**Output Files:**
- `/data/spots.json` - Updated with happy hour spots (title, lat/lng, description with sources, activity: "Happy Hour")
- `/data/restaurants-submenus.json` - One-time inventory of all discovered submenu URLs per restaurant

**How It Works:**
1. Loads venues from `/data/venues.json`
2. For each venue with a website:
   - Fetches homepage
   - Detects if multi-location site (keywords: "locations", "choose location", etc.)
   - If multi-location, searches for local page links matching venue area
   - Extracts internal links matching submenu keywords (href or link text)
   - Fetches homepage/local page + up to 10 relevant subpages
   - Extracts happy hour text snippets (searches for "happy hour" + time patterns)
   - Updates or creates spot in `/data/spots.json`
3. Creates submenus inventory file with all discovered URLs

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

#### 4. Seed Incremental (`scripts/seed-incremental.js`)

**Purpose:** Ongoing maintenance script to add new venues and enrich existing data.

Designed to run periodically (nightly or on-demand) to keep venue data up-to-date.

**Usage:**
```bash
node scripts/seed-incremental.js
```

**What it does:**
- Appends new venues from Google Places API (finds venues not already in `venues.json`)
- Enriches missing website URLs using Google Text Search API
- Generates CSV file for venues without websites for manual review
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

### `/data/restaurants-submenus.json`
One-time inventory of discovered submenu URLs (created by update-happy-hours.js).
```json
{
  "restaurantName": "The Kingstide",
  "website": "https://thekingstide.com/",
  "submenus": [
    "https://thekingstide.com/menu",
    "https://thekingstide.com/happy-hour",
    "https://thekingstide.com/specials"
  ]
}
```

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
- Mobile responsiveness
- Error handling

## Project Structure

```
chs-spots/
├── data/                      # Data files
│   ├── venues.json           # All venues from Google Places
│   ├── spots.json            # Curated spots with activities
│   └── restaurants-submenus.json  # Submenu inventory
├── scripts/                   # Node.js scripts
│   ├── seed-venues.js        # Seed venues from Google Places
│   ├── update-happy-hours.js # Scrape happy hour info
│   └── align-spots-to-google.js  # Align coordinates
├── src/
│   ├── app/                  # Next.js app directory
│   │   ├── page.tsx         # Main page component
│   │   ├── layout.tsx       # Root layout with SpotsProvider
│   │   └── api/             # API routes
│   ├── components/           # React components
│   │   ├── MapComponent.tsx # Google Maps integration
│   │   ├── FilterModal.tsx  # Activity selection
│   │   ├── SubmissionModal.tsx  # Add new spot
│   │   ├── EditSpotModal.tsx    # Edit/delete spot
│   │   ├── AreaSelector.tsx     # Area dropdown
│   │   └── ActivityChip.tsx     # Activity display
│   └── contexts/
│       └── SpotsContext.tsx  # Global spots state
└── e2e/                      # Playwright E2E tests
    └── app.spec.ts
```

## Environment Variables

Create `.env.local` in the project root:

```bash
NEXT_PUBLIC_GOOGLE_MAPS_KEY=your_google_maps_api_key_here
GOOGLE_PLACES_KEY=your_google_places_api_key_here  # Optional, can use same as Maps key
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