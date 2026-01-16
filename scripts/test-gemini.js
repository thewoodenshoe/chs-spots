const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function testGemini() {
    console.log("Starting Gemini API test...");

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
        console.error("Error: GEMINI_API_KEY is not set.");
        return;
    }
    console.log("GEMINI_API_KEY is set.");

    // Try different model names to find which one works
    const modelsToTry = [
        "gemini-pro",
        "gemini-1.5-flash",
        "gemini-1.5-pro",
        "gemini-2.5-flash",
        "gemini-2.5-pro",
        "gemini-1.0-pro"
    ];

    let success = false;
    let lastError = null;
    
    for (const modelName of modelsToTry) {
        try {
            console.log(`\nTrying model: ${modelName}...`);
            const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: modelName });

            const prompt = "What is the capital of South Carolina?";
            console.log(`Sending prompt: "${prompt}"`);

            const result = await model.generateContent(prompt);
            const response = await result.response;
            const text = response.text();

            console.log("---");
            console.log(`✅ SUCCESS with model: ${modelName}`);
            console.log(`Response: ${text}`);
            console.log("---");
            success = true;
            break; // Exit loop on success
        } catch (error) {
            lastError = error;
            if (error.status === 404) {
                console.log(`   ❌ ${modelName}: Not found (404)`);
            } else {
                console.log(`   ❌ ${modelName}: ${error.message}`);
            }
        }
    }

    if (!success) {
        console.error("---");
        console.error("ERROR: All model names failed. This is likely due to your Google Cloud project configuration.");
        if (lastError) {
            console.error(lastError);
        }
        console.error("---");
    }
}

testGemini();
