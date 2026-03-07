#!/usr/bin/env node
'use strict';

/**
 * Openings Step 4: Quality gate — enforce mandatory venue fields.
 * Reads: step-3-validated.json → Outputs: step-4-quality.json
 *
 * Recently Opened: must have name, lat, lng, address, description
 * Coming Soon: must have name, description (lat/lng optional since venue may not exist yet)
 */
const path = require('path');
try { require('dotenv').config({ path: path.resolve(__dirname, '../../..', '.env.local') }); } catch {}

const { createLogger } = require('../../utils/logger');
const { readStepOutput, writeStepOutput } = require('../shared/pipeline-io');

const { log, close: closeLog } = createLogger('op-quality');
const PIPELINE = 'openings';

const MANDATORY = {
  'Recently Opened': ['placeName', 'lat', 'lng', 'address'],
  'Coming Soon': ['placeName'],
};

function checkCandidate(c) {
  const cls = c.classification || 'Recently Opened';
  const required = MANDATORY[cls] || MANDATORY['Recently Opened'];
  const missing = required.filter(f => !c[f]);

  if (!c.description && !c.grokVerifiedDate && !c.expectedOpen) {
    missing.push('description or date context');
  }

  return missing.length > 0
    ? { pass: false, reason: `Missing: ${missing.join(', ')}` }
    : { pass: true, reason: null };
}

function main() {
  const input = readStepOutput(PIPELINE, 'step-3-validated');
  if (!input) { log('No step-3 output — aborting'); process.exit(1); }
  log(`=== Openings Quality Gate: ${input.verified.length} candidates ===`);

  const approved = [];
  const rejected = [];

  for (const c of input.verified) {
    const { pass, reason } = checkCandidate(c);
    if (pass) {
      approved.push(c);
      log(`[quality] PASS: "${c.placeName}" (${c.classification})`);
    } else {
      rejected.push({ ...c, reject_reason: reason });
      log(`[quality] REJECT: "${c.placeName}" — ${reason}`);
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
