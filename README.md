# Charleston Finds

> **Built entirely by Claude Opus 4.6 (Orion).** Zero lines of human-written code. Architecture, frontend, backend, ETL pipeline, deployment — all AI-generated from natural language instructions.

A live map for discovering Charleston, SC — happy hours, brunch, live music, rooftop bars, coffee shops, dog-friendly spots, landmarks, and more. Auto-updates nightly via AI-powered venue extraction and restaurant opening discovery.

**Live at [chsfinds.com](https://chsfinds.com)**

## What It Does

- **Interactive map + list view** with 7 Charleston neighborhoods and 7 activity types
- **Auto-detects your location** and defaults to the nearest area (falls back to Downtown if outside Charleston)
- **Nightly ETL pipeline** scrapes ~1,000 venue websites, diffs content, and uses Grok (xAI) to extract happy hour and brunch specials — only processing venues that changed
- **Nightly opening discovery** finds recently opened and coming soon restaurants via RSS feeds + Grok web search
- **Weekly live music discovery** via Grok web search
- **Community submissions** — anyone can add spots; admin approves via Telegram
- **Open/Closed status** — operating hours extracted from venue websites, shown on cards and map pins
- **Share any spot** via deep link

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS |
| Map | Google Maps JavaScript API |
| Database | SQLite (better-sqlite3) |
| AI extraction | Grok API (xAI) — extraction + web search |
| Admin | Telegram Bot API |
| Analytics | Umami (self-hosted) |
| Hosting | Ubuntu server, PM2, rsync deploys |

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
npx jest --no-cache  # Run all tests (41 suites, 564 tests)
npm run build        # Production build
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

## Project Structure

```
chs-spots/
├── src/
│   ├── app/            # Next.js pages + API routes
│   ├── components/     # Map, modals, list view, filters
│   ├── contexts/       # React contexts (spots, venues, activities)
│   ├── lib/            # DAL (db.ts), Telegram, rate-limit, cache
│   └── utils/          # Active status, time, distance, favorites
├── scripts/
│   ├── download-raw-html.js         # Step 1: Download venue websites
│   ├── extract-promotions.js        # Step 2: LLM extraction via Grok
│   ├── create-spots.js              # Step 3: Create spots from gold data
│   ├── extract-hours.js             # Operating hours extraction (3-tier)
│   ├── discover-openings.js         # Nightly: find new/coming restaurants
│   ├── discover-live-music.js       # Weekly: find live music events
│   ├── run-incremental-pipeline.js  # Orchestrates nightly ETL
│   ├── seed-venues.js               # Google Places venue seeding
│   ├── ops/
│   │   ├── generate-report.js       # Daily analytics + pipeline report
│   │   ├── run-nightly-pipeline.sh  # Cron: ETL + report (3 AM)
│   │   ├── run-nightly-openings.sh  # Cron: opening discovery (2 AM)
│   │   ├── run-weekly-live-music.sh # Cron: live music (Wed 4 AM)
│   │   ├── run-biweekly-seed.sh     # Cron: venue discovery (1 AM)
│   │   └── run-monthly-hours.sh     # Cron: operating hours refresh
│   ├── utils/
│   │   ├── db.js                    # Script-side DAL
│   │   ├── config.js                # Pipeline state + watchlist
│   │   ├── data-dir.js              # Path resolution
│   │   ├── normalize.js             # Text normalization
│   │   └── logger.js                # Shared logging utility
│   └── db/schema.sql                # SQLite schema
├── data/
│   ├── chs-spots.db    # SQLite database (gitignored)
│   ├── config/         # Areas, activities, LLM prompts, watchlist
│   └── seeds/          # Activity seed data (JSON)
├── e2e/                # Playwright E2E tests
├── logs/               # Structured pipeline logs
└── public/spots/       # Spot photos
```

## Nightly Pipeline

| Time | Job | Script |
|------|-----|--------|
| 1:00 AM | Venue discovery (Google Places) | `run-biweekly-seed.sh` |
| 2:00 AM | Opening discovery (RSS + Grok) | `run-nightly-openings.sh` |
| 3:00 AM | ETL pipeline + daily report | `run-nightly-pipeline.sh` |
| 4:00 AM Wed | Live music discovery | `run-weekly-live-music.sh` |
| Monthly | Operating hours refresh | `run-monthly-hours.sh` |

**ETL flow:** Download HTML → merge → trim → diff → extract via Grok (only changed venues) → create spots → generate report. Typical daily cost: 5–15 LLM calls.

## Deployment

```bash
npm run build
rsync -avz .next/ ubuntu:~/projects/chs-spots/.next/
rsync -avz --exclude node_modules --exclude .next --exclude data --exclude .env.local ./ ubuntu:~/projects/chs-spots/
ssh ubuntu "cd ~/projects/chs-spots && pm2 restart chs-spots"
```
