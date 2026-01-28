const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });
// node-fetch v3 is ESM, but we need to handle CommonJS require
const fetchModule = require('node-fetch');
const fetch = typeof fetchModule === 'function' ? fetchModule : fetchModule.default;
const crypto = require('crypto');

const SILVER_TRIMMED_DIR = path.join(__dirname, '../data/silver_trimmed/today');
const SILVER_TRIMMED_INCREMENTAL_DIR = path.join(__dirname, '../data/silver_trimmed/incremental');
const GOLD_DIR = path.join(__dirname, '../data/gold');
const BULK_COMPLETE_FLAG = path.join(GOLD_DIR, '.bulk-complete');
const INCREMENTAL_HISTORY_DIR = path.join(GOLD_DIR, 'incremental-history');
const LLM_INSTRUCTIONS_PATH = path.join(__dirname, '../data/config/llm-instructions.txt');
const CONFIG_PATH = path.join(__dirname, '../data/config/config.json');
const VENUES_JSON_PATH = path.join(__dirname, '../data/reporting/venues.json');
const LLM_CANDIDATES_HISTORY_PATH = path.join(__dirname, '../logs/llm-candidates-history.txt');
const { updateConfigField } = require('./utils/config');

// Ensure gold and incremental history directories exist
if (!fs.existsSync(GOLD_DIR)) fs.mkdirSync(GOLD_DIR, { recursive: true });
if (!fs.existsSync(INCREMENTAL_HISTORY_DIR)) fs.mkdirSync(INCREMENTAL_HISTORY_DIR, { recursive: true });

async function extractHappyHours(isIncremental = false) {
    // Access your API key as an environment variable (see README)
    const GROK_API_KEY = process.env.GROK_API_KEY;
    if (!GROK_API_KEY) {
        console.error('Error: GROK_API_KEY is not set in environment variables.');
        process.exit(1);
    }
    const GROK_API_URL = 'https://api.x.ai/v1/chat/completions';
    const GROK_MODEL = 'grok-4-fast-reasoning'; // Faster model with good reasoning, higher rate limits
    console.log(`Starting happy hour extraction (${isIncremental ? 'incremental' : 'bulk'})...`);

    // INCREMENTAL MODE: Only process venues in silver_trimmed/incremental/
    let venueFiles = [];
    let sourceDir = SILVER_TRIMMED_DIR;
    
    if (isIncremental) {
        // Incremental mode: only process files in incremental folder
        if (!fs.existsSync(SILVER_TRIMMED_INCREMENTAL_DIR)) {
            console.log(`⏭️  No incremental files found in ${SILVER_TRIMMED_INCREMENTAL_DIR}`);
            console.log(`   Incremental folder is empty - nothing to extract.`);
            console.log(`\n✨ Skipped extraction (incremental mode - no changes)`);
            return;
        }
        sourceDir = SILVER_TRIMMED_INCREMENTAL_DIR;
    }
    
    try {
        venueFiles = fs.readdirSync(sourceDir).filter(file => file.endsWith('.json'));
    } catch (error) {
        console.error(`Error reading silver_trimmed directory: ${error.message}`);
        console.error(`Please run 'node scripts/trim-silver-html.js' first.`);
        process.exit(1);
    }
    
    if (venueFiles.length === 0) {
        if (isIncremental) {
            console.log(`⏭️  No incremental files found in ${SILVER_TRIMMED_INCREMENTAL_DIR}`);
            console.log(`   Incremental folder is empty - nothing to extract.`);
            console.log(`\n✨ Skipped extraction (incremental mode - no changes)`);
        } else {
            console.log('No venue files found in silver_trimmed/today/ directory.');
            console.log('Please run \'node scripts/trim-silver-html.js\' first.');
        }
        return;
    }
    
    if (isIncremental) {
        console.log(`📁 Found ${venueFiles.length} venue file(s) in incremental folder.`);
    }

    // COST FAIL-SAFE: Check maxIncrementalFiles limit before processing
    if (isIncremental) {
        let maxIncrementalFiles = 15; // Default value
        try {
            if (fs.existsSync(CONFIG_PATH)) {
                const configContent = fs.readFileSync(CONFIG_PATH, 'utf8');
                const config = JSON.parse(configContent);
                if (config.pipeline && typeof config.pipeline.maxIncrementalFiles === 'number') {
                    maxIncrementalFiles = config.pipeline.maxIncrementalFiles;
                }
            }
        } catch (error) {
            console.warn(`Warning: Could not read config from ${CONFIG_PATH}, using default maxIncrementalFiles=15`);
        }

        // Hard abort if too many files (unless -1 means unlimited)
        if (maxIncrementalFiles !== -1 && venueFiles.length > maxIncrementalFiles) {
            const errorMsg = `Too many incremental files (${venueFiles.length} > ${maxIncrementalFiles}). Manual review required.`;
            console.error('\x1b[31m%s\x1b[0m', `ABORTING: ${errorMsg}`);
            updateConfigField('last_run_status', 'failed_at_extract');
            process.exit(1);
        }
    }

    // Log LLM candidates to history file (incremental mode only, after fail-safe check)
    if (isIncremental && venueFiles.length > 0) {
        try {
            // Ensure logs directory exists
            const logsDir = path.dirname(LLM_CANDIDATES_HISTORY_PATH);
            if (!fs.existsSync(logsDir)) {
                fs.mkdirSync(logsDir, { recursive: true });
            }

            // Get today's date in YYYY-MM-DD format
            const today = new Date().toISOString().split('T')[0];

            // Load venues.json to get venue names and areas
            let venues = [];
            if (fs.existsSync(VENUES_JSON_PATH)) {
                try {
                    const venuesContent = fs.readFileSync(VENUES_JSON_PATH, 'utf8');
                    venues = JSON.parse(venuesContent);
                    if (!Array.isArray(venues)) {
                        venues = [];
                    }
                } catch (error) {
                    console.warn(`Warning: Could not read venues.json: ${error.message}`);
                }
            }

            // Build venue lookup map by id
            const venueMap = new Map();
            venues.forEach(venue => {
                if (venue.id) {
                    venueMap.set(venue.id, {
                        name: venue.name || 'Unknown',
                        area: venue.area || 'Unknown'
                    });
                }
            });

            // Build log entry for today
            let logEntry = `date ${today}:\n`;
            for (const file of venueFiles) {
                const venueId = path.basename(file, '.json');
                const venueInfo = venueMap.get(venueId) || { name: 'Unknown', area: 'Unknown' };
                logEntry += `venueId: ${venueId}\n`;
                logEntry += `venueName: ${venueInfo.name}\n`;
                logEntry += `venueArea: ${venueInfo.area}\n`;
                logEntry += '\n';
            }
            // Add blank line after last venue
            logEntry += '\n';

            // Append to history file
            fs.appendFileSync(LLM_CANDIDATES_HISTORY_PATH, logEntry, 'utf8');
        } catch (error) {
            console.warn(`Warning: Could not write to LLM candidates history: ${error.message}`);
            // Don't abort - logging is non-critical
        }
    }

    // Check if bulk extraction is complete (either flag exists OR gold files exist)
    if (isIncremental) {
        const hasBulkCompleteFlag = fs.existsSync(BULK_COMPLETE_FLAG);
        const hasGoldFiles = fs.existsSync(GOLD_DIR) && 
            fs.readdirSync(GOLD_DIR).filter(f => f.endsWith('.json') && f !== 'bulk-results.json').length > 0;
        
        if (!hasBulkCompleteFlag && !hasGoldFiles) {
            console.warn('Bulk extraction not marked as complete. Running in incremental mode requires prior bulk extraction.');
            console.warn('Please run `npm run extract:bulk:prepare` and `npm run extract:bulk:process` first.');
            process.exit(1);
        }
        
        // If gold files exist but flag doesn't, create the flag for future runs
        if (!hasBulkCompleteFlag && hasGoldFiles) {
            console.log('📝 Gold files found but .bulk-complete flag missing - creating flag for future runs...');
            fs.writeFileSync(BULK_COMPLETE_FLAG, new Date().toISOString(), 'utf8');
        }
    }

    for (const file of venueFiles) {
        const venueId = path.basename(file, '.json');
        const silverFilePath = path.join(sourceDir, file);
        const goldFilePath = path.join(GOLD_DIR, `${venueId}.json`);

        let venueData;
        try {
            venueData = JSON.parse(fs.readFileSync(silverFilePath, 'utf8'));
        } catch (error) {
            console.error(`Error reading venue file ${file}: ${error.message}`);
            continue;
        }

        // Create hash from pages content (text or html) for change detection
        // Use text field if available (from silver_trimmed), otherwise fallback to html
        const pagesContent = venueData.pages.map(p => p.text || p.html || '').join('\n');
        const sourceHash = crypto.createHash('md5').update(pagesContent).digest('hex');

        // Check if already processed and no changes (works in both bulk and incremental modes)
        // Skip LLM call if content hasn't changed - saves API costs
        if (fs.existsSync(goldFilePath)) {
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

        // Load LLM instructions from config file
        let llmInstructions;
        try {
            llmInstructions = fs.readFileSync(LLM_INSTRUCTIONS_PATH, 'utf8');
        } catch (error) {
            console.error(`Error reading LLM instructions from ${LLM_INSTRUCTIONS_PATH}: ${error.message}`);
            process.exit(1);
        }

        // Replace placeholders in the instructions template
        // Use 'text' field if available (from silver_trimmed), otherwise fallback to 'html'
        const contentPlaceholder = venueData.pages.map(p => {
            const content = p.text || p.html || '';
            return `URL: ${p.url}\nContent:\n${content}`;
        }).join('\n---\n');
        const prompt = llmInstructions
            .replace(/{VENUE_ID}/g, venueId)
            .replace(/{VENUE_NAME}/g, venueData.venueName)
            .replace(/{CONTENT_PLACEHOLDER}/g, contentPlaceholder);

        let result;
        let retries = 3;
        let delay = 1000; // Start with 1 second delay
        
        while (retries > 0) {
            let response;
            try {
                response = await fetch(GROK_API_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${GROK_API_KEY}`
                    },
                    body: JSON.stringify({
                        model: GROK_MODEL,
                        messages: [
                            {
                                role: 'user',
                                content: prompt
                            }
                        ],
                        stream: false,
                        max_tokens: 2048,
                        temperature: 0.7
                    })
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    // If we get a 429 (Too Many Requests), abort immediately
                    if (response.status === 429) {
                        console.error(`\n❌ Rate limit exceeded (HTTP 429): ${errorData.error?.message || response.statusText}`);
                        console.error(`   Aborting extraction. Please wait and try again later.`);
                        console.error(`   Processed up to: ${venueData.venueName} (${venueId})`);
                        if (isIncremental) {
                            updateConfigField('last_run_status', 'failed_at_extract');
                        }
                        process.exit(1);
                    }
                    throw new Error(`HTTP ${response.status}: ${errorData.error?.message || response.statusText}`);
                }

                const data = await response.json();
                const text = data.choices[0]?.message?.content || '';
            
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
                
                // Success - break out of retry loop
                break;
                
            } catch (error) {
                // Check if this is a 429 error from the error message (in case it wasn't caught in response.ok check)
                const statusCode = error.message?.match(/HTTP (\d+)/)?.[1];
                if (statusCode === 429 || statusCode === '429') {
                    console.error(`\n❌ Rate limit exceeded (HTTP 429): Too Many Requests`);
                    console.error(`   Aborting extraction. Please wait and try again later.`);
                    console.error(`   Processed up to: ${venueData.venueName} (${venueId})`);
                    console.error(`   Error: ${error.message}`);
                    if (isIncremental) {
                        updateConfigField('last_run_status', 'failed_at_extract');
                    }
                    process.exit(1);
                }
                
                retries--;
                
                // Other errors - retry or give up
                if (retries > 0) {
                    console.log(`   ⚠️  Error: ${error.message}, retrying... (${retries} retries left)`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= 2; // Exponential backoff
                    continue;
                }
                
                // Out of retries
                console.error(`Error calling Grok API for ${venueData.venueName} (${venueId}): ${error.message}`);
                result = { 
                    found: false, 
                    reason: `Error processing: ${error.message}`,
                    error: error.message 
                };
                break;
            }
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
    
    // Update status on successful completion (incremental mode only)
    if (isIncremental) {
        updateConfigField('last_run_status', 'completed_successfully');
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
