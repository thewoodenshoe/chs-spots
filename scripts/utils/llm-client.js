/**
 * Shared LLM client for all Grok API calls.
 *
 * Consolidates: fetch-with-timeout, retry logic, response parsing,
 * and API configuration that was previously duplicated across 7 files.
 */

const CHAT_URL = 'https://api.x.ai/v1/chat/completions';
const RESPONSES_URL = 'https://api.x.ai/v1/responses';
const DEFAULT_MODEL = 'grok-4-fast-reasoning';
const WEB_SEARCH_MODEL = 'grok-4-1-fast-reasoning';

function getApiKey() {
  return process.env.GROK_API_KEY || process.env.XAI_API_KEY || '';
}

function requireApiKey(label) {
  const key = getApiKey();
  if (!key) throw new Error(`[${label}] GROK_API_KEY not set`);
  return key;
}

async function fetchWithTimeout(url, options, timeoutMs = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extract a JSON array from LLM response text.
 * Handles markdown fences, raw JSON, and loose arrays.
 */
function extractJsonArray(text) {
  if (!text) return null;
  const fenceMatch = text.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1]); } catch { /* fall through */ }
  }
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try { return JSON.parse(arrayMatch[0]); } catch { return null; }
  }
  return null;
}

/**
 * Extract a JSON object from LLM response text.
 */
function extractJsonObject(text) {
  if (!text) return null;
  const fenceMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1]); } catch { /* fall through */ }
  }
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch { return null; }
  }
  return null;
}

/**
 * Send a chat completion request to Grok.
 *
 * @param {Object} opts
 * @param {Array}  opts.messages        - [{ role, content }]
 * @param {string} [opts.model]         - defaults to DEFAULT_MODEL
 * @param {number} [opts.temperature]   - defaults to 0.1
 * @param {number} [opts.timeoutMs]     - defaults to 60000
 * @param {number} [opts.retries]       - defaults to 0
 * @param {number} [opts.retryDelayMs]  - initial delay, doubles each retry
 * @param {string} [opts.apiKey]        - override; otherwise reads env
 * @param {Function} [opts.log]         - optional logger
 * @returns {{ content: string, parsed: any } | null}
 */
async function chat(opts) {
  const {
    messages,
    model = DEFAULT_MODEL,
    temperature = 0.1,
    timeoutMs = 60000,
    retries = 0,
    retryDelayMs = 2000,
    apiKey = getApiKey(),
    log = () => {},
  } = opts;

  let attempts = retries + 1;
  let delay = retryDelayMs;

  while (attempts > 0) {
    try {
      const res = await fetchWithTimeout(CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages, temperature }),
      }, timeoutMs);

      if (res.status === 429) {
        throw Object.assign(new Error('Rate limited (429)'), { rateLimited: true });
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Grok API ${res.status}: ${body.slice(0, 200)}`);
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || '';
      return { content, parsed: extractJsonArray(content) || extractJsonObject(content) };
    } catch (err) {
      attempts--;
      if (err.rateLimited || attempts === 0) {
        log(`  ❌ LLM chat failed: ${err.message}`);
        return null;
      }
      log(`  ⚠️  LLM retry (${err.message}), waiting ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
      delay *= 2;
    }
  }
  return null;
}

/**
 * Send a web-search (responses API) request to Grok.
 *
 * @param {Object} opts
 * @param {string} opts.prompt       - search/instruction prompt
 * @param {string} [opts.model]      - defaults to WEB_SEARCH_MODEL
 * @param {number} [opts.timeoutMs]  - defaults to 120000
 * @param {string} [opts.apiKey]     - override
 * @param {Function} [opts.log]      - logger
 * @returns {{ content: string, parsed: any } | null}
 */
async function webSearch(opts) {
  const {
    prompt,
    model = WEB_SEARCH_MODEL,
    timeoutMs = 120000,
    apiKey = getApiKey(),
    log = () => {},
  } = opts;

  try {
    const res = await fetchWithTimeout(RESPONSES_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        tools: [{ type: 'web_search' }],
        input: prompt,
      }),
    }, timeoutMs);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      log(`  ❌ LLM web search ${res.status}: ${body.slice(0, 200)}`);
      return null;
    }

    const data = await res.json();
    let content = '';
    if (data.output) {
      for (const block of data.output) {
        if (block.type === 'message' && Array.isArray(block.content)) {
          for (const part of block.content) {
            if (part.type === 'output_text') content += part.text;
          }
        }
      }
    }
    if (!content) content = data.choices?.[0]?.message?.content || '';

    return { content, parsed: extractJsonArray(content) || extractJsonObject(content) };
  } catch (err) {
    log(`  ❌ LLM web search failed: ${err.message}`);
    return null;
  }
}

module.exports = {
  chat,
  webSearch,
  getApiKey,
  requireApiKey,
  extractJsonArray,
  extractJsonObject,
  fetchWithTimeout,
  CHAT_URL,
  RESPONSES_URL,
  DEFAULT_MODEL,
  WEB_SEARCH_MODEL,
};
