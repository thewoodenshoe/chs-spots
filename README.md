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
   Create `.env.local` file in the project root with the following keys:
   ```bash
   # Required: Google Maps API key for map display and venue discovery
   NEXT_PUBLIC_GOOGLE_MAPS_KEY=your_google_maps_api_key_here
   
   # Optional: Alternative Google Places API key (if different from Maps key)
   GOOGLE_PLACES_KEY=your_google_places_api_key_here
   
   # Optional: Google Custom Search API (for website finding fallback - free tier available)
   GOOGLE_SEARCH_API_KEY=your_google_search_api_key_here
   GOOGLE_SEARCH_ENGINE_ID=your_search_engine_id_here
   
   # Required: Grok API key for LLM-based happy hour extraction
   GROK_API_KEY=your_grok_api_key_here
   
   # Required only when running venue seeding scripts (safety flag)
   GOOGLE_PLACES_ENABLED=true
   ```

4. **Start the development server:**
   ```bash
   npm run dev
   ```

## Configuration

Configuration files are stored in `data/config/`:

- **`data/config/areas.json`** - Geographic area definitions (bounds, centers, zip codes)
- **`data/config/config.json`** - Pipeline state management (run dates, status, max incremental files threshold)
- **`data/config/llm-instructions.txt`** - LLM prompt template for happy hour extraction
- **`data/config/submenu-keywords.json`** - Keywords used to discover submenu pages (menu, events, specials, etc.)

You can edit these files directly to adjust:
- Area boundaries and definitions
- Pipeline behavior and thresholds
- LLM extraction instructions and prompts
- Website submenu discovery keywords

## Quick Start (TLDR)

1. **Create Areas Config**: `node scripts/create-areas.js`
2. **Seed Venues**: `GOOGLE_PLACES_ENABLED=true node scripts/seed-venues.js --confirm` (requires Google Maps API key)
3. **Run Nightly Pipeline**: `node scripts/run-incremental-pipeline.js`
4. **Start Website**: `npm run dev`

## Initial Setup

### Create Areas Configuration

```bash
node scripts/create-areas.js
```

Creates `data/config/areas.json` with area definitions for all Charleston areas.

### Seed Venues from Google Places

⚠️  **WARNING:** This script uses Google Maps API and can incur significant costs.

**Requirements:**
- `--confirm` flag is **REQUIRED**
- `GOOGLE_PLACES_ENABLED=true` environment variable is **REQUIRED**
- `NEXT_PUBLIC_GOOGLE_MAPS_KEY` or `GOOGLE_PLACES_KEY` must be set in `.env.local`

**Run:**
```bash
GOOGLE_PLACES_ENABLED=true node scripts/seed-venues.js --confirm
```

This discovers all venues and creates `data/reporting/venues.json`. Venues are treated as **STATIC** - only run this manually when you need to add new venues.

**Cost Warning:** Google Maps API charges per request. A full venue seed can make thousands of API calls. Monitor your usage in the Google Cloud Console.

### Nightly Run

The automated pipeline runs daily to detect and process changes:

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

**Note:** The pipeline uses state management via `data/config/config.json` to track run dates and resume from failures.

### Manual Scripts Explained

If you need to run steps individually:

1. **Download new/updated websites:**
   ```bash
   node scripts/download-raw-html.js [area-filter]
   ```

2. **Delta comparison (raw HTML):**
   ```bash
   node scripts/delta-raw-files.js
   ```
   Compares `raw/today/` vs `raw/previous/` and populates `raw/incremental/` with only changed files.

3. **Merge raw files:**
   ```bash
   node scripts/merge-raw-files.js
   ```
   Only processes files in `raw/incremental/`.

4. **Trim silver HTML:**
   ```bash
   node scripts/trim-silver-html.js [area-filter]
   ```
   Only processes files in `silver_merged/incremental/`.

5. **Delta comparison (trimmed content):**
   ```bash
   node scripts/delta-trimmed-files.js
   ```
   Compares `silver_trimmed/today/` vs `silver_trimmed/previous/` using content hashes and populates `silver_trimmed/incremental/` with only actual content changes.

6. **Extract happy hours (Grok API - incremental):**
   ```bash
   node scripts/extract-happy-hours.js --incremental
   ```
   Only processes files in `silver_trimmed/incremental/`.

7. **Update spots:**
   ```bash
   node scripts/create-spots.js
   ```

## Data Pipeline

The pipeline processes venue websites through multiple stages to extract happy hour information while minimizing API costs.

### How It Works

**Directory Structure:**
- `today/` - Current day's data
- `previous/` - Yesterday's baseline for comparison
- `incremental/` - Only changed/new files (minimizes LLM costs)

**Multi-Day Workflow:**

1. **New Day Detection:**
   - Pipeline checks `data/config/config.json` for `run_date` vs `last_raw_processed_date`
   - If dates differ: archives `today/` → `previous/`, empties `today/`, downloads all venues
   - If same date: skips download if already processed, or only checks for new venues

2. **Delta Comparison:**
   - **Raw Delta:** Compares raw HTML files (may flag many due to dynamic content)
   - **Trimmed Delta:** Compares normalized text content (filters out noise, only actual changes)
   - Only venues with real content changes proceed to LLM extraction

3. **Content Normalization:**
   - Removes timestamps, tracking IDs, query parameters, copyright notices
   - Ensures consistent hashing regardless of when files were generated
   - Prevents false positives from dynamic website elements

4. **LLM Extraction:**
   - Only processes files in `silver_trimmed/incremental/`
   - Aborts if more than 15 incremental files detected (configurable via `config.json`)
   - Extracts structured happy hour data to `data/gold/`

**Date Variable Control:**

The pipeline uses `data/config/config.json` to manage state:
- `run_date` - Current run date (YYYYMMDD format)
- `last_raw_processed_date` - Last date raw HTML was processed
- `last_run_status` - Pipeline status for failure recovery

To force a re-run for a specific date, you can manually edit `config.json`:
```json
{
  "run_date": "20260122",
  "last_raw_processed_date": "20260121",
  "last_run_status": "idle"
}
```

Setting `last_raw_processed_date` to a different date than `run_date` will trigger a new day workflow, forcing a full download and delta comparison.

**Example Flow:**
- Day 1: Downloads all 989 venues → processes all → saves to `gold/`
- Day 2: Downloads all again → delta finds ~10 changed → only processes 10 → saves to `gold/`
- Day 3: Same day rerun → skips download if already processed → processes 0 files

### Pipeline Stages

1. **Download Raw HTML** (`download-raw-html.js`)
   - Downloads homepage + subpages (keywords from `submenu-keywords.json`)
   - Saves to `raw/today/<venue-id>/`

2. **Merge Raw Files** (`merge-raw-files.js`)
   - Combines all HTML per venue into single JSON
   - Saves to `silver_merged/today/<venue-id>.json`

3. **Trim HTML** (`trim-silver-html.js`)
   - Removes non-visible elements, extracts visible text
   - 80-90% size reduction
   - Saves to `silver_trimmed/today/<venue-id>.json`

4. **Extract Happy Hours** (`extract-happy-hours.js`)
   - Uses Grok API to extract structured data
   - Only processes `silver_trimmed/incremental/` files
   - Saves to `data/gold/<venue-id>.json`

5. **Create Spots** (`create-spots.js`)
   - Generates `data/reporting/spots.json` from gold data
   - Only includes venues with `found:true`

## Tech Stack

- **Next.js 16** - React framework
- **TypeScript** - Type safety
- **Google Maps API** - Interactive map with markers and clustering
- **Grok API (xAI)** - AI-powered happy hour extraction
- **Tailwind CSS** - Styling
- **Playwright** - End-to-end testing

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
- **Unit Tests**: 27+ test suites, 386+ test cases covering pipeline scripts, LLM extraction, data validation, React components, and API routes
- **Integration Tests**: Full pipeline flow validation
- **E2E Tests**: Playwright tests for map interactions and CRUD operations

## Continuous Integration

GitHub Actions runs on push/PR to `main` or `feature/**` branches:

- **Build & Test**: Jest unit tests (Node.js 18.x and 20.x)
- **Pipeline Validation**: Data structure and pipeline logic checks
- **Security Audit**: `npm audit` for vulnerabilities
- **Linting**: ESLint code quality checks
- **E2E Tests**: Playwright end-to-end tests

## Project Structure

```
chs-spots/
├── data/
│   ├── config/                 # Configuration files
│   │   ├── areas.json         # Area configuration
│   │   ├── config.json        # Pipeline state
│   │   ├── llm-instructions.txt
│   │   └── submenu-keywords.json
│   ├── reporting/            # Frontend data
│   │   ├── spots.json        # Curated spots
│   │   ├── venues.json       # All venues
│   │   └── areas.json        # Area config
│   ├── raw/                   # Raw HTML (today/, previous/, incremental/)
│   ├── silver_merged/         # Merged JSON (today/, previous/, incremental/)
│   ├── silver_trimmed/        # Trimmed JSON (today/, previous/, incremental/)
│   └── gold/                  # LLM extracted data
├── scripts/                   # Node.js scripts
│   ├── create-areas.js
│   ├── seed-venues.js
│   ├── run-incremental-pipeline.js
│   ├── download-raw-html.js
│   ├── merge-raw-files.js
│   ├── trim-silver-html.js
│   ├── delta-raw-files.js
│   ├── delta-trimmed-files.js
│   ├── extract-happy-hours.js
│   ├── create-spots.js
│   └── __tests__/            # Script unit tests
├── src/
│   ├── app/                  # Next.js app directory
│   ├── components/           # React components
│   └── contexts/            # React contexts
└── e2e/                      # Playwright E2E tests
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

### Google Maps Not Loading

- Verify `NEXT_PUBLIC_GOOGLE_MAPS_KEY` is set in `.env.local`
- Check API key has Maps JavaScript API enabled
- Ensure billing is enabled on Google Cloud project

### Script Errors

- Ensure Node.js 18+ is installed: `node --version`
- Check API keys are set in environment
- Review rate limiting - scripts have built-in delays
- Check network connectivity for website scraping

### Pipeline Issues

- Check `data/config/config.json` for state information
- Verify `last_run_status` - pipeline can resume from failures
- Review logs in `logs/` directory for detailed error messages
