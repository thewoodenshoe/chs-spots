# CHS Finds

A crowdsourced map for discovering local hotspots in Charleston, SC — happy hours, fishing spots, sunset views, and more. Built with Next.js, Google Maps, and AI-powered venue extraction.

## Quick Start

```bash
git clone https://github.com/thewoodenshoe/chs-spots.git
cd chs-spots
npm install
cp .env.example .env.local  # Then fill in your API keys
npm run dev
```

## Environment Variables

Create `.env.local` with these keys:

| Key | Required | Description |
|-----|----------|-------------|
| `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | Yes | Google Maps JavaScript API key |
| `GOOGLE_PLACES_SERVER_KEY` | Yes | Google Places API key (for venue seeding) |
| `GROK_API_KEY` | Yes | Grok API key for LLM happy hour extraction |
| `TELEGRAM_BOT_TOKEN` | Yes | Telegram bot token (from BotFather) for spot approval |
| `TELEGRAM_ADMIN_CHAT_ID` | Yes | Your Telegram chat ID (send `/start` to your bot to get it) |
| `ADMIN_API_KEY` | Production | Strong random string for admin auth (edit/delete spots). No default. |
| `TELEGRAM_WEBHOOK_SECRET` | Optional | Secret token for webhook verification; set in Telegram `setWebhook` and this env. |
| `SERVER_PUBLIC_URL` | Ops | e.g. `https://chsfinds.com` for report links and Telegram messages. |

## Production / Security

- **Admin auth**: Set `ADMIN_API_KEY` in `.env.local` to a strong random string. Visit `https://yoursite.com?admin=YOUR_KEY` once to enable admin mode in the browser; the same key is used for API auth.
- **Google Maps API key**: In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), restrict the Maps JavaScript API key to **HTTP referrers**: `https://chsfinds.com/*`, `https://www.chsfinds.com/*` (and `http://localhost:*` for dev). This prevents key theft.
- **Telegram webhook**: If using the webhook (not polling), set `TELEGRAM_WEBHOOK_SECRET` and pass the same value when calling Telegram’s `setWebhook` so only Telegram can trigger approve/deny.

## Configuration

All config lives in `data/config/`:

- **`config.json`** — Pipeline state (run dates, status, `maxIncrementalFiles` threshold)
- **`areas.json`** — Geographic area definitions
- **`activities.json`** — Activity types (Happy Hour, Fishing, etc.) with icons/colors
- **`llm-instructions.txt`** — LLM prompt template
- **`submenu-keywords.json`** — Keywords for discovering venue subpages

## Initial Setup

```bash
# 1. Create area definitions
node scripts/create-areas.js

# 2. Seed venues from Google Places (costs money — use carefully)
GOOGLE_PLACES_ENABLED=true node scripts/seed-venues.js --confirm

# 3. Run the full pipeline
node scripts/run-incremental-pipeline.js
```

## Nightly Pipeline

```bash
node scripts/run-incremental-pipeline.js [run_date] [area-filter]
```

The pipeline automatically:
1. **Downloads** raw HTML from all venue websites
2. **Merges** HTML files per venue into single JSON
3. **Trims** HTML to visible text only (80-90% size reduction)
4. **Compares** trimmed content against previous run (normalized hashing strips dates, tracking IDs, dynamic noise)
5. **Extracts** happy hours via Grok API — only for venues with real content changes
6. **Creates** spots.json for the frontend

### How Multi-Day Runs Work

| Scenario | What happens |
|----------|-------------|
| **Day 1 (first run)** | Downloads all ~989 venues, processes everything, bulk LLM extraction |
| **Day 2** | Archives yesterday's data to `previous/`, downloads fresh, delta finds ~10-20 real changes |
| **Same-day rerun** | Skips download, delta finds ~0 changes |
| **Manual re-run** | Edit `config.json`: set `last_raw_processed_date` to yesterday to force a new-day workflow |

### Cost Control

- **Normalized hashing** at the `silver_trimmed` layer strips dates, GTM IDs, tracking params, copyright footers — prevents false positives
- **Normalized source hash in gold files** means even if delta flags a venue as "changed", the LLM step skips it if the meaningful content hasn't changed
- **`maxIncrementalFiles`** in config.json (default: 15) — if more files are flagged, pipeline gracefully shuts down without calling LLM
- Typical daily LLM calls: **5-15 venues** (vs 200+ without normalization)

### Pipeline Recovery

`last_run_status` in config.json tracks progress. If the pipeline fails:
- It saves `failed_at_raw`, `failed_at_merged`, `failed_at_trimmed`, or `failed_at_extract`
- Next run automatically resumes from the failed step

## Spot Approval (Telegram)

When a user submits a new spot:
1. Spot is saved with `status: 'pending'` (hidden from regular users)
2. Admin receives a Telegram message with **Approve** / **Deny** buttons
3. Admin taps a button — spot becomes visible or gets rejected

### Setup

1. Create a bot via [@BotFather](https://t.me/BotFather)
2. Send `/start` to your bot — it replies with your chat ID
3. Add both to `.env.local`:
   ```
   TELEGRAM_BOT_TOKEN=your_token
   TELEGRAM_ADMIN_CHAT_ID=your_chat_id
   ```
4. **Webhook mode** (if server is publicly accessible):
   ```bash
   curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://your-domain/api/telegram/webhook"
   ```
5. **Polling mode** (if no public URL): Call `GET /api/telegram/poll` periodically (e.g., via cron every 5s)

### Admin Access

Visit your app with `?admin=amsterdam` to enable admin mode (persists in localStorage). Admin users see pending spots on the map with a "Pending Approval" badge.

## Tech Stack

- **Next.js 16** + React 19 + TypeScript
- **Google Maps API** — markers, clustering, geolocation
- **Grok API (xAI)** — AI happy hour extraction
- **Telegram Bot API** — spot approval workflow
- **Tailwind CSS** — styling
- **Jest** + **Playwright** — testing

## Testing

```bash
npm test                    # Unit tests (Jest)
npm run test:pipeline       # Pipeline validation
npm run test:e2e            # E2E tests (Playwright)
```

## CI

GitHub Actions runs on push/PR to `main` or `feature/**`: build, lint, Jest tests, pipeline validation, security audit, and Playwright E2E tests across Node.js 18.x and 20.x.

## Project Structure

```
chs-spots/
├── data/
│   ├── config/              # Config files (areas, activities, pipeline state)
│   ├── reporting/           # Frontend data (spots.json, venues.json, areas.json)
│   ├── raw/                 # Raw HTML (today/, previous/)
│   ├── silver_merged/       # Merged JSON per venue (today/)
│   ├── silver_trimmed/      # Trimmed text (today/, previous/, incremental/)
│   └── gold/                # LLM-extracted happy hour data
├── scripts/
│   ├── run-incremental-pipeline.js   # Master pipeline script
│   ├── download-raw-html.js          # Step 1: Download
│   ├── merge-raw-files.js            # Step 2: Merge
│   ├── trim-silver-html.js           # Step 3: Trim
│   ├── delta-trimmed-files.js        # Step 3.5: Delta comparison
│   ├── extract-promotions.js          # Step 4: LLM extraction (happy hours + brunch)
│   ├── create-spots.js               # Step 5: Generate spots
│   └── utils/                        # Shared utilities (config, normalize)
├── src/
│   ├── app/                 # Next.js app router (pages + API routes)
│   ├── components/          # React components (Map, Modals, Toast, ErrorBoundary)
│   ├── contexts/            # React contexts (Spots, Venues, Activities)
│   └── lib/                 # Server utilities (Telegram)
├── logs/                    # Pipeline run logs (gitignored)
└── e2e/                     # Playwright E2E tests
```

## Troubleshooting

- **Pipeline stuck**: Check `data/config/config.json` — reset `last_run_status` to `idle`
- **Too many LLM calls**: Increase `maxIncrementalFiles` in config or check normalization
- **Maps not loading**: Verify `NEXT_PUBLIC_GOOGLE_MAPS_KEY` in `.env.local`
- **Telegram not working**: Ensure `TELEGRAM_ADMIN_CHAT_ID` is set (send `/start` to your bot)
- **Edit/delete broken**: Should now work — was fixed (path mismatch bug)
