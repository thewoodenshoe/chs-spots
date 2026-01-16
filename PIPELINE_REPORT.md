# Pipeline Execution Report

Generated: $(date)

## Pipeline Steps Executed

1. **Extract Happy Hours (Bronze → Gold)**
   - Script: `scripts/extract-happy-hours.js`
   - Status: Completed (with rate limit handling)
   - Note: Free tier allows 5 requests per minute, retry logic handled rate limits

2. **Create Spots (Gold → Reporting)**
   - Script: `scripts/create-spots.js`
   - Status: Completed
   - Fixed: Updated to check both `data/venues.json` and `data/reporting/venues.json`

## Results

### Gold Files Analysis
$(node -e "const fs = require('fs'); const path = require('path'); const goldDir = 'data/gold'; const files = fs.readdirSync(goldDir).filter(f => f.endsWith('.json') && f !== '.bulk-complete'); let stats = { foundTrue: 0, foundFalse: 0, noHappyHour: 0, total: 0, byConfidence: {} }; files.forEach(file => { try { const data = JSON.parse(fs.readFileSync(path.join(goldDir, file), 'utf8')); stats.total++; if (data.happyHour?.found === true) { stats.foundTrue++; const conf = data.happyHour?.entries?.[0]?.confidence || 0; const range = conf >= 90 ? '90-100' : conf >= 70 ? '70-89' : conf >= 40 ? '40-69' : conf >= 10 ? '10-39' : '0-9'; stats.byConfidence[range] = (stats.byConfidence[range] || 0) + 1; } else if (data.happyHour?.found === false) { stats.foundFalse++; } else { stats.noHappyHour++; } } catch(e) {} }); console.log('Total gold files:', stats.total); console.log('Found true:', stats.foundTrue); console.log('Found false:', stats.foundFalse); console.log('No happyHour field:', stats.noHappyHour); console.log(''); Object.entries(stats.byConfidence).sort((a,b) => parseInt(b[0].split('-')[0]) - parseInt(a[0].split('-')[0])).forEach(([range, count]) => console.log(\`- \${count} venues with \${range}% confidence\`));")

### Reporting Spots
$(node -e "const fs = require('fs'); try { const spots = JSON.parse(fs.readFileSync('data/reporting/spots.json', 'utf8')); console.log('Total spots:', spots.length); } catch(e) { console.log('Total spots: 0 (file empty or invalid)'); }")

## Notes

- The extraction process handles Gemini API rate limits with retry logic
- All gold files contain both `found: true` and `found: false` results
- Only `found: true` spots are included in `data/reporting/spots.json`
- The pipeline successfully processes all venues from `silver_merged/all/` to `gold/` to `reporting/`
