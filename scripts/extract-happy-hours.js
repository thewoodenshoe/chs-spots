const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });
const { GoogleGenerativeAI } = require('@google/generative-ai');
const crypto = require('crypto');

const SILVER_MERGED_DIR = path.join(__dirname, '../data/silver_merged/all');
const GOLD_DIR = path.join(__dirname, '../data/gold');
const BULK_COMPLETE_FLAG = path.join(GOLD_DIR, '.bulk-complete');
const INCREMENTAL_HISTORY_DIR = path.join(GOLD_DIR, 'incremental-history');

// Ensure gold and incremental history directories exist
if (!fs.existsSync(GOLD_DIR)) fs.mkdirSync(GOLD_DIR, { recursive: true });
if (!fs.existsSync(INCREMENTAL_HISTORY_DIR)) fs.mkdirSync(INCREMENTAL_HISTORY_DIR, { recursive: true });

async function extractHappyHours(isIncremental = false) {
    // Access your API key as an environment variable (see README)
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
        console.error('Error: GEMINI_API_KEY is not set in environment variables.');
        process.exit(1);
    }
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.0-pro" });
    console.log(`Starting happy hour extraction (${isIncremental ? 'incremental' : 'bulk'})...`);

    let venueFiles = [];
    try {
        venueFiles = fs.readdirSync(SILVER_MERGED_DIR).filter(file => file.endsWith('.json'));
    } catch (error) {
        console.error(`Error reading silver_merged directory: ${error.message}`);
        process.exit(1);
    }
    
    if (venueFiles.length === 0) {
        console.log('No venue files found in silver_merged/all/ directory.');
        return;
    }

    if (isIncremental && !fs.existsSync(BULK_COMPLETE_FLAG)) {
        console.warn('Bulk extraction not marked as complete. Running in incremental mode requires prior bulk extraction.');
        console.warn('Please run `npm run extract:bulk:prepare` and `npm run extract:bulk:process` first.');
        process.exit(1);
    }

    for (const file of venueFiles) {
        const venueId = path.basename(file, '.json');
        const silverFilePath = path.join(SILVER_MERGED_DIR, file);
        const goldFilePath = path.join(GOLD_DIR, `${venueId}.json`);

        let venueData;
        try {
            venueData = JSON.parse(fs.readFileSync(silverFilePath, 'utf8'));
        } catch (error) {
            console.error(`Error reading venue file ${file}: ${error.message}`);
            continue;
        }

        const sourceHash = crypto.createHash('md5').update(JSON.stringify(venueData.pages)).digest('hex');

        // Check if already processed and no changes for incremental mode
        if (isIncremental && fs.existsSync(goldFilePath)) {
            try {
                const existingGoldData = JSON.parse(fs.readFileSync(goldFilePath, 'utf8'));
                if (existingGoldData.sourceHash === sourceHash) {
                    console.log(`Skipping ${venueData.venueName} (${venueId}): No changes detected.`);
                    continue;
                }
            } catch (error) {
                console.warn(`Could not read existing gold file for ${venueId}, re-processing.`);
            }
        }
        
        console.log(`Processing ${venueData.venueName} (${venueId})...`);

        // Construct LLM Prompt
        const prompt = `
            You are an expert analyst and creative detective specializing in uncovering hidden or creatively named happy hour promotions on restaurant and bar websites. Your job is to be **extremely generous and open-minded**: capture **every possible** time-limited drink/food discount, deal, or special — even if it's not called "happy hour". Err on the side of inclusion with low confidence rather than missing something.

            The input is raw HTML text (merged from homepage + all submenus for one venue). Ignore garbage (scripts, navigation, footers, unrelated ads, reviews, cookie notices) and focus on menu, specials, bar, drinks, or promotion sections.

            Look for these patterns (be very creative and human-like):
            - Any time window + implied benefit/discount (e.g., "4-7pm", "5-7", "late afternoon", "early evening", "after work", "sunset", "twilight", "happy vibes")
            - Creative or coded names: "jolly hours", "heavy hour", "sunset specials", "after-work deals", "bar hour", "happy vibes hour", "discount hour", "deal time"
            - Buy-more-pay-less or combo deals during a period (e.g., "between 5-7 buy 3 pay 2", "2-for-1 from 4-6", "free appetizer with drink 5-7pm")
            - Dollar amounts, percentages off, "half off", "2-for-1", "dollar oysters", "cheap drinks", "pint specials" tied to a time
            - "Specials", "deals", "offers", "promotions", "bar bites" with time range
            - Typical happy hour windows: late afternoon to early night (3pm-8pm range, especially 4-7, 5-7, 3-6, etc.)

            Rules (do NOT violate):
            1. Never include regular business hours (e.g., "open 11am-10pm") unless explicitly tied to discounts/specials.
            2. Ignore unrelated "happy" words (happy customers, we're happy to serve, happy birthday, etc.).
            3. Ignore user reviews, testimonials, blog posts — only use the restaurant's own promotion text.
            4. Standardize days: "Monday-Friday", "Daily", "Every day", "Weekdays", "Tue-Thu", etc.
            5. If multiple promotions (early + late night), return as array in happyHour.entries.
            6. Confidence score (0–100):
               - 90–100: Explicit "happy hour" + clear days/times/specials
               - 70–89: Strong match (clear time + discount, no "happy hour" word)
               - 40–69: Partial/inferred (time range + some deal language)
               - 10–39: Very weak/creative/ambiguous (e.g., "jolly hours", "sunset deals")
               - 0–9: Almost certainly not — but still include if any hint
            7. For every confidence < 80, add a clear confidence_score_rationale explaining why the score is low.

            Output format (single JSON object for this venue):
            {
              "venueId": "${venueId}",
              "venueName": "${venueData.venueName}",
              "happyHour": {
                "found": true,
                "entries": [
                  {
                    "days": "Monday-Friday",
                    "times": "4pm-7pm",
                    "specials": ["$5 beers", "Half off appetizers"],
                    "source": "https://example.com/menu",
                    "confidence": 85,
                    "confidence_score_rationale": "Explicit 'happy hour' + times + specials — high clarity"
                  }
                ]
              }
            }
            OR if no happy hour found:
            {
              "venueId": "${venueId}",
              "venueName": "${venueData.venueName}",
              "happyHour": {
                "found": false,
                "reason": "No time-limited promotion or discount found - only business hours listed"
              }
            }

            Only include venues with at least one possible match (found: true), but low confidence is fine and encouraged for edge cases.

            Here is the website content for ${venueData.venueName} from various pages:
            ---
            ${venueData.pages.map(p => `URL: ${p.url}\nContent:\n${p.text}`).join('\n---\n')}
            ---
            `;

        let result;
        try {
            const chat = model.startChat({
                history: [
                    {
                        role: "user",
                        parts: [{ text: prompt }]
                    }
                ],
                generationConfig: {
                    maxOutputTokens: 2048,
                },
            });

            const response = await chat.sendMessage(prompt);
            const text = response.response.text();
            
            // Attempt to parse JSON, sometimes LLMs wrap it in markdown
            const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
            if (jsonMatch && jsonMatch[1]) {
                result = JSON.parse(jsonMatch[1]);
            } else {
                // Try to extract JSON from the response text
                const jsonStart = text.indexOf('{');
                const jsonEnd = text.lastIndexOf('}') + 1;
                if (jsonStart !== -1 && jsonEnd > jsonStart) {
                    result = JSON.parse(text.substring(jsonStart, jsonEnd));
                } else {
                    result = JSON.parse(text); // Try parsing directly
                }
            }

            // Handle new format: result may have happyHour property with entries
            // Or it may be the old format with found, times, days, etc. at top level
            if (result.happyHour) {
                // New format - use as is
                result = result.happyHour;
            } else if (result.found !== undefined) {
                // Old format - convert to new format with entries array
                if (result.found) {
                    result = {
                        found: true,
                        entries: [{
                            days: result.days || "Unknown",
                            times: result.times || "Unknown",
                            specials: result.specials || [],
                            source: result.source || venueData.pages[0]?.url || "Unknown",
                            confidence: result.confidence || 50,
                            confidence_score_rationale: result.confidence < 80 ? "Converted from old format" : undefined
                        }]
                    };
                } else {
                    result = {
                        found: false,
                        reason: result.reason || "No happy hour found"
                    };
                }
            }

        } catch (error) {
            console.error(`Error calling Gemini API for ${venueData.venueName} (${venueId}): ${error.message}`);
            result = { 
                found: false, 
                reason: `Error processing: ${error.message}`,
                error: error.message 
            };
        }

        // Add metadata to the gold record
        const goldRecord = {
            venueId: venueId,
            venueName: venueData.venueName,
            happyHour: result,
            sourceHash: sourceHash,
            processedAt: new Date().toISOString()
        };

        try {
            fs.writeFileSync(goldFilePath, JSON.stringify(goldRecord, null, 2), 'utf8');
            console.log(`Successfully processed ${venueData.venueName} and saved to ${goldFilePath}`);
        } catch (error) {
            console.error(`Error writing gold file for ${venueData.venueName}: ${error.message}`);
        }

        // Add a small delay to avoid hitting API rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    console.log('Happy hour extraction complete.');
}

// Export function for testing
module.exports = extractHappyHours;

// Main execution logic (only run if script is executed directly, not when imported)
if (require.main === module) {
    const isIncrementalMode = process.argv.includes('--incremental');

    if (isIncrementalMode) {
        extractHappyHours(true);
    } else {
        // Default to a full bulk automated run if no flags are provided
        console.log('No mode specified. Defaulting to full automated extraction.');
        extractHappyHours(false);
    }
}
