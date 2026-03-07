'use strict';

const fs = require('fs');
const { configPath } = require('./data-dir');

const LLM_DIR = configPath('llm');

/**
 * Load an LLM prompt template from data/config/llm/{name}.txt.
 * Replaces {PLACEHOLDER} tokens with values from the replacements object.
 */
function loadPrompt(name, replacements = {}) {
  const filePath = `${LLM_DIR}/${name}.txt`;
  if (!fs.existsSync(filePath)) {
    throw new Error(`LLM prompt not found: ${filePath}`);
  }
  let text = fs.readFileSync(filePath, 'utf8').trim();
  for (const [key, value] of Object.entries(replacements)) {
    text = text.replaceAll(`{${key}}`, String(value));
  }
  return text;
}

module.exports = { loadPrompt };
