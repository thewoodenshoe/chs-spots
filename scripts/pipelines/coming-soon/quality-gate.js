#!/usr/bin/env node
'use strict';

/**
 * Coming Soon Step 4: Quality gate — enforce mandatory fields.
 * Coming Soon requires: placeName (or name), plus at least one of description/expectedOpen.
 * Lat/lng NOT required (venue may not exist yet).
 * Reads: step-3-validated.json → Outputs: step-4-quality.json
 */
const path = require('path');
try { require('dotenv').config({ path: path.resolve(__dirname, '../../..', '.env.local') }); } catch {}

const { createLogger } = require('../../utils/logger');
const { readStepOutput, writeStepOutput } = require('../shared/pipeline-io');

const { log, close: closeLog } = createLogger('cs-quality');
const PIPELINE = 'coming-soon';

function checkCandidate(c) {
  const missing = [];
  const name = c.placeName || c.name;
  if (!name) missing.push('name');
  if (!c.description && !c.expectedOpen) missing.push('description or expectedOpen');
  return missing.length > 0
    ? { pass: false, reason: `Missing: ${missing.join(', ')}` }
    : { pass: true, reason: null };
}

function main() {
  const input = readStepOutput(PIPELINE, 'step-3-validated');
  if (!input) { log('No step-3 output — aborting'); process.exit(1); }
  log(`=== Coming Soon Quality Gate: ${input.verified.length} candidates ===`);

  const approved = [];
  const rejected = [];

  for (const c of input.verified) {
    const { pass, reason } = checkCandidate(c);
    if (pass) {
      approved.push(c);
      log(`[quality] PASS: "${c.placeName || c.name}"`);
    } else {
      rejected.push({ ...c, reject_reason: reason });
      log(`[quality] REJECT: "${c.placeName || c.name}" — ${reason}`);
    }
  }

  log(`[quality] ${approved.length} approved, ${rejected.length} rejected`);

  writeStepOutput(PIPELINE, 'step-4-quality', {
    ...input, approved, rejected,
    qualityApproved: approved.length,
    qualityRejected: rejected.length,
  });

  closeLog();
}

main();
