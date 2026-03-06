# Charleston Finds

> **Built entirely by Claude Opus 4.6 (Orion).** Zero lines of human-written code. Architecture, frontend, backend, ETL pipeline, deployment — all AI-generated from natural language instructions.

A live map for discovering Charleston, SC — happy hours, brunch, live music, rooftop bars, coffee shops, dog-friendly spots, landmarks, and more. Auto-updates nightly via AI-powered venue extraction and restaurant opening discovery.

**Live at [chsfinds.com](https://chsfinds.com)**

## What It Does

- **Interactive map + list view** with 8 Charleston neighborhoods and 9 activity types
- **Server-rendered pages** — homepage, individual spot/venue pages, and explore pages all render real data for SEO
- **Auto-detects your location** and defaults to the nearest area (falls back to Downtown if outside Charleston)
- **Nightly ETL pipeline** scrapes ~1,000 venue websites, diffs content, and uses Grok (xAI) to extract happy hour and brunch specials — only processing venues that changed
- **Nightly opening discovery** finds recently opened and coming soon restaurants via RSS feeds + Grok web search
- **Daily live music events** refreshed at 3 PM via Grok web search (tonight's performers, times)
- **Weekly live music venue discovery** via Grok web search
- **Venue data enrichment** — fills in missing address, phone, website via LLM + Google API
- **Community submissions** — anyone can add or edit spots; admin approves via Telegram
- **Open/Closed status** — operating hours extracted from venue websites, shown on cards and map pins
- **Share any spot** via deep link
- **PWA-ready** — installable to home screen via manifest.json

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS |
| Map | Google Maps JavaScript API |
| Database | SQLite (better-sqlite3) |
| AI extraction | Grok API (xAI) — extraction + web search |
| Admin | Telegram Bot API + local web admin UI |
| Analytics | Umami (self-hosted) |
| Hosting | Ubuntu server, PM2, Nginx, git-pull deploys |

## Quick Start

```bash
git clone https://github.com/thewoodenshoe/chs-spots.git
cd chs-spots
npm install
cp .env.example .env.local   # fill in API keys
npm run dev
```

## Development

```bash
npm run dev          # Start local dev server
npx jest --no-cache  # Run all tests (45 suites, 603 tests)
npm run build        # Production build
npm run admin        # Local admin UI: query/update spots (http://localhost:3456)
```

## Environment Variables

| Key | Description |
|-----|-------------|
| `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | Google Maps JavaScript API key |
| `GOOGLE_PLACES_SERVER_KEY` | Google Places API (venue seeding, photos) |
| `GROK_API_KEY` | xAI Grok API (extraction + web search) |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token for admin notifications |
| `TELEGRAM_ADMIN_CHAT_ID` | Admin Telegram chat ID |
| `ADMIN_API_KEY` | Admin auth key for edit/delete |
| `NEXT_PUBLIC_UMAMI_WEBSITE_ID` | Umami analytics website ID |
| `NEXT_PUBLIC_UMAMI_URL` | Umami analytics script URL |

## Pages & Routes

### Public Pages (SSR)

| Route | Description |
|-------|-------------|
| `/` | Homepage — server-rendered activity grid with real spot counts, featured deals, explore links. Client-side SPA mounts on top for interactivity. |
| `/spots/[id]` | Individual spot detail page — title, deals, promotion times, venue info, hours, map link, JSON-LD (LocalBusiness + BreadcrumbList). |
| `/venues/[id]` | Venue detail page — all associated spots, hours, contact info, JSON-LD with OfferCatalog schema. |
| `/explore/[slug]` | Area + activity pages (e.g., `/explore/happy-hour-in-downtown-charleston`) — SSG with FAQ schema, editorial content, internal links. |
| `/privacy` | Privacy policy. |

### API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/spots` | GET | List all approved spots (supports `?type=` and `?area=` filters) |
| `/api/spots` | POST | Submit a new spot (community or admin) |
| `/api/spots/[id]` | PUT | Update a spot (admin: direct update; user: creates pending edit for Telegram approval) |
| `/api/spots/[id]` | DELETE | Delete a spot (admin: immediate; user: creates pending delete for approval) |
| `/api/spots/report` | POST | Report a spot issue |
| `/api/venues` | GET | List all venues |
| `/api/venues/search` | GET | Search venues by name (`?q=`) |
| `/api/activities` | GET | List all activity types |
| `/api/activities/suggest` | POST | Suggest a new activity type |
| `/api/areas` | GET | List all area names |
| `/api/areas/config` | GET | Area config with center coordinates and zoom levels |
| `/api/health` | GET | Server health check (spot/venue counts, disk, env) |
| `/api/og-image` | GET | Dynamic OpenGraph image generation |
| `/api/feedback` | POST | Submit general feedback |
| `/api/telegram/webhook` | POST | Telegram bot webhook (handles commands and inline callbacks) |
| `/api/telegram/poll` | GET | Telegram long-polling fallback |

### SEO Assets

| Route | Description |
|-------|-------------|
| `/sitemap.xml` | Dynamic sitemap — homepage, explore pages, all approved spots, venues with active deals |
| `/robots.txt` | Allows all crawlers on `/`, blocks `/api/` |
| `/manifest.json` | PWA manifest for home screen installation |

## Telegram Bot Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all available commands |
| `/approve <spotId>` | Mark a spot's finding as approved (stops repeat flagging in reports) |
| `/delete <spotId>` | Delete a spot |
| `/info <spotId>` | Show full details for a spot |
| `/stats` | Database summary (spot/venue counts, breakdowns) |
| `/recent` | Show last 10 added spots |
| `/search <query>` | Search spots by title |
| `/idea <text>` | Submit a feature idea |
| `/ideas` | List all submitted ideas |

The bot also handles inline callbacks for approving/denying community submissions, edit proposals, delete requests, and activity suggestions.

## Admin UI

Local web interface at `http://localhost:3456/admin/` (or via Nginx proxy on the server). Managed by PM2 alongside the main app.

- **Spots tab** — search by title, filter by status dropdown, edit all fields inline
- **Venues tab** — search by name, edit address/phone/website/hours
- **Needs Review tab** — shows flagged items from the daily report logic (discovery, data quality, confidence), with severity and explanation of why each item was flagged
- Promotion list editing via one-item-per-line textarea (stored as JSON)
- Help tooltips for format-sensitive fields (promotion_time, etc.)
- Dirty field tracking with visual save indicators

## Project Structure

```
chs-spots/
├── src/
│   ├── app/                 # Next.js pages + API routes
│   │   ├── page.tsx         # Homepage (server component, SSR)
│   │   ├── HomeClient.tsx   # Homepage client-side SPA
│   │   ├── spots/[id]/      # Individual spot pages (SSR)
│   │   ├── venues/[id]/     # Individual venue pages (SSR)
│   │   ├── explore/[slug]/  # Area + activity pages (SSG)
│   │   ├── privacy/         # Privacy policy
│   │   ├── sitemap.ts       # Dynamic sitemap
│   │   ├── robots.ts        # Robots.txt
│   │   └── api/             # REST API routes
│   ├── components/          # Map, modals, list view, filters, cards
│   ├── contexts/            # React contexts (spots, venues, activities)
│   ├── lib/                 # DAL (db.ts), Telegram, rate-limit, cache
│   └── utils/               # Active status, time, distance, favorites, SEO helpers
├── scripts/
│   ├── download-raw-html.js         # Step 1: Download venue websites
│   ├── extract-promotions.js        # Step 2: LLM extraction via Grok
│   ├── create-spots.js              # Step 3: Create spots from gold data
│   ├── extract-hours.js             # Operating hours extraction (3-tier)
│   ├── discover-openings.js         # Nightly: find new/coming restaurants (venue-first)
│   ├── check-opening-status.js     # Nightly: transition Coming Soon → Recently Opened
│   ├── discover-live-music.js       # Weekly: find live music events
│   ├── enrich-venues.js             # Fill missing venue data via LLM + Google
│   ├── run-incremental-pipeline.js  # Orchestrates nightly ETL
│   ├── seed-venues.js               # Google Places venue seeding
│   ├── admin.html                   # Local admin UI
│   ├── serve-admin.js               # Admin server (port 3456)
│   ├── ops/
│   │   ├── generate-report.js       # Daily analytics + pipeline report
│   │   ├── run-nightly-pipeline.sh  # Cron: ETL + enrichment + report (3 AM)
│   │   ├── run-nightly-openings.sh  # Cron: opening discovery (2 AM)
│   │   ├── run-daily-live-music.sh  # Cron: event refresh (3 PM daily)
│   │   ├── run-weekly-live-music.sh # Cron: venue discovery (Wed 4 AM)
│   │   ├── run-biweekly-seed.sh     # Cron: venue discovery (1 AM)
│   │   └── run-monthly-hours.sh     # Cron: operating hours refresh
│   ├── utils/
│   │   ├── db.js                    # Script-side DAL (re-export hub)
│   │   ├── db-core.js               # Connection, audit, syncActivityFlags, generateVenueId
│   │   ├── db-venues.js             # Venue CRUD, upsert, updateStatus
│   │   ├── db-spots.js              # Spot CRUD, upsertAutomated, manual_override guards
│   │   ├── db-support.js            # Gold extractions, areas, activities, watchlist
│   │   ├── db-pipeline.js           # Pipeline state, runs, streaks, audit queries
│   │   ├── config.js                # Pipeline state + watchlist
│   │   ├── data-dir.js              # Path resolution
│   │   ├── normalize.js             # Text normalization
│   │   ├── logger.js                # Shared logging utility
│   │   ├── discover-rss.js          # RSS parsing + article classification
│   │   └── discover-places.js       # Google Places geocoding + area + dedup
│   └── db/schema.sql                # SQLite schema
├── data/
│   ├── chs-spots.db    # SQLite database (gitignored)
│   ├── config/         # Areas, activities, LLM prompts, watchlist
│   └── seeds/          # Activity seed data (JSON)
├── ecosystem.config.cjs  # PM2 config (chs-spots + chs-admin)
├── e2e/                  # Playwright E2E tests
├── logs/                 # Structured pipeline logs
└── public/               # Static assets, spot photos, PWA manifest
```

## Nightly Pipeline

| Time | Job | Script |
|------|-----|--------|
| 1:00 AM | Venue discovery (Google Places) | `run-biweekly-seed.sh` |
| 2:00 AM | Opening discovery + Coming Soon lifecycle check | `run-nightly-openings.sh` |
| 3:00 AM | ETL pipeline + venue enrichment + daily report | `run-nightly-pipeline.sh` |
| 3:00 PM | Live music event refresh (Grok web search) | `run-daily-live-music.sh` |
| 4:00 AM Wed | Live music venue discovery | `run-weekly-live-music.sh` |
| Monthly | Operating hours refresh | `run-monthly-hours.sh` |

**ETL flow:** Download HTML → merge → trim → diff → extract via Grok (only changed venues) → enrich missing venue data → create spots → generate report → send Telegram summary. Typical daily cost: 5–15 LLM calls.

## SEO

- Server-rendered homepage with real spot data (counts, featured deals, explore links)
- Individual `/spots/[id]` and `/venues/[id]` pages with unique metadata, JSON-LD (LocalBusiness, BreadcrumbList, OfferCatalog), and canonical URLs
- Explore pages with FAQ schema, editorial content, and `generateStaticParams` for SSG
- Dynamic sitemap including all approved spots and venues with active deals
- Per-page canonical URLs, keywords, and OpenGraph metadata
- WebSite schema with SearchAction on root layout

## Data Architecture

**Master-detail**: `venues` is the single source of truth for geo data, address, phone, website, photo. `spots` are activity-specific details always linked via `venue_id NOT NULL`.

| Concept | Implementation |
|---------|---------------|
| Venue status | `venue_status` column: `active`, `coming_soon`, `recently_opened` |
| Activity flags | Boolean columns on venues (`is_happy_hour`, `is_brunch`, etc.) auto-synced after spot mutations |
| Audit trail | `audit_log` table with `change_source` (`pipeline`/`admin`/`user`/`llm`) and `script_name` |
| Manual override | `manual_override=1` on spots protects human edits from automated overwrites |
| Venue IDs | Sequential `ven_NNNN` format; Google Place IDs stored in `google_place_id` column |

## Deployment

```bash
git push                                          # Push from laptop to GitHub
ssh ubuntu "cd ~/projects/chs-spots && git pull"  # Pull on server
ssh ubuntu "cd ~/projects/chs-spots && pm2 stop chs-spots && npm run build && pm2 restart chs-spots"
ssh ubuntu "curl -s http://localhost:3000/api/health"
```

PM2 manages two processes via `ecosystem.config.cjs`:
- `chs-spots` — Next.js production server (port 3000)
- `chs-admin` — Admin UI server (port 3456, LAN-only via Nginx)
