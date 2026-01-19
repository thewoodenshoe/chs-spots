/**
 * Wrapper script to run extract-happy-hours.js with automatic retry on rate limits
 * 
 * This script:
 * - Runs extract-happy-hours.js in a loop
 * - Detects HTTP 429 (rate limit) errors
 * - Waits before retrying (increasing wait time on each retry)
 * - Continues until all venues are processed
 * - Logs progress to logs/extract-happy-hours-retry.log
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'extract-happy-hours-retry.log');
const EXTRACT_SCRIPT = path.join(__dirname, 'extract-happy-hours.js');

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  console.log(message);
  fs.appendFileSync(LOG_FILE, logMessage);
}

function runExtraction() {
  return new Promise((resolve, reject) => {
    log('Starting extraction attempt...');
    
    const child = spawn('node', [EXTRACT_SCRIPT], {
      stdio: ['inherit', 'pipe', 'pipe'],
      cwd: path.join(__dirname, '..')
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      process.stdout.write(output);
    });

    child.stderr.on('data', (data) => {
      const output = data.toString();
      stderr += output;
      process.stderr.write(output);
    });

    child.on('close', (code) => {
      // Check if output contains rate limit error
      const output = stdout + stderr;
      const hasRateLimit = output.includes('HTTP 429') || output.includes('Rate limit exceeded');
      
      if (code === 1 && hasRateLimit) {
        log(`Extraction aborted due to rate limit (exit code ${code}). Will retry after delay.`);
        resolve({ retry: true, code });
      } else if (code === 0) {
        log(`Extraction completed successfully (exit code ${code}).`);
        resolve({ retry: false, code });
      } else {
        log(`Extraction failed with exit code ${code}.`);
        reject(new Error(`Process exited with code ${code}`));
      }
    });

    child.on('error', (error) => {
      log(`Error spawning process: ${error.message}`);
      reject(error);
    });
  });
}

async function runWithRetries() {
  const MAX_RETRIES = 100; // Maximum number of retries (safety limit)
  const INITIAL_WAIT = 3600; // Start with 60 minutes (Grok rate limits may have long windows)
  const MAX_WAIT = 7200; // Cap at 120 minutes (2 hours)
  let attempt = 0;
  let waitTime = INITIAL_WAIT;

  log('='.repeat(60));
  log('Starting extract-happy-hours with automatic retry on rate limits');
  log(`Log file: ${LOG_FILE}`);
  log('='.repeat(60));

  while (attempt < MAX_RETRIES) {
    attempt++;
    log(`\nAttempt ${attempt}/${MAX_RETRIES}`);

    try {
      const result = await runExtraction();

      if (!result.retry) {
        log('\n✅ Extraction completed successfully! All venues processed.');
        process.exit(0);
      }

      // Rate limit hit - wait before retrying
      log(`\n⏳ Rate limit hit. Waiting ${waitTime} seconds before retry...`);
      log(`   (Attempt ${attempt}/${MAX_RETRIES}, wait time: ${waitTime}s)`);
      
      await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
      
      // Exponential backoff: increase wait time, but cap at MAX_WAIT
      waitTime = Math.min(waitTime * 1.5, MAX_WAIT);
      
    } catch (error) {
      log(`\n❌ Error during extraction: ${error.message}`);
      log(`   Retrying in ${waitTime} seconds...`);
      
      await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
      waitTime = Math.min(waitTime * 1.5, MAX_WAIT);
    }
  }

  log(`\n❌ Maximum retries (${MAX_RETRIES}) reached. Stopping.`);
  process.exit(1);
}

// Run with retries
runWithRetries().catch((error) => {
  log(`\n❌ Fatal error: ${error.message}`);
  process.exit(1);
});
