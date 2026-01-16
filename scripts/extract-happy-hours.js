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
            You are an expert at extracting happy hour information from website content.
            Analyze the following text from a restaurant/bar website. Identify any happy hour specials,
            including their times, days, and specific offers (e.g., "$5 Beers", "Half-off appetizers").
            It is crucial to differentiate happy hours from regular business hours. Happy hours often
            have specific time ranges (e.g., "4pm-6pm", "Monday-Friday") and mention "specials" or "deals".
            Business hours typically cover longer periods (e.g., "11am-10pm daily").
            Also, be aware of non-standard naming conventions for happy hour (e.g., "Heavy's Hour" instead of "Happy Hour").

            If happy hour information is found, return a JSON object in the following format:
            {
              "found": true,
              "times": "e.g., 4pm-7pm",
              "days": "e.g., Monday-Friday",
              "specials": ["e.g., $5 draft beers", "e.g., half-price appetizers"],
              "source": "URL where happy hour was found, or homepage if general",
              "confidence": 1 to 100 (your confidence in the extraction)
            }
            If no happy hour information is clearly identifiable, return:
            {
              "found": false,
              "confidence": 1 to 100 (your confidence that no happy hour was found)
            }

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
                result = JSON.parse(text); // Try parsing directly
            }

        } catch (error) {
            console.error(`Error calling Gemini API for ${venueData.venueName} (${venueId}): ${error.message}`);
            result = { found: false, confidence: 0, error: error.message };
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
