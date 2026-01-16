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

    try {
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.0-pro" });

        const prompt = "What is the capital of South Carolina?";
        console.log(`Sending prompt: "${prompt}"`);

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        console.log("---");
        console.log("SUCCESS: Successfully received a response from the Gemini API.");
        console.log(text);
        console.log("---");

    } catch (error) {
        console.error("---");
        console.error("ERROR: An error occurred during the Gemini API test.");
        console.error("This is likely due to your Google Cloud project configuration.");
        console.error(error);
        console.error("---");
    }
}

testGemini();