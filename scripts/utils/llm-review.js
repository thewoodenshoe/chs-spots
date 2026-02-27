/**
 * LLM-powered confidence review for flagged/rejected spot entries.
 *
 * Sends batches of flagged entries to Grok for validation.
 * Returns structured decisions with confidence scores.
 *
 * Auto-apply thresholds:
 *   ≥85  → auto-apply (approve or reject), save to DB
 *   <85  → flag for human review in daily report
 */

const GROK_API_URL = 'https://api.x.ai/v1/chat/completions';
const GROK_MODEL = 'grok-4-fast-reasoning';
const BATCH_SIZE = 10;
const AUTO_APPLY_THRESHOLD = 85;
const REQUEST_TIMEOUT_MS = 60000;

const SYSTEM_PROMPT = `You are a data quality reviewer for a Charleston, SC restaurant deals app.

You will receive flagged entries that were extracted from restaurant websites and classified as "Happy Hour" or "Brunch" promotions. Each entry was flagged by heuristic rules because something looked suspicious.

For each entry, decide whether it is a LEGITIMATE promotion or a MISCLASSIFICATION.

Rules for Happy Hour:
- Must involve discounted drinks or food specials during a specific time window
- Regular operating hours are NOT happy hour
- Food-only specials (wing night, taco tuesday) count IF they are time-limited promotions
- All-day specials with no drink component are borderline — use judgment
- Market/cafe/bakery hours are never happy hour

Rules for Brunch:
- Must be a dedicated brunch service, not just regular breakfast/lunch hours
- Weekend brunch is most common but weekday brunch exists

Return ONLY a JSON array. Each element must have:
{
  "index": <0-based position in the input array>,
  "decision": "approve" | "reject",
  "confidence": <0-100>,
  "reasoning": "<one sentence>"
}`;

async function fetchWithTimeout(url, options, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function buildUserPrompt(entries) {
  const items = entries.map((e, i) => ({
    index: i,
    venue: e.venue,
    type: e.type || e.activityType,
    label: e.label,
    times: e.times || 'N/A',
    days: e.days || 'N/A',
    flags: e.flags || e.confidenceFlags,
    heuristicScore: e.effectiveConfidence,
    llmOriginalScore: e.llmConfidence || e.confidence,
  }));
  return `Review these ${items.length} flagged entries:\n\n${JSON.stringify(items, null, 2)}`;
}

function parseResponse(text) {
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return null;
  try {
    const arr = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(arr)) return null;
    return arr.filter(r =>
      typeof r.index === 'number'
      && (r.decision === 'approve' || r.decision === 'reject')
      && typeof r.confidence === 'number',
    );
  } catch {
    return null;
  }
}

/**
 * Send a batch of flagged entries to Grok for review.
 * @param {Array} entries — flagged items with venue, type, label, times, days, flags
 * @param {string} apiKey — GROK_API_KEY
 * @param {Function} log — logging function
 * @returns {Array} — decisions: { index, decision, confidence, reasoning }
 */
async function reviewBatch(entries, apiKey, log) {
  const userPrompt = buildUserPrompt(entries);

  let retries = 2;
  let delay = 2000;

  while (retries >= 0) {
    try {
      const response = await fetchWithTimeout(GROK_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: GROK_MODEL,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.1,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Grok API ${response.status}: ${body.slice(0, 200)}`);
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content;
      if (!text) throw new Error('Empty response from Grok API');

      const decisions = parseResponse(text);
      if (!decisions || decisions.length === 0) {
        throw new Error(`Failed to parse LLM response: ${text.slice(0, 200)}`);
      }

      return decisions;
    } catch (err) {
      if (retries === 0) {
        log(`  ❌ LLM review failed after retries: ${err.message}`);
        return [];
      }
      log(`  ⚠️  LLM review retry (${err.message}), waiting ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
      delay *= 2;
      retries--;
    }
  }
  return [];
}

/**
 * Review all flagged+rejected entries via LLM in batches.
 * Returns { autoApplied, needsHumanReview, errors }.
 */
async function reviewAll(entries, apiKey, log) {
  const autoApplied = [];
  const needsHumanReview = [];
  let errors = 0;

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(entries.length / BATCH_SIZE);
    log(`  📡 LLM review batch ${batchNum}/${totalBatches} (${batch.length} entries)...`);

    const decisions = await reviewBatch(batch, apiKey, log);

    for (const d of decisions) {
      if (d.index < 0 || d.index >= batch.length) continue;
      const entry = batch[d.index];
      const result = { ...entry, llmDecision: d.decision, llmReviewConfidence: d.confidence, llmReasoning: d.reasoning };

      if (d.confidence >= AUTO_APPLY_THRESHOLD) {
        autoApplied.push(result);
      } else {
        needsHumanReview.push(result);
      }
    }

    const answeredIndices = new Set(decisions.map(d => d.index));
    for (let j = 0; j < batch.length; j++) {
      if (!answeredIndices.has(j)) {
        needsHumanReview.push({ ...batch[j], llmDecision: null, llmReviewConfidence: 0, llmReasoning: 'LLM did not return a decision for this entry' });
        errors++;
      }
    }

    if (i + BATCH_SIZE < entries.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  return { autoApplied, needsHumanReview, errors };
}

module.exports = { reviewAll, reviewBatch, AUTO_APPLY_THRESHOLD, BATCH_SIZE, parseResponse };
