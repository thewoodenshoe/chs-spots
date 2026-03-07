#!/usr/bin/env node
'use strict';

/**
 * Recently Opened Step 4: Quality gate — enforce mandatory fields.
 * Recently Opened requires: placeName (or name), lat, lng, address,
 * plus at least one of description or opened_date.
 * Reads: step-3-validated.json → Outputs: step-4-quality.json
 */
const path = require('path');
try { require('dotenv').config({ path: path.resolve(__dirname, '../../..', '.env.local') }); } catch {}

const { createLogger } = require('../../utils/logger');
const { readStepOutput, writeStepOutput } = require('../shared/pipeline-io');

const { log, close: closeLog } = createLogger('ro-quality');
const PIPELINE = 'recently-opened';

function checkCandidate(c) {
  const missing = [];
  const name = c.placeName || c.name;
  if (!name) missing.push('name');
  if (!c.lat) missing.push('lat');
  if (!c.lng) missing.push('lng');
  if (!c.address) missing.push('address');
  if (!c.description && !c.openedDate) missing.push('description or opened_date');
  return missing.length > 0
    ? { pass: false, reason: `Missing: ${missing.join(', ')}` }
    : { pass: true, reason: null };
}

function main() {
  const input = readStepOutput(PIPELINE, 'step-3-validated');
  if (!input) { log('No step-3 output — aborting'); process.exit(1); }
  log(`=== Recently Opened Quality Gate: ${input.verified.length} candidates ===`);

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
