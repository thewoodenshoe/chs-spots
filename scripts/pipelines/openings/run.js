#!/usr/bin/env node
'use strict';

/**
 * Openings Pipeline Orchestrator — runs all steps.
 * Steps: Discover → Validate → Upsert → Lifecycle → SEO → Report
 */
const path = require('path');
try { require('dotenv').config({ path: path.resolve(__dirname, '../../..', '.env.local') }); } catch {}

const { createLogger } = require('../../utils/logger');

const { log, error: logError, close: closeLog } = createLogger('op-pipeline');

function runStep(label, scriptPath) {
  log(`--- Step: ${label} ---`);
  return new Promise((resolve, reject) => {
    const { fork } = require('child_process');
    const child = fork(scriptPath, [], {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', d => process.stdout.write(d));
    child.stderr.on('data', d => process.stderr.write(d));
    child.on('exit', code => {
      if (code !== 0) reject(new Error(`${label} exited with code ${code}`));
      else resolve();
    });
  });
}

async function main() {
  const startMs = Date.now();
  log('=== Openings Pipeline ===');

  await runStep('Discover (RSS + LLM)', path.join(__dirname, 'discover.js'));
  await runStep('Validate (geocode + LLM verify)', path.join(__dirname, 'validate.js'));
  await runStep('Upsert Venues + Lifecycle', path.join(__dirname, 'upsert-venues.js'));
  await runStep('Lifecycle Check', path.join(__dirname, 'lifecycle.js'));
  await runStep('Report', path.join(__dirname, 'report.js'));

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  log(`=== Openings Pipeline Complete: ${elapsed}s ===`);
  closeLog();
}

main().catch(e => { logError('Fatal:', e); closeLog(); process.exit(1); });
