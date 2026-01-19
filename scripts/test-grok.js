const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });
// node-fetch v3 is ESM, but we need to handle CommonJS require
const fetchModule = require('node-fetch');
const fetch = typeof fetchModule === 'function' ? fetchModule : fetchModule.default;

async function testGrok() {
    console.log("Starting Grok API test...");
    console.log(`Environment file path: ${path.resolve(__dirname, '../.env.local')}`);

    // Check if .env.local exists
    const fs = require('fs');
    const envPath = path.resolve(__dirname, '../.env.local');
    const envExists = fs.existsSync(envPath);
    console.log(`.env.local exists: ${envExists}`);

    // Check for similar variable names first
    const allEnvKeys = Object.keys(process.env);
    const geminiKey = process.env.GEMINI_API_KEY;
    const grokKey = process.env.GROK_API_KEY;
    
    let GROK_API_KEY = grokKey;
    
    if (!GROK_API_KEY) {
        console.error("\n❌ Error: GROK_API_KEY is not set.");
        
        if (geminiKey) {
            console.error(`\n⚠️  Found GEMINI_API_KEY in environment.`);
            console.error("Note: You need to add GROK_API_KEY to .env.local");
            console.error("\nPlease add this line to .env.local:");
            console.error("GROK_API_KEY=your_grok_api_key_here");
            console.error("\nOr if you want to use the same key value:");
            console.error(`GROK_API_KEY=${geminiKey.substring(0, 10)}...`);
        } else {
            console.error("\nPlease ensure .env.local contains:");
            console.error("GROK_API_KEY=your_grok_api_key_here");
        }
        
        const similarKeys = allEnvKeys.filter(k => 
            (k.toUpperCase().includes('GROK') || k.toUpperCase().includes('API')) && 
            k !== 'GROK_API_KEY'
        );
        if (similarKeys.length > 0) {
            console.error("\nFound similar environment variables:");
            similarKeys.forEach(key => console.error(`  - ${key}`));
        }
        return;
    }
    console.log("✅ GROK_API_KEY is set.");

    const GROK_API_URL = 'https://api.x.ai/v1/chat/completions';
    const GROK_MODEL = 'grok-4-fast-reasoning'; // Faster model with good reasoning, higher rate limits

    try {
        console.log(`\nTesting Grok API with model: ${GROK_MODEL}...`);
        
        const prompt = "Testing. Just say hi and hello world and nothing else.";
        console.log(`Sending prompt: "${prompt}"`);

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
                        role: 'system',
                        content: 'You are a test assistant.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                stream: false,
                temperature: 0
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error("---");
            console.error(`❌ ERROR: HTTP ${response.status}`);
            console.error(`Message: ${errorData.error?.message || response.statusText}`);
            if (errorData.error) {
                console.error(`Error details:`, errorData.error);
            }
            console.error("---");
            return;
        }

        const data = await response.json();
        const text = data.choices[0]?.message?.content || '';

        console.log("---");
        console.log(`✅ SUCCESS with model: ${GROK_MODEL}`);
        console.log(`Response: ${text}`);
        console.log("---");
    } catch (error) {
        console.error("---");
        console.error("ERROR: Failed to call Grok API.");
        console.error(error.message);
        if (error.stack) {
            console.error(error.stack);
        }
        console.error("---");
    }
}

testGrok();
