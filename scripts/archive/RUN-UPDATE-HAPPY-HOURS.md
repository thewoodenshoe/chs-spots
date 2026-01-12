# How to Run the Happy Hour Update Script

## Prerequisites

1. **Node.js 18+** (for built-in fetch support)
2. **Google Maps API Key** in `.env.local` or environment:
   - `NEXT_PUBLIC_GOOGLE_MAPS_KEY` or `GOOGLE_PLACES_KEY`

## Running the Script

### Basic Run

```bash
cd /Users/paulstewart/projects/chs-spots
node scripts/update-happy-hours.js
```

### With Environment Variables

If you need to load environment variables:

```bash
# Using dotenv (if installed)
node -r dotenv/config scripts/update-happy-hours.js

# Or set directly
NEXT_PUBLIC_GOOGLE_MAPS_KEY=your_key_here node scripts/update-happy-hours.js
```

## What the Script Does

1. **Loads venues** from `/data/venues.json`
2. **Processes each venue** with a website:
   - Detects multi-location sites
   - Finds local pages (e.g., Daniel Island, Mount Pleasant)
   - Discovers submenu pages (menu, happy-hour, specials, etc.)
   - Extracts happy hour information
3. **Updates spots** in `/data/spots.json`
4. **Creates inventory** in `/data/restaurants-submenus.json`

## Output Files

- **`/data/spots.json`** - Updated with happy hour spots
- **`/data/restaurants-submenus.json`** - One-time inventory of all discovered submenus

## Rate Limiting

The script includes polite rate limiting (1500-2500ms between requests) to avoid overwhelming servers.

## Expected Runtime

For ~400 venues with websites, expect:
- **Time**: 15-30 minutes (depending on network speed)
- **Requests**: ~400-800+ (homepage + subpages per venue)

## Monitoring Progress

The script logs progress for each venue:
- 🔍 Multi-location detection
- 📍 Local page discovery
- 🔗 Submenu discovery
- 🍹 Happy hour snippet extraction
- ✅ Success/❌ Error status

## Troubleshooting

### "fetch is not available"
- Ensure Node.js 18+ is installed: `node --version`

### SSL/Certificate Errors
- The script uses built-in fetch which should handle SSL automatically
- If issues persist, check your network/firewall settings

### Timeout Errors
- Some websites may be slow or unavailable
- The script will skip failed requests and continue

### No Happy Hour Found
- Not all venues have happy hour information on their websites
- The script will only update spots where information is found