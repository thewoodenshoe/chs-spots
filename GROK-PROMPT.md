# Grok Prompt for Happy Hour Extraction

## Instructions

Upload one of the compressed JSON files (part-1.json, part-2.json, etc.) to Grok and use the following prompt:

---

## Prompt Text

```
Extract happy hour information from the restaurant/bar venue data in the uploaded JSON file.

For each venue in the "venues" array, analyze the HTML content in the "pages" array and extract structured happy hour information.

**Output Format:**
Return a JSON array with one object per venue that has happy hour information. Use this exact structure:

[
  {
    "venueId": "ChIJ...",
    "venueName": "Venue Name",
    "happyHour": {
      "found": true,
      "times": "Monday-Friday 4pm-7pm",
      "days": "Monday-Friday",
      "specials": [
        "$5 beers",
        "Half price appetizers"
      ],
      "source": "https://example.com/menu",
      "confidence": 0.95
    }
  },
  {
    "venueId": "ChIJ...",
    "venueName": "Another Venue",
    "happyHour": {
      "found": false,
      "reason": "No happy hour information found"
    }
  }
]

**Rules:**
1. Only include venues where "happyHour.found" is true in the final output (skip venues with no happy hour)
2. Extract specific times (e.g., "Monday-Friday 4pm-7pm", "Daily 5pm-7pm")
3. Extract days (e.g., "Monday-Friday", "Daily", "Weekdays")
4. Extract specials/deals as an array of strings (e.g., ["$5 beers", "Half price apps"])
5. Include the source URL where the happy hour information was found
6. Set confidence (0.0-1.0) based on how clear the information is
7. If no happy hour is found, set "found": false and provide a reason
8. Parse HTML text to find happy hour information - look for patterns like:
   - "Happy Hour", "Happy Hour", "HH"
   - Time ranges (4pm-7pm, 4-7, 16:00-19:00)
   - Days (Monday-Friday, Mon-Fri, Daily, Weekdays)
   - Specials (dollar amounts, percentages, descriptions)

**Important:**
- Extract times in a readable format (e.g., "4pm-7pm" not "16:00-19:00")
- Include source URL from the page where happy hour was found
- If multiple pages have happy hour info, use the most complete one
- Return only venues with "happyHour.found": true in the final array
- Be thorough - search through all HTML content in the pages array
```

---

## Usage

1. Run the compression script:
```bash
node scripts/compress-silver-merged-for-grok.js
```

2. Upload `data/silver_merged/compressed/part-1.json` to Grok

3. Paste the prompt above

4. Save the results as `data/gold/grok-results-part-1.json`

5. Repeat for part-2.json, part-3.json, etc.

6. Combine all results into a single file after processing all parts

---

## Expected Output Structure

```json
[
  {
    "venueId": "ChIJ...",
    "venueName": "The Kingstide",
    "happyHour": {
      "found": true,
      "times": "Monday-Thursday 3pm-9pm, Friday-Saturday 3pm-9:30pm, Sunday 3pm-9pm",
      "days": "Monday-Thursday, Friday-Saturday, Sunday",
      "specials": [
        "Drink specials",
        "Food specials"
      ],
      "source": "https://www.thekingstide.com/menu",
      "confidence": 0.95
    }
  }
]
```

---

## Notes

- Process each part file separately
- Only include venues with `happyHour.found: true` in the output
- Combine results after all parts are processed
- Save results to `data/gold/grok-results-part-*.json`
