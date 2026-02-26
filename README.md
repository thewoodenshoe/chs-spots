# Charleston Finds

> **Built entirely by Claude Opus 4.6 (Orion).** Zero lines of human-written code. Architecture, frontend, backend, ETL pipeline, deployment — all AI-generated from natural language instructions.

A live map for discovering Charleston, SC — happy hours, rooftop bars, coffee shops, dog-friendly spots, must-see attractions, and more. Auto-updates nightly via AI-powered venue extraction.

**Live at [chsfinds.com](https://chsfinds.com)**

## What It Does

- **Interactive map + list view** with 8 Charleston neighborhoods and 7 activity categories
- **Auto-detects your location** and defaults to the nearest area
- **Nightly ETL pipeline** scrapes ~990 venue websites, diffs content, and uses Grok (xAI) to extract happy hour specials — only processing venues that actually changed
- **Community submissions** — anyone can add spots; admin approves via Telegram
- **Google Places integration** for accurate coordinates and photos
- **Share any spot** via deep link

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS |
| Map | Google Maps JavaScript API |
| Database | SQLite (better-sqlite3) |
| AI extraction | Grok API (xAI) |
| Admin | Telegram Bot API |
| Hosting | Ubuntu server, PM2, rsync deploys |

## Quick Start

```bash
git clone https://github.com/thewoodenshoe/chs-spots.git
cd chs-spots
npm install
cp .env.example .env.local   # fill in API keys
node scripts/migrate-to-sqlite.js
npm run dev
```

## Environment Variables

| Key | Description |
|-----|-------------|
| `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | Google Maps JavaScript API key |
| `GOOGLE_PLACES_SERVER_KEY` | Google Places API (venue seeding, photos) |
| `GROK_API_KEY` | xAI Grok API (happy hour extraction) |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token for spot approval |
| `TELEGRAM_ADMIN_CHAT_ID` | Your Telegram chat ID |
| `ADMIN_API_KEY` | Admin auth key for edit/delete |

## Project Structure

```
chs-spots/
├── src/
│   ├── app/            # Next.js pages + API routes
│   ├── components/     # Map, modals, list view, chips
│   ├── contexts/       # React contexts (spots, venues, activities)
│   └── lib/            # DAL (db.ts), Telegram integration
├── scripts/
│   ├── run-incremental-pipeline.js   # Nightly ETL
│   ├── seed-activity-spots.js        # Seed new activities (reusable)
│   ├── backfill-venue-photos.js      # Google Places photo download
│   └── utils/db.js                   # Script-side DAL
├── data/
│   ├── chs-spots.db    # SQLite database (gitignored)
│   ├── config/         # Static config (LLM prompts, keywords)
│   └── seeds/          # Activity seed data (JSON)
└── public/spots/       # Spot photos
```

## Nightly Pipeline

```bash
node scripts/run-incremental-pipeline.js
```

Downloads HTML from ~990 venues → merges → trims → diffs against previous run → extracts promotions via Grok (only changed venues). Typical daily cost: 5–15 LLM calls.

## Adding a New Activity

1. Create a seed file: `data/seeds/your-activity.json`
2. Insert the activity row into the `activities` table
3. Run the seed script:
   ```bash
   GOOGLE_PLACES_ENABLED=true node scripts/seed-activity-spots.js \
     --activity "Your Activity" --file data/seeds/your-activity.json --confirm
   ```

The script resolves coordinates and downloads photos via Google Places, then inserts approved spots.

## Spot Approval

User submits a spot → saved as `pending` → admin gets a Telegram message with Approve/Deny buttons → spot goes live or gets rejected.

## Deployment

```bash
npm run build
rsync -avz .next/ ubuntu:~/projects/chs-spots/.next/
rsync -avz --exclude node_modules --exclude .next --exclude data --exclude .env.local ./ ubuntu:~/projects/chs-spots/
ssh ubuntu "cd ~/projects/chs-spots && pm2 restart chs-spots"
```
