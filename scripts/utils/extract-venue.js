/**
 * Process a single venue through LLM extraction with retry and web search fallback.
 * Returns the normalized gold record result.
 */

const { fetchWithTimeout, CHAT_URL, DEFAULT_MODEL, webSearch } = require('./llm-client');
const { normalizeExtraction, resolveEntryTimes } = require('./extract-helpers');

const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 1000;
const LLM_TIMEOUT_MS = 120000;

function parseJsonResponse(text) {
  const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
  if (jsonMatch && jsonMatch[1]) return JSON.parse(jsonMatch[1]);

  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}') + 1;
  if (jsonStart !== -1 && jsonEnd > jsonStart) return JSON.parse(text.substring(jsonStart, jsonEnd));

  return JSON.parse(text);
}

/**
 * Call the LLM with retry logic, parse the response, normalize the format,
 * and resolve missing times via web search fallback.
 *
 * @returns {object} Normalized extraction result
 */
async function processVenue(venueData, systemPrompt, apiKey, { isIncremental, updateConfigField, log, logError }) {
  const contentPlaceholder = venueData.pages.map(p => {
    const content = p.text || p.html || '';
    return `URL: ${p.url}\nContent:\n${content}`;
  }).join('\n---\n');

  const userMessage = `Here is the website content for ${venueData.venueName} from various pages:\n---\n${contentPlaceholder}\n---\n\nReturn the JSON result with venueId "${venueData.venueId || ''}" and venueName "${venueData.venueName}".`;

  let result;
  let retries = MAX_RETRIES;
  let delay = INITIAL_DELAY_MS;

  while (retries > 0) {
    try {
      const response = await fetchWithTimeout(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: DEFAULT_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          stream: false,
          max_tokens: 2048,
          temperature: 0.2,
        }),
      }, LLM_TIMEOUT_MS);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 429) {
          console.error(`\n❌ Rate limit exceeded (HTTP 429): ${errorData.error?.message || response.statusText}`);
          console.error(`   Aborting extraction. Please wait and try again later.`);
          console.error(`   Processed up to: ${venueData.venueName}`);
          if (isIncremental) updateConfigField('last_run_status', 'failed_at_extract');
          process.exit(1);
        }
        throw new Error(`HTTP ${response.status}: ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json();
      const text = data.choices[0]?.message?.content || '';
      result = normalizeExtraction(parseJsonResponse(text), venueData);

      await resolveEntryTimes(result, venueData, apiKey, webSearch, log);
      break;
    } catch (error) {
      if (error && error.name === 'AbortError') {
        error = new Error('LLM request timed out after 120 seconds');
      }
      const statusCode = error.message?.match(/HTTP (\d+)/)?.[1];
      if (statusCode === '429') {
        console.error(`\n❌ Rate limit exceeded (HTTP 429): Too Many Requests`);
        console.error(`   Processed up to: ${venueData.venueName}`);
        if (isIncremental) updateConfigField('last_run_status', 'failed_at_extract');
        process.exit(1);
      }

      retries--;
      if (retries > 0) {
        console.log(`   ⚠️  Error: ${error.message}, retrying... (${retries} retries left)`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
        continue;
      }

      logError(`Grok API failed for ${venueData.venueName}: ${error.message}`);
      result = { found: false, reason: `Error processing: ${error.message}`, error: error.message };
      break;
    }
  }

  return result;
}

module.exports = { processVenue, parseJsonResponse };
