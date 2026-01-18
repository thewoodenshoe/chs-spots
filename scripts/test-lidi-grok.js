const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });

// Load dependencies
const fetchModule = require('node-fetch');
const fetch = typeof fetchModule === 'function' ? fetchModule : fetchModule.default;

const GROK_API_KEY = process.env.GROK_API_KEY;
if (!GROK_API_KEY) {
    console.error('Error: GROK_API_KEY is not set');
    process.exit(1);
}

// Load venue data
const venueFile = path.join(__dirname, '../data/silver_trimmed/all/ChIJz_jMVeVv_ogR5dVUOkNnOSc.json');
const venueData = JSON.parse(fs.readFileSync(venueFile, 'utf8'));

// Load LLM instructions
const instructionsPath = path.join(__dirname, '../data/config/llm-instructions.txt');
const llmInstructions = fs.readFileSync(instructionsPath, 'utf8');

// Construct prompt (matching extract-happy-hours.js format)
const venueId = 'ChIJz_jMVeVv_ogR5dVUOkNnOSc';
const contentPlaceholder = venueData.pages.map(p => {
    const content = p.text || p.html || '';
    return `URL: ${p.url}\nContent:\n${content}`;
}).join('\n---\n');

const prompt = llmInstructions
    .replace(/{VENUE_ID}/g, venueId)
    .replace(/{VENUE_NAME}/g, venueData.venueName)
    .replace(/{CONTENT_PLACEHOLDER}/g, contentPlaceholder);

console.log('=== Testing Grok API with Ristorante LIDI ===');
console.log('Venue:', venueData.venueName);
console.log('Venue ID:', venueId);
console.log('Prompt length:', prompt.length, 'characters');
console.log('');

// Call Grok API
const GROK_API_URL = 'https://api.x.ai/v1/chat/completions';
const GROK_MODEL = 'grok-4-latest';

(async () => {
    try {
        const response = await fetch(GROK_API_URL, {
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
            console.error('❌ ERROR: HTTP', response.status);
            console.error('Message:', errorData.error?.message || response.statusText);
            process.exit(1);
        }

        const data = await response.json();
        const text = data.choices[0]?.message?.content || '';

        console.log('=== Grok API Response ===');
        console.log(text);
        console.log('');
        
        // Parse the response JSON (matching extract-happy-hours.js logic)
        let result;
        try {
            const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
            if (jsonMatch && jsonMatch[1]) {
                result = JSON.parse(jsonMatch[1]);
            } else {
                const jsonStart = text.indexOf('{');
                const jsonEnd = text.lastIndexOf('}') + 1;
                if (jsonStart !== -1 && jsonEnd > jsonStart) {
                    result = JSON.parse(text.substring(jsonStart, jsonEnd));
                } else {
                    result = JSON.parse(text);
                }
            }
            
            console.log('=== Parsed JSON ===');
            console.log(JSON.stringify(result, null, 2));
            console.log('');
            
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
        } catch (parseError) {
            console.error('❌ ERROR parsing JSON:', parseError.message);
            result = {
                found: false,
                reason: `Error parsing response: ${parseError.message}`
            };
        }
        
        // Calculate sourceHash (matching extract-happy-hours.js)
        const pagesContent = venueData.pages.map(p => p.text || p.html || '').join('\n');
        const sourceHash = crypto.createHash('md5').update(pagesContent).digest('hex');
        
        // Create gold record (matching extract-happy-hours.js format)
        const goldRecord = {
            venueId: venueId,
            venueName: venueData.venueName,
            happyHour: result,
            sourceHash: sourceHash,
            processedAt: new Date().toISOString()
        };
        
        // Write to gold layer
        const goldDir = path.join(__dirname, '../data/gold');
        if (!fs.existsSync(goldDir)) {
            fs.mkdirSync(goldDir, { recursive: true });
        }
        
        const goldFilePath = path.join(goldDir, `${venueId}.json`);
        fs.writeFileSync(goldFilePath, JSON.stringify(goldRecord, null, 2), 'utf8');
        
        console.log('=== Gold Record Written ===');
        console.log(`✅ Written to: ${goldFilePath}`);
        console.log(JSON.stringify(goldRecord, null, 2));
    } catch (error) {
        console.error('❌ ERROR:', error.message);
        if (error.stack) {
            console.error(error.stack);
        }
        process.exit(1);
    }
})();
