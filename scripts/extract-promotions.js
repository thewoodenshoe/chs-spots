const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });
const { dataPath, configPath } = require('./utils/data-dir');
const { updateConfigField, loadWatchlist } = require('./utils/config');
const db = require('./utils/db');
const { createLogger } = require('./utils/logger');
const {
  parseAreaFilter,
  computeContentHashes,
  shouldSkipVenue,
  logCandidateHistory,
} = require('./utils/extract-helpers');
const { processVenue } = require('./utils/extract-venue');

const SILVER_TRIMMED_DIR = dataPath('silver_trimmed', 'today');
const SILVER_TRIMMED_INCREMENTAL_DIR = dataPath('silver_trimmed', 'incremental');
const GOLD_DIR = dataPath('gold');
const BULK_COMPLETE_FLAG = path.join(GOLD_DIR, '.bulk-complete');
const { loadPrompt } = require('./utils/load-prompt');
const CONFIG_PATH = configPath('config.json');
const LLM_CANDIDATES_HISTORY_PATH = path.join(__dirname, '../logs/llm-candidates-history.txt');

if (!fs.existsSync(GOLD_DIR)) fs.mkdirSync(GOLD_DIR, { recursive: true });

function loadSystemPrompt() {
  const raw = loadPrompt('llm-extract-promotions');
  const marker = 'Here is the website content for';
  const idx = raw.indexOf(marker);
  return idx > 0 ? raw.substring(0, idx).trim() : raw.trim();
}

function loadMaxIncrementalFiles() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      if (config.pipeline && typeof config.pipeline.maxIncrementalFiles === 'number') {
        return config.pipeline.maxIncrementalFiles;
      }
    }
  } catch (error) {
    console.warn(`Warning: Could not read config from ${CONFIG_PATH}, using default maxIncrementalFiles=15`);
  }
  return 15;
}

function ensureBulkComplete() {
  const hasBulkFlag = fs.existsSync(BULK_COMPLETE_FLAG);
  const hasGoldFiles = fs.existsSync(GOLD_DIR) &&
    fs.readdirSync(GOLD_DIR).filter(f => f.endsWith('.json') && f !== 'bulk-results.json').length > 0;

  if (!hasBulkFlag && !hasGoldFiles) {
    console.warn('Bulk extraction not marked as complete. Running in incremental mode requires prior bulk extraction.');
    console.warn('Please run `npm run extract:bulk:prepare` and `npm run extract:bulk:process` first.');
    process.exit(1);
  }
  if (!hasBulkFlag && hasGoldFiles) {
    console.log('📝 Gold files found but .bulk-complete flag missing - creating flag for future runs...');
    fs.writeFileSync(BULK_COMPLETE_FLAG, new Date().toISOString(), 'utf8');
  }
}

async function extractHappyHours(isIncremental = false) {
  const GROK_API_KEY = process.env.GROK_API_KEY;
  if (!GROK_API_KEY) {
    console.error('Error: GROK_API_KEY is not set in environment variables.');
    process.exit(1);
  }

  let systemPrompt;
  try {
    systemPrompt = loadSystemPrompt();
  } catch (error) {
    console.error(`Error reading LLM instructions: ${error.message}`);
    process.exit(1);
  }

  const logger = (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID)
    ? { log: console.log, error: console.error, close: () => {} }
    : createLogger('extract-promotions');

  logger.log(`═══ extract-promotions.js START (${isIncremental ? 'incremental' : 'bulk'}) ═══`);
  const metrics = { processed: 0, skipped: 0, errors: 0, watchlistSkipped: 0, found: 0, notFound: 0 };
  const areaFilterSet = parseAreaFilter(process.env.AREA_FILTER);
  const reprocessMissing = process.env.AUTO_REPROCESS_MISSING_ACTIVITY_TYPE !== 'false' ||
    process.env.FORCE_REPROCESS_MISSING_ACTIVITY_TYPE === 'true';

  if (areaFilterSet) console.log(`📍 AREA_FILTER active: ${Array.from(areaFilterSet).join(', ')}`);
  if (reprocessMissing) console.log(`🔄 Missing activityType auto-reprocess enabled`);

  let sourceDir = SILVER_TRIMMED_DIR;
  if (isIncremental) {
    if (!fs.existsSync(SILVER_TRIMMED_INCREMENTAL_DIR)) {
      console.log(`⏭️  No incremental files found in ${SILVER_TRIMMED_INCREMENTAL_DIR}`);
      console.log(`   Incremental folder is empty - nothing to extract.`);
      console.log(`\n✨ Skipped extraction (incremental mode - no changes)`);
      return;
    }
    sourceDir = SILVER_TRIMMED_INCREMENTAL_DIR;
  }

  let venueFiles = [];
  try {
    venueFiles = fs.readdirSync(sourceDir).filter(file => file.endsWith('.json'));
  } catch (error) {
    console.error(`Error reading silver_trimmed directory: ${error.message}`);
    console.error(`Please run 'node scripts/trim-silver-html.js' first.`);
    process.exit(1);
  }

  if (venueFiles.length === 0) {
    if (isIncremental) {
      console.log(`⏭️  No incremental files found in ${SILVER_TRIMMED_INCREMENTAL_DIR}`);
      console.log(`   Incremental folder is empty - nothing to extract.`);
      console.log(`\n✨ Skipped extraction (incremental mode - no changes)`);
    } else {
      console.log('No venue files found in silver_trimmed/today/ directory.');
      console.log("Please run 'node scripts/trim-silver-html.js' first.");
    }
    return;
  }

  if (isIncremental) {
    console.log(`📁 Found ${venueFiles.length} venue file(s) in incremental folder.`);
    const maxFiles = loadMaxIncrementalFiles();
    if (maxFiles !== -1 && venueFiles.length > maxFiles) {
      console.error('\x1b[31m%s\x1b[0m', `ABORTING: Too many incremental files (${venueFiles.length} > ${maxFiles}). Manual review required.`);
      updateConfigField('last_run_status', 'failed_at_extract');
      process.exit(1);
    }

    const allVenues = db.venues.getAll();
    const venueMap = new Map(allVenues.filter(v => v.id).map(v => [v.id, { name: v.name || 'Unknown', area: v.area || 'Unknown' }]));
    logCandidateHistory(venueFiles, venueMap, LLM_CANDIDATES_HISTORY_PATH);
    ensureBulkComplete();
  }

  const venueAreaMap = new Map(db.venues.getAll().filter(v => v.id).map(v => [v.id, (v.area || '').toLowerCase()]));
  const watchlist = loadWatchlist();

  for (const file of venueFiles) {
    const venueId = path.basename(file, '.json');
    const goldFilePath = path.join(GOLD_DIR, `${venueId}.json`);

    if (watchlist.excluded.has(venueId)) { metrics.watchlistSkipped++; continue; }

    let venueData;
    try {
      venueData = JSON.parse(fs.readFileSync(path.join(sourceDir, file), 'utf8'));
    } catch (error) {
      console.error(`Error reading venue file ${file}: ${error.message}`);
      continue;
    }

    if (areaFilterSet) {
      const area = (venueData.venueArea || venueAreaMap.get(venueId) || '').toLowerCase();
      if (!areaFilterSet.has(area)) continue;
    }

    const hashes = computeContentHashes(venueData.pages);
    const skipCheck = shouldSkipVenue(db.gold.get(venueId), hashes, reprocessMissing, venueData.venueName, venueId);
    if (skipCheck.skip) {
      console.log(`Skipping ${venueData.venueName} (${venueId}): No ${skipCheck.reason === 'normalized hash match' ? 'meaningful ' : ''}changes detected (${skipCheck.reason}).`);
      continue;
    }

    console.log(`Processing ${venueData.venueName} (${venueId})...`);
    venueData.venueId = venueId;
    const result = await processVenue(venueData, systemPrompt, GROK_API_KEY, {
      isIncremental, updateConfigField, log: logger.log, logError: logger.error,
    });

    metrics.processed++;
    if (result.found) metrics.found++; else metrics.notFound++;
    if (result.error) metrics.errors++;

    const goldRecord = {
      venueId, venueName: venueData.venueName,
      promotions: result, happyHour: result,
      sourceHash: hashes.sourceHash, normalizedSourceHash: hashes.normalizedSourceHash,
      processedAt: new Date().toISOString(),
    };

    try {
      db.gold.upsert({
        venue_id: venueId, venue_name: venueData.venueName, promotions: result,
        source_hash: hashes.sourceHash, normalized_source_hash: hashes.normalizedSourceHash,
        processed_at: goldRecord.processedAt,
      });
    } catch (error) {
      console.error(`Error writing gold to DB for ${venueData.venueName}: ${error.message}`);
    }

    try {
      fs.writeFileSync(goldFilePath, JSON.stringify(goldRecord, null, 2), 'utf8');
      console.log(`Successfully processed ${venueData.venueName} and saved to DB + ${goldFilePath}`);
    } catch (error) {
      console.error(`Error writing gold file for ${venueData.venueName}: ${error.message}`);
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  if (isIncremental) updateConfigField('last_run_status', 'completed_successfully');

  logger.log(`═══ extract-promotions.js COMPLETE ═══`);
  logger.log(`  Processed: ${metrics.processed} | Skipped: ${metrics.skipped} | Errors: ${metrics.errors}`);
  logger.log(`  Found HH: ${metrics.found} | Not found: ${metrics.notFound} | Watchlist: ${metrics.watchlistSkipped}`);
  logger.close();
}

module.exports = extractHappyHours;

if (require.main === module) {
  const isIncrementalMode = process.argv.includes('--incremental');
  if (isIncrementalMode) {
    extractHappyHours(true);
  } else {
    console.log('No mode specified. Defaulting to full automated extraction.');
    extractHappyHours(false);
  }
}
