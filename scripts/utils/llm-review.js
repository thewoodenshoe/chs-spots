/**
 * LLM-powered confidence review for flagged/rejected spot entries.
 *
 * Auto-apply thresholds:
 *   >=85  -> auto-apply (approve or reject), save to DB
 *   <85   -> flag for human review in daily report
 */

const { chat, extractJsonArray } = require('./llm-client');
const { loadPrompt } = require('./load-prompt');

const BATCH_SIZE = 10;
const AUTO_APPLY_THRESHOLD = 80;

const SYSTEM_PROMPT = loadPrompt('llm-review');

function buildUserPrompt(entries) {
  const items = entries.map((e, i) => ({
    index: i, venue: e.venue,
    type: e.type || e.activityType,
    label: e.label, times: e.times || 'N/A', days: e.days || 'N/A',
    specials: e.specials || [],
    flags: e.flags || e.confidenceFlags,
    heuristicScore: e.effectiveConfidence,
    llmOriginalScore: e.llmConfidence || e.confidence,
  }));
  return `Review these ${items.length} flagged entries:\n\n${JSON.stringify(items, null, 2)}`;
}

function parseResponse(text) {
  const arr = extractJsonArray(text);
  if (!Array.isArray(arr)) return null;
  return arr.filter(r =>
    typeof r.index === 'number'
    && (r.decision === 'approve' || r.decision === 'reject')
    && typeof r.confidence === 'number',
  );
}

async function reviewBatch(entries, apiKey, log) {
  const result = await chat({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(entries) },
    ],
    timeoutMs: 60000,
    retries: 2,
    retryDelayMs: 2000,
    apiKey,
    log,
  });

  if (!result) return [];
  const decisions = parseResponse(result.content);
  if (!decisions || decisions.length === 0) {
    log(`  ❌ Failed to parse LLM review response: ${result.content.slice(0, 200)}`);
    return [];
  }
  return decisions;
}

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
      const result = { ...batch[d.index], llmDecision: d.decision, llmReviewConfidence: d.confidence, llmReasoning: d.reasoning };
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

    if (i + BATCH_SIZE < entries.length) await new Promise(r => setTimeout(r, 500));
  }

  return { autoApplied, needsHumanReview, errors };
}

module.exports = { reviewAll, reviewBatch, AUTO_APPLY_THRESHOLD, BATCH_SIZE, parseResponse };
