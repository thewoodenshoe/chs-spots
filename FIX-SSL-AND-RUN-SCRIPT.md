# Fix SSL Certificate Issue & Run Script

## Fix SSL Certificate Issue for Git Push

The error `error setting certificate verify locations: CAfile: /etc/ssl/cert.pem CApath: none` means git can't find SSL certificates.

### Option 1: Configure Git to Use System Certificates (Recommended)

```bash
# For macOS (Homebrew)
brew install ca-certificates
git config --global http.sslCAInfo $(brew --prefix)/etc/ca-certificates/cert.pem

# Or use system certificates
git config --global http.sslCAInfo /etc/ssl/cert.pem
```

### Option 2: Use Homebrew's Certificates (if you have Homebrew)

```bash
# Find where Homebrew installed certificates
brew --prefix ca-certificates

# Then configure git
git config --global http.sslCAInfo $(brew --prefix)/etc/ca-certificates/cert.pem
```

### Option 3: Disable SSL Verification (Less Secure - Use Only if Others Fail)

```bash
# For this repository only (safer)
cd /Users/paulstewart/projects/chs-spots
git config http.sslVerify false

# Or globally (not recommended)
git config --global http.sslVerify false
```

### Option 4: Use SSH Instead of HTTPS

```bash
# Check your remote URL
git remote -v

# If it's https://, change to SSH
git remote set-url origin git@github.com:thewoodenshoe/chs-spots.git

# Then push
git push
```

### Test the Fix

```bash
git push
```

If it works, you're all set!

---

## Run the Happy Hour Update Script

### Quick Start

```bash
cd /Users/paulstewart/projects/chs-spots
node scripts/update-happy-hours.js
```

### What You'll See

The script will:
1. Load venues from `/data/venues.json`
2. Process each venue (takes 15-30 minutes for ~400 venues)
3. Show progress with emojis:
   - 🔍 Multi-location detection
   - 📍 Local page discovery  
   - 🔗 Submenu discovery
   - 🍹 Happy hour extraction
   - ✅ Success / ❌ Errors

### Output Files

After completion:
- **`/data/spots.json`** - Updated with happy hour information
- **`/data/restaurants-submenus.json`** - New inventory file with all discovered submenus

### Example Output

```
🍺 Starting Happy Hour Update Agent...

📁 Project root: /Users/paulstewart/projects/chs-spots
📄 Venues file: /Users/paulstewart/projects/chs-spots/data/venues.json
📄 Spots file: /Users/paulstewart/projects/chs-spots/data/spots.json

📖 Loaded 523 venues
🌐 Found 387 venues with websites

[1/387] Processing: Agaves Cantina
  🌐 http://www.agavescantina.com/
  📍 Area: Daniel Island
  🔍 Found multi-location site
  📍 Found 2 potential local page(s)
  ✅ Using local page: http://www.agavescantina.com/daniel-island
  🔗 Discovered 3 submenu(s)
  🍹 Found 2 happy hour snippet(s)
  ✅ Scanned: 2 happy hour snippet(s) from 3 subpage(s)
  ✨ Created new spot

...

📊 Summary:
   ✅ Processed: 387 venues
   🍹 Found happy hour info: 45 venues
   🏢 Multi-location sites detected: 23
   📍 Local pages used: 18
   🔗 Total submenus discovered: 156
   📄 Total spots in file: 90
```

### Stop the Script

Press `Ctrl+C` to stop at any time. Progress is saved incrementally.

### Run Again

You can run it multiple times - it will:
- Update existing spots with new information
- Add new spots for venues with newly discovered happy hours
- Append new sources to existing spots

---

## Troubleshooting

### "fetch is not available"
- You have Node.js 25.2.1 ✅ (which includes fetch)
- If you see this error, ensure you're using Node.js 18+

### Script is Slow
- Normal! Rate limiting (1.5-2.5s between requests) prevents overwhelming servers
- For 400 venues: expect 15-30 minutes

### Some Venues Fail
- Normal! Some websites may be down or block requests
- Script continues and logs errors

### No Happy Hour Found for Some Venues
- Not all restaurants post happy hour info online
- Script only updates spots where information is found