#!/usr/bin/env node

/**
 * Run Incremental Pipeline - Master Script with State Management and Recovery
 * 
 * Runs the full happy hour pipeline in incremental mode with:
 * - Explicit state management via config.json
 * - Recovery from failed runs
 * - New day/same day detection
 * - Status tracking at each step
 * 
 * Usage: node scripts/run-incremental-pipeline.js [run_date] [area-filter]
 *   run_date: Optional YYYYMMDD format (defaults to today)
 *   area-filter: Optional area name to filter venues
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { loadConfig, saveConfig, updateConfigField, getRunDate } = require('./utils/config');
const { dataPath } = require('./utils/data-dir');
const db = require('./utils/db');
const { acquire: acquireLock, release: releaseLock } = require('./utils/pipeline-lock');

// Parse optional run_date parameter (YYYYMMDD format) - defaults to today if not provided
// Flags like --confirm, --force etc. are NOT area filters
const cliArgs = process.argv.slice(2).filter(a => !a.startsWith('--'));
const RUN_DATE_PARAM = cliArgs[0] && /^\d{8}$/.test(cliArgs[0]) ? cliArgs[0] : null;
const AREA_FILTER = cliArgs[0] && !/^\d{8}$/.test(cliArgs[0]) ? cliArgs[0] : (cliArgs[1] || null);

// Logging setup
let logFileStream = null;
let currentRunContext = null;
const originalConsole = {
  log: console.log,
  error: console.error,
  info: console.info,
  warn: console.warn
};

/**
 * Setup unified logging to file and terminal
 */
function setupLogging() {
  // Create logs directory if missing
  const logsDir = path.join(__dirname, '..', 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  
  // Generate timestamped filename
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const logFilename = `pipeline-run-${year}${month}${day}-${hours}${minutes}${seconds}.log`;
  const logPath = path.join(logsDir, logFilename);
  
  // Create write stream in append mode
  logFileStream = fs.createWriteStream(logPath, { flags: 'a' });
  
  // Override console methods to write to both file and terminal
  console.log = function(...args) {
    const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)).join(' ');
    originalConsole.log(...args);
    if (logFileStream) {
      logFileStream.write(`[LOG] ${message}\n`);
    }
  };
  
  console.error = function(...args) {
    const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)).join(' ');
    originalConsole.error(...args);
    if (logFileStream) {
      logFileStream.write(`[ERROR] ${message}\n`);
    }
  };
  
  console.info = function(...args) {
    const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)).join(' ');
    originalConsole.info(...args);
    if (logFileStream) {
      logFileStream.write(`[INFO] ${message}\n`);
    }
  };
  
  console.warn = function(...args) {
    const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)).join(' ');
    originalConsole.warn(...args);
    if (logFileStream) {
      logFileStream.write(`[WARN] ${message}\n`);
    }
  };
  
  console.log(`📝 Logging to: ${logPath}`);
  return logPath;
}

/**
 * Restore original console methods
 */
function restoreConsole() {
  console.log = originalConsole.log;
  console.error = originalConsole.error;
  console.info = originalConsole.info;
  console.warn = originalConsole.warn;
  if (logFileStream) {
    logFileStream.end();
    logFileStream = null;
  }
}

/**
 * Get current time in EST timezone formatted as HH:MM:SS
 */
function getESTTime() {
  const now = new Date();
  const estTime = now.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const parts = estTime.split(':');
  return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}:${parts[2].padStart(2, '0')}`;
}

/**
 * Check if directory is empty
 */
function isDirectoryEmpty(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return true;
  }
  const items = fs.readdirSync(dirPath);
  return items.length === 0;
}

/**
 * Run a script and handle errors
 */
function runScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const fullPath = path.join(__dirname, scriptPath);
    const nodeArgs = [fullPath, ...args].filter(Boolean);
    const startTime = getESTTime();
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Starting ${scriptPath} at ${startTime} EST`);
    console.log(`Running: node ${scriptPath}${args.length > 0 ? ' ' + args.join(' ') : ''}`);
    console.log('='.repeat(60));
    
    const child = spawn('node', nodeArgs, {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        ...(currentRunContext ? {
          PIPELINE_RUN_DATE: currentRunContext.runDate,
          PIPELINE_RUN_ID: currentRunContext.runId,
          PIPELINE_MANIFEST_PATH: currentRunContext.manifestPath,
          PIPELINE_DB_RUN_ID: String(currentRunContext.dbRunId || ''),
          AREA_FILTER: currentRunContext.areaFilter || ''
        } : {})
      }
    });
    
    child.on('close', (code) => {
      const endTime = getESTTime();
      if (code === 0) {
        console.log(`\n✅ Finished ${scriptPath} at ${endTime} EST`);
        resolve(code);
      } else {
        console.log(`\n❌ Failed ${scriptPath} at ${endTime} EST (exit code: ${code})`);
        reject(new Error(`Script exited with code ${code}`));
      }
    });
    
    child.on('error', (error) => {
      const endTime = getESTTime();
      console.log(`\n❌ Error in ${scriptPath} at ${endTime} EST: ${error.message}`);
      reject(error);
    });
  });
}

function createRunManifest(runDate, areaFilter, logPath) {
  const manifestsDir = path.join(__dirname, '..', 'logs', 'pipeline-manifests');
  if (!fs.existsSync(manifestsDir)) {
    fs.mkdirSync(manifestsDir, { recursive: true });
  }

  const now = new Date();
  const runId = `${runDate}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  const manifestPath = path.join(manifestsDir, `run-${runId}.json`);
  const steps = {
    raw: { status: 'pending', startedAt: null, finishedAt: null },
    merged: { status: 'pending', startedAt: null, finishedAt: null },
    trimmed: { status: 'pending', startedAt: null, finishedAt: null },
    delta: { status: 'pending', startedAt: null, finishedAt: null },
    extract: { status: 'pending', startedAt: null, finishedAt: null },
    spots: { status: 'pending', startedAt: null, finishedAt: null }
  };
  const manifest = {
    runId,
    runDate,
    areaFilter: areaFilter || null,
    startedAt: now.toISOString(),
    finishedAt: null,
    status: 'running',
    logPath,
    steps
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  let dbRunId = null;
  try {
    dbRunId = db.pipelineRuns.create({
      startedAt: now.toISOString(),
      status: 'running',
      areaFilter: areaFilter || null,
      runDate,
      steps,
    });
  } catch (err) {
    console.warn(`⚠️  Could not create pipeline run in DB: ${err.message}`);
  }

  return { runId, manifestPath, dbRunId };
}

function updateManifestStep(manifestPath, stepName, status) {
  if (!manifestPath || !fs.existsSync(manifestPath)) return;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const now = new Date().toISOString();
    if (!manifest.steps[stepName]) {
      manifest.steps[stepName] = { status: 'pending', startedAt: null, finishedAt: null };
    }
    manifest.steps[stepName].status = status;
    if (status === 'running') {
      manifest.steps[stepName].startedAt = now;
      manifest.steps[stepName].finishedAt = null;
    } else if (status === 'completed' || status === 'skipped' || status === 'failed') {
      if (!manifest.steps[stepName].startedAt) {
        manifest.steps[stepName].startedAt = now;
      }
      manifest.steps[stepName].finishedAt = now;
    }
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

    if (currentRunContext?.dbRunId) {
      try {
        db.pipelineRuns.update(currentRunContext.dbRunId, { steps: manifest.steps });
      } catch (err) {
        console.warn(`⚠️  Could not update pipeline run step in DB: ${err.message}`);
      }
    }
  } catch (error) {
    console.warn(`⚠️  Could not update manifest step ${stepName}: ${error.message}`);
  }
}

function finalizeManifest(manifestPath, status) {
  if (!manifestPath || !fs.existsSync(manifestPath)) return;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.status = status;
    manifest.finishedAt = new Date().toISOString();
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

    if (currentRunContext?.dbRunId) {
      try {
        db.pipelineRuns.update(currentRunContext.dbRunId, {
          finishedAt: manifest.finishedAt,
          status,
          steps: manifest.steps,
        });
      } catch (err) {
        console.warn(`⚠️  Could not finalize pipeline run in DB: ${err.message}`);
      }
    }
  } catch (error) {
    console.warn(`⚠️  Could not finalize manifest: ${error.message}`);
  }
}

/**
 * Determine recovery point from last_run_status
 */
function getRecoveryPoint(lastRunStatus) {
  const recoveryMap = {
    'failed_at_raw': 'raw',
    'failed_at_merged': 'merged',
    'failed_at_trimmed': 'trimmed',
    'failed_at_extract': 'extract',
    'failed_at_spots': 'spots'
  };
  return recoveryMap[lastRunStatus] || null;
}

/**
 * Main pipeline function
 */
async function main() {
  const pipelineStartTime = Date.now();
  const pipelineStartTimeEST = getESTTime();
  const logPath = setupLogging();
  
  try {
    const lock = acquireLock('run-incremental-pipeline');
    if (!lock.acquired) {
      console.log(`🔒 Pipeline locked by ${lock.holder} (PID ${lock.pid}, running ${Math.round(lock.ageMs / 1000)}s). Exiting.`);
      process.exit(0);
    }

    console.log('\n🚀 Starting Incremental Pipeline with State Management');
    console.log(`   Starting entire script at ${pipelineStartTimeEST} EST`);
    console.log(`   Log file: ${logPath}`);
    
    // Initialize config
    const config = loadConfig();
    
    // Get effective run_date: use parameter if provided, otherwise default to today
    // This overrides config.run_date when parameter is provided
    const runDate = getRunDate(RUN_DATE_PARAM);
    const runDateSource = RUN_DATE_PARAM ? 'parameter (overrides config)' : 'default (today)';
    
    // Log full config at start
    console.log('\n📋 Pipeline Configuration:');
    console.log(JSON.stringify(config, null, 2));
    console.log(`\n📅 Effective run_date: ${runDate} (${runDateSource})`);
    if (RUN_DATE_PARAM && config.run_date && RUN_DATE_PARAM !== config.run_date) {
      console.log(`   Note: Parameter ${RUN_DATE_PARAM} overrides config.run_date ${config.run_date}`);
    }
    console.log(`   Last raw processed date: ${config.last_raw_processed_date || 'null'}`);
    console.log(`   Last merged processed date: ${config.last_merged_processed_date || 'null'}`);
    console.log(`   Last trimmed processed date: ${config.last_trimmed_processed_date || 'null'}`);
    console.log(`   Last run status: ${config.last_run_status || 'idle'}`);
    
    // Update run_date in config with effective run_date
    updateConfigField('run_date', runDate);

    // Create run manifest and context for child scripts
    const manifestInfo = createRunManifest(runDate, AREA_FILTER, logPath);
    currentRunContext = {
      runId: manifestInfo.runId,
      runDate,
      areaFilter: AREA_FILTER || null,
      manifestPath: manifestInfo.manifestPath,
      dbRunId: manifestInfo.dbRunId
    };
    console.log(`🧾 Run manifest: ${manifestInfo.manifestPath}`);
    
    // Check for recovery
    const lastRunStatus = config.last_run_status;
    const recoveryPoint = getRecoveryPoint(lastRunStatus);
    
    if (recoveryPoint && lastRunStatus !== 'completed_successfully' && lastRunStatus !== 'idle') {
      console.log(`\n⚠️  Previous run failed at ${lastRunStatus}. Resuming from failed_at_${recoveryPoint}`);
      console.log(`   Recovery point: ${recoveryPoint}`);
      console.log(`   Pipeline will skip steps before ${recoveryPoint} and resume from there.`);
    }
    
    // Set initial status
    updateConfigField('last_run_status', 'running_raw');
    
    // ── 7-day rolling archive ───────────────────────────────────────
    // Before any today→previous overwrite, snapshot the current "previous"
    // (i.e. yesterday's data) to a dated archive directory so we keep a
    // rolling window of historical data for analysis.
    const ARCHIVE_RETENTION_DAYS = 14;
    
    function archiveDirectory(sourceDir, archiveBase, dateLabel) {
      if (!fs.existsSync(sourceDir)) return;
      // Exclude archive/, hidden files, and non-data subdirectories
      const EXCLUDE = new Set(['archive', 'archive-incremental', 'incremental-history', '.bulk-complete']);
      const files = fs.readdirSync(sourceDir).filter(f => !f.startsWith('.') && !EXCLUDE.has(f));
      if (files.length === 0) return;
      
      const archiveDir = path.join(archiveBase, dateLabel);
      if (fs.existsSync(archiveDir)) {
        console.log(`   📦 Archive ${archiveDir} already exists — skipping`);
        return;
      }
      fs.mkdirSync(archiveDir, { recursive: true });
      
      let count = 0;
      for (const item of files) {
        const src = path.join(sourceDir, item);
        const dst = path.join(archiveDir, item);
        const stat = fs.statSync(src);
        if (stat.isDirectory()) {
          // For raw/ which has venue subdirectories (one level deep)
          fs.mkdirSync(dst, { recursive: true });
          const subFiles = fs.readdirSync(src);
          for (const sf of subFiles) {
            const sfSrc = path.join(src, sf);
            if (fs.statSync(sfSrc).isFile()) {
              fs.copyFileSync(sfSrc, path.join(dst, sf));
            }
          }
          count++;
        } else if (stat.isFile()) {
          fs.copyFileSync(src, dst);
          count++;
        }
      }
      console.log(`   📦 Archived ${count} item(s) to ${archiveDir}`);
    }
    
    function cleanOldArchives(archiveBase) {
      if (!fs.existsSync(archiveBase)) return;
      const cutoff = Date.now() - (ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
      const dirs = fs.readdirSync(archiveBase).filter(d => /^\d{8}$/.test(d));
      for (const d of dirs) {
        // Parse YYYYMMDD to a date
        const y = parseInt(d.substring(0, 4));
        const m = parseInt(d.substring(4, 6)) - 1;
        const dd = parseInt(d.substring(6, 8));
        const dirDate = new Date(y, m, dd).getTime();
        if (dirDate < cutoff) {
          const dirPath = path.join(archiveBase, d);
          fs.rmSync(dirPath, { recursive: true, force: true });
          console.log(`   🗑️  Cleaned old archive: ${d}`);
        }
      }
    }
    
    // Archive paths - Respect DATA_DIR
    const RAW_ARCHIVE_BASE = dataPath('raw', 'archive');
    const SILVER_TRIMMED_ARCHIVE_BASE = dataPath('silver_trimmed', 'archive');
    const SILVER_TRIMMED_INCR_ARCHIVE_BASE = dataPath('silver_trimmed', 'archive-incremental');
    const GOLD_ARCHIVE_BASE = dataPath('gold', 'archive');
    
    const RAW_TODAY_DIR = dataPath('raw', 'today');
    const RAW_PREVIOUS_DIR = dataPath('raw', 'previous');
    const rawTodayEmpty = isDirectoryEmpty(RAW_TODAY_DIR);
    const lastRawDate = config.last_raw_processed_date;
    
    if (recoveryPoint && ['merged', 'trimmed', 'extract'].includes(recoveryPoint)) {
      // Skip raw steps - recovering from later stage
      console.log('\n⏭️  Skipping raw steps (recovering from later stage)');
      updateManifestStep(currentRunContext.manifestPath, 'raw', 'skipped');
    } else {
      console.log('\n📥 Step 1: Download Raw HTML');
      updateManifestStep(currentRunContext.manifestPath, 'raw', 'running');
      
      if (rawTodayEmpty) {
        // Empty today/ - download all content
        console.log('   📁 raw/today/ is empty - downloading all content');
        updateConfigField('last_run_status', 'running_raw');
        await runScript('download-raw-html.js', AREA_FILTER ? [AREA_FILTER] : []);
        updateConfigField('last_raw_processed_date', runDate);
        updateConfigField('last_run_status', 'running_merged'); // Update to next step after raw completes
        updateManifestStep(currentRunContext.manifestPath, 'raw', 'completed');
      } else if (lastRawDate === runDate && AREA_FILTER) {
        // Same day BUT area filter specified — run download to pick up venues
        // from this area that aren't yet in raw/today/ (e.g., ran DI earlier, now running WA)
        console.log(`   📍 Same day but area filter "${AREA_FILTER}" specified — downloading missing venues`);
        updateConfigField('last_run_status', 'running_raw');
        await runScript('download-raw-html.js', [AREA_FILTER]);
        updateConfigField('last_raw_processed_date', runDate);
        updateConfigField('last_run_status', 'running_merged');
        updateManifestStep(currentRunContext.manifestPath, 'raw', 'completed');
      } else if (lastRawDate === runDate) {
        // Same day, no area filter - skip downloading
        console.log(`   ⏭️  raw/today/ not empty and last_raw_processed_date (${lastRawDate}) equals run_date (${runDate}) - skipping download`);
        updateConfigField('last_run_status', 'running_raw');
        updateManifestStep(currentRunContext.manifestPath, 'raw', 'skipped');
      } else {
        // New day - archive and download
        console.log(`   📅 New day detected (${runDate} vs ${lastRawDate})`);
        
        // Archive previous/ before overwriting (7-day rolling archive)
        const archiveLabel = lastRawDate || 'unknown';
        console.log(`   📦 Archiving raw/previous/ as ${archiveLabel}`);
        archiveDirectory(RAW_PREVIOUS_DIR, RAW_ARCHIVE_BASE, archiveLabel);
        cleanOldArchives(RAW_ARCHIVE_BASE);
        
        console.log('   🗂️  New day reset: emptying previous/, copying today/ to previous/, emptying today/');
        
        // Empty previous/ directory
        if (fs.existsSync(RAW_PREVIOUS_DIR)) {
          fs.rmSync(RAW_PREVIOUS_DIR, { recursive: true, force: true });
        }
        fs.mkdirSync(RAW_PREVIOUS_DIR, { recursive: true });
        console.log('   🗑️  Emptied raw/previous/');
        
        // Note: raw/incremental/ is no longer used - comparison happens at trimmed layer
        
        // Copy all files from today/ to previous/ using fs.copyFileSync loop (exact filenames preserved)
        let copiedCount = 0;
        const copiedFilenames = [];
        if (fs.existsSync(RAW_TODAY_DIR)) {
          const todayDirs = fs.readdirSync(RAW_TODAY_DIR).filter(item => {
            const itemPath = path.join(RAW_TODAY_DIR, item);
            return fs.statSync(itemPath).isDirectory();
          });
          
          for (const dir of todayDirs) {
            const sourceDir = path.join(RAW_TODAY_DIR, dir);
            const destDir = path.join(RAW_PREVIOUS_DIR, dir);
            
            // Create destination directory
            if (!fs.existsSync(destDir)) {
              fs.mkdirSync(destDir, { recursive: true });
            }
            
            // Copy all files in the directory using fs.copyFileSync
            const files = fs.readdirSync(sourceDir);
            let dirFileCount = 0;
            for (const file of files) {
              try {
                const sourcePath = path.join(sourceDir, file);
                const destPath = path.join(destDir, file);
                
                // Only copy files (not subdirectories)
                if (fs.statSync(sourcePath).isFile()) {
                  fs.copyFileSync(sourcePath, destPath);
                  dirFileCount++;
                  if (copiedFilenames.length < 5) {
                    copiedFilenames.push(`${dir}/${file}`);
                  }
                }
              } catch (error) {
                console.warn(`   ⚠️  Failed to copy ${dir}/${file}: ${error.message}`);
              }
            }
            
            if (dirFileCount > 0) {
              copiedCount++;
            }
          }
        }
        console.log(`   ✅ Copied ${copiedCount} venue(s) from raw/today/ to raw/previous/ (using copyFileSync, exact filenames preserved)`);
        if (copiedFilenames.length > 0) {
          console.log(`   📋 First 5 files copied: ${copiedFilenames.join(', ')}`);
        }
        
        // Empty today/
        if (fs.existsSync(RAW_TODAY_DIR)) {
          const todayDirs = fs.readdirSync(RAW_TODAY_DIR);
          for (const dir of todayDirs) {
            const dirPath = path.join(RAW_TODAY_DIR, dir);
            if (fs.statSync(dirPath).isDirectory()) {
              fs.rmSync(dirPath, { recursive: true, force: true });
            }
          }
        }
        console.log('   🗑️  Emptied raw/today/');
        
        // Download all content
        console.log('   📥 Downloading all content into raw/today/');
        updateConfigField('last_run_status', 'running_raw');
        await runScript('download-raw-html.js', AREA_FILTER ? [AREA_FILTER] : []);
        updateConfigField('last_raw_processed_date', runDate);
        updateConfigField('last_run_status', 'running_merged'); // Update to next step after raw completes
        updateManifestStep(currentRunContext.manifestPath, 'raw', 'completed');
      }
      
      // Note: Delta comparison removed - comparison now happens at silver_trimmed layer only
      // Raw HTML has too much dynamic content (timestamps, session IDs, ads) for accurate comparison
      updateConfigField('last_run_status', 'running_merged');
    }
    
    // SILVER_MERGED STEPS
    if (recoveryPoint && ['trimmed', 'extract'].includes(recoveryPoint)) {
      console.log('\n⏭️  Skipping silver_merged steps (recovering from later stage)');
      updateManifestStep(currentRunContext.manifestPath, 'merged', 'skipped');
    } else {
      console.log('\n🔗 Step 2: Merge Raw Files');
      updateManifestStep(currentRunContext.manifestPath, 'merged', 'running');
      updateConfigField('last_run_status', 'running_merged');
      await runScript('merge-raw-files.js', AREA_FILTER ? [AREA_FILTER] : []);
      // After merge completes successfully, update status to next step
      updateConfigField('last_run_status', 'running_trimmed');
      updateManifestStep(currentRunContext.manifestPath, 'merged', 'completed');
    }
    
    // SILVER_TRIMMED STEPS
    if (recoveryPoint && recoveryPoint === 'extract') {
      console.log('\n⏭️  Skipping silver_trimmed steps (recovering from extract)');
      updateManifestStep(currentRunContext.manifestPath, 'trimmed', 'skipped');
      updateManifestStep(currentRunContext.manifestPath, 'delta', 'skipped');
    } else {
      console.log('\n✂️  Step 3: Trim Silver HTML');
      updateManifestStep(currentRunContext.manifestPath, 'trimmed', 'running');
      updateConfigField('last_run_status', 'running_trimmed');
      await runScript('trim-silver-html.js', AREA_FILTER ? [AREA_FILTER] : []);
      // After trim completes successfully, update status to next step
      updateConfigField('last_run_status', 'running_extract');
      updateManifestStep(currentRunContext.manifestPath, 'trimmed', 'completed');
      
      console.log('\n🔍 Step 3.5: Delta Comparison (Trimmed Content)');
      updateManifestStep(currentRunContext.manifestPath, 'delta', 'running');
      try {
        await runScript('delta-trimmed-files.js');
        // Delta doesn't change status - still running_extract
        updateManifestStep(currentRunContext.manifestPath, 'delta', 'completed');
      } catch (error) {
        if (error.message.includes('code 0')) {
          console.log('   ⏭️  Delta step completed');
          updateManifestStep(currentRunContext.manifestPath, 'delta', 'completed');
        } else {
          updateConfigField('last_run_status', 'failed_at_trimmed');
          updateManifestStep(currentRunContext.manifestPath, 'delta', 'failed');
          throw error;
        }
      }
    }
    
    // Archive incremental files for analysis (before LLM possibly modifies state)
    const SILVER_TRIMMED_INCREMENTAL_DIR = dataPath('silver_trimmed', 'incremental');
    try {
      if (fs.existsSync(SILVER_TRIMMED_INCREMENTAL_DIR)) {
        const incrFiles = fs.readdirSync(SILVER_TRIMMED_INCREMENTAL_DIR).filter(f => f.endsWith('.json'));
        if (incrFiles.length > 0) {
          console.log(`\n📦 Archiving ${incrFiles.length} incremental file(s) for analysis`);
          archiveDirectory(SILVER_TRIMMED_INCREMENTAL_DIR, SILVER_TRIMMED_INCR_ARCHIVE_BASE, runDate);
          cleanOldArchives(SILVER_TRIMMED_INCR_ARCHIVE_BASE);
        }
      }
    } catch (archiveErr) {
      console.warn(`   ⚠️  Incremental archive failed (non-fatal): ${archiveErr.message}`);
    }
    
    // Check incremental file count before running LLM or spots
    let incrementalFileCount = 0;
    if (fs.existsSync(SILVER_TRIMMED_INCREMENTAL_DIR)) {
      incrementalFileCount = fs.readdirSync(SILVER_TRIMMED_INCREMENTAL_DIR).filter(f => f.endsWith('.json')).length;
    }
    
    const hasIncrementalChanges = incrementalFileCount > 0;
    
    if (!hasIncrementalChanges) {
      // No changes at all — skip both LLM and spots
      console.log('\n🧠 Step 4: Extract Happy Hours with LLM');
      console.log('   ⏭️  No incremental changes detected — skipping LLM extraction entirely');
      updateManifestStep(currentRunContext.manifestPath, 'extract', 'skipped');
      console.log('\n📍 Step 5: Create Spots from Gold Data');
      console.log('   ⏭️  No incremental changes detected — skipping spot creation');
      console.log('   Spots from previous run are still valid (no new/updated happy hours)');
      updateManifestStep(currentRunContext.manifestPath, 'spots', 'skipped');
      updateConfigField('last_run_status', 'completed_successfully');
    } else {
      // LLM EXTRACTION
      console.log('\n🧠 Step 4: Extract Happy Hours with LLM');
      console.log(`   Found ${incrementalFileCount} incremental file(s) to process`);
      updateManifestStep(currentRunContext.manifestPath, 'extract', 'running');
      updateConfigField('last_run_status', 'running_extract');
      
      // Get maxIncrementalFiles from config (default: 15)
      const currentConfig = loadConfig();
      const maxIncrementalFiles = currentConfig.pipeline?.maxIncrementalFiles || 15;
      
      if (incrementalFileCount > maxIncrementalFiles) {
        const msg = `⚠️  Too many incremental files (${incrementalFileCount} > ${maxIncrementalFiles}). Skipping LLM extraction.`;
        console.log(`\n${msg}`);
        console.log(`   Pipeline completed data capture but skipped expensive LLM step.`);
        console.log(`   All raw/silver/gold data is archived for later analysis.`);
        updateConfigField('last_run_status', 'completed_successfully');
        updateManifestStep(currentRunContext.manifestPath, 'extract', 'skipped');
        updateManifestStep(currentRunContext.manifestPath, 'spots', 'skipped');
        
        // Still archive gold files even though LLM was skipped
        try {
          const GOLD_DIR_SKIP = dataPath('gold');
          if (fs.existsSync(GOLD_DIR_SKIP)) {
            const goldFiles = fs.readdirSync(GOLD_DIR_SKIP).filter(f => f.endsWith('.json'));
            if (goldFiles.length > 0) {
              console.log(`\n📦 Archiving ${goldFiles.length} gold file(s) (LLM skipped but preserving state)`);
              archiveDirectory(GOLD_DIR_SKIP, GOLD_ARCHIVE_BASE, runDate);
              cleanOldArchives(GOLD_ARCHIVE_BASE);
            }
          }
        } catch (archiveErr) {
          console.warn(`   ⚠️  Gold archive failed (non-fatal): ${archiveErr.message}`);
        }
        
        console.log('\n✅ Pipeline completed (data captured, LLM skipped)');
        
        const finalConfig = loadConfig();
        console.log('\n📋 Final Pipeline State:');
        console.log(`   Last run status: ${finalConfig.last_run_status}`);
        console.log(`   Last raw processed date: ${finalConfig.last_raw_processed_date || 'null'}`);
        console.log(`   Last merged processed date: ${finalConfig.last_merged_processed_date || 'null'}`);
        console.log(`   Last trimmed processed date: ${finalConfig.last_trimmed_processed_date || 'null'}`);
        console.log(`   Incremental files preserved: ${incrementalFileCount} (for later analysis)`);
        
        finalizeManifest(currentRunContext.manifestPath, 'completed_successfully');
        releaseLock();
        if (logFileStream) {
          logFileStream.end(() => {
            logFileStream = null;
            restoreConsole();
            process.exit(0);
          });
          setTimeout(() => { restoreConsole(); process.exit(0); }, 2000);
        } else {
          restoreConsole();
          process.exit(0);
        }
        return; // prevent further execution while waiting for flush
      }
      
      try {
        await runScript('extract-promotions.js', ['--incremental']);
        updateManifestStep(currentRunContext.manifestPath, 'extract', 'completed');
      } catch (error) {
        updateConfigField('last_run_status', 'failed_at_extract');
        updateManifestStep(currentRunContext.manifestPath, 'extract', 'failed');
        throw error;
      }
      
      // Step 5: Create spots
      console.log('\n📍 Step 5: Create Spots from Gold Data');
      console.log(`   Found ${incrementalFileCount} incremental file(s) - processing spots`);
      updateConfigField('last_run_status', 'running_spots');
      updateManifestStep(currentRunContext.manifestPath, 'spots', 'running');
      try {
        await runScript('create-spots.js');
        updateManifestStep(currentRunContext.manifestPath, 'spots', 'completed');
        updateConfigField('last_run_status', 'completed_successfully');
      } catch (error) {
        updateConfigField('last_run_status', 'failed_at_spots');
        updateManifestStep(currentRunContext.manifestPath, 'spots', 'failed');
        throw error;
      }
    }
    
    // Archive gold files daily for rolling analysis
    try {
      const GOLD_DIR = dataPath('gold');
      if (fs.existsSync(GOLD_DIR)) {
        const goldFiles = fs.readdirSync(GOLD_DIR).filter(f => f.endsWith('.json'));
        if (goldFiles.length > 0) {
          console.log(`\n📦 Archiving ${goldFiles.length} gold file(s)`);
          archiveDirectory(GOLD_DIR, GOLD_ARCHIVE_BASE, runDate);
          cleanOldArchives(GOLD_ARCHIVE_BASE);
        }
      }
    } catch (archiveErr) {
      console.warn(`   ⚠️  Gold archive failed (non-fatal): ${archiveErr.message}`);
    }
    
    // Try to extract final stats from create-spots.log
    let finalStats = {};
    try {
      const createSpotsLogPath = path.join(__dirname, '..', 'logs', 'create-spots.log');
      if (fs.existsSync(createSpotsLogPath)) {
        const logContent = fs.readFileSync(createSpotsLogPath, 'utf8');
        // Extract summary stats from log
        const newSpotsMatch = logContent.match(/New automated spots created: (\d+)/);
        const existingSpotsMatch = logContent.match(/Existing automated spots preserved: (\d+)/);
        const manualSpotsMatch = logContent.match(/Manual spots preserved: (\d+)/);
        const totalSpotsMatch = logContent.match(/Total spots in spots\.json: (\d+)/);
        const skippedMatch = logContent.match(/Skipped \(already exists\): (\d+)/);
        const missingVenueMatch = logContent.match(/Missing venue data: (\d+)/);
        const noHappyHourMatch = logContent.match(/No happy hour: (\d+)/);
        
        if (newSpotsMatch) finalStats.newAutomated = parseInt(newSpotsMatch[1]);
        if (existingSpotsMatch) finalStats.existingAutomated = parseInt(existingSpotsMatch[1]);
        if (manualSpotsMatch) finalStats.manual = parseInt(manualSpotsMatch[1]);
        if (totalSpotsMatch) finalStats.total = parseInt(totalSpotsMatch[1]);
        if (skippedMatch) finalStats.skipped = parseInt(skippedMatch[1]);
        if (missingVenueMatch) finalStats.missingVenue = parseInt(missingVenueMatch[1]);
        if (noHappyHourMatch) finalStats.noHappyHour = parseInt(noHappyHourMatch[1]);
      }
    } catch (err) {
      console.warn('   ⚠️  Could not extract final stats from create-spots.log');
    }
    
    const pipelineEndTime = Date.now();
    const pipelineEndTimeEST = getESTTime();
    const durationMs = pipelineEndTime - pipelineStartTime;
    const durationSeconds = Math.floor(durationMs / 1000);
    const durationMinutes = Math.floor(durationSeconds / 60);
    const durationHours = Math.floor(durationMinutes / 60);
    const durationStr = durationHours > 0 
      ? `${durationHours}h ${durationMinutes % 60}m ${durationSeconds % 60}s`
      : durationMinutes > 0
      ? `${durationMinutes}m ${durationSeconds % 60}s`
      : `${durationSeconds}s`;
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ Incremental Pipeline Complete!');
    console.log(`   Finished entire script at ${pipelineEndTimeEST} EST`);
    console.log(`   Total duration: ${durationStr}`);
    console.log('\n📊 Final Statistics:');
    if (Object.keys(finalStats).length > 0) {
      if (finalStats.newAutomated !== undefined) console.log(`   ✅ New automated spots created: ${finalStats.newAutomated}`);
      if (finalStats.existingAutomated !== undefined) console.log(`   📋 Existing automated spots preserved: ${finalStats.existingAutomated}`);
      if (finalStats.manual !== undefined) console.log(`   👤 Manual spots preserved: ${finalStats.manual}`);
      if (finalStats.total !== undefined) console.log(`   📄 Total spots: ${finalStats.total}`);
      if (finalStats.skipped !== undefined) console.log(`   ⚠️  Skipped: ${finalStats.skipped}`);
      if (finalStats.missingVenue !== undefined) console.log(`   ❌ Missing venue data: ${finalStats.missingVenue}`);
      if (finalStats.noHappyHour !== undefined) console.log(`   ℹ️  No happy hour: ${finalStats.noHappyHour}`);
    } else {
      console.log('   (Stats not available)');
    }
    console.log('='.repeat(60));
    
    // Log final config state
    const finalConfig = loadConfig();
    console.log('\n📋 Final Pipeline State:');
    console.log(`   Last run status: ${finalConfig.last_run_status}`);
    console.log(`   Last raw processed date: ${finalConfig.last_raw_processed_date || 'null'}`);
    console.log(`   Last merged processed date: ${finalConfig.last_merged_processed_date || 'null'}`);
    console.log(`   Last trimmed processed date: ${finalConfig.last_trimmed_processed_date || 'null'}`);
    finalizeManifest(currentRunContext.manifestPath, 'completed_successfully');
    
  } catch (error) {
    const pipelineEndTime = Date.now();
    const pipelineEndTimeEST = getESTTime();
    const durationMs = pipelineEndTime - pipelineStartTime;
    const durationSeconds = Math.floor(durationMs / 1000);
    const durationMinutes = Math.floor(durationSeconds / 60);
    const durationHours = Math.floor(durationMinutes / 60);
    const durationStr = durationHours > 0 
      ? `${durationHours}h ${durationMinutes % 60}m ${durationSeconds % 60}s`
      : durationMinutes > 0
      ? `${durationMinutes}m ${durationSeconds % 60}s`
      : `${durationSeconds}s`;
    
    console.error('\n❌ Pipeline failed:', error.message);
    console.error(`   Pipeline ended at ${pipelineEndTimeEST} EST`);
    console.error(`   Total duration: ${durationStr}`);
    
    // Log stack trace to file
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    
    // Update status to failed_at_{step} based on current status.
    // Step-level catches already set failed_at_* before re-throwing,
    // so only map running_* states here; leave failed_at_* as-is.
    const currentConfig = loadConfig();
    const curStatus = currentConfig.last_run_status || '';
    if (curStatus.startsWith('failed_at_')) {
      // Already set by step-level catch — don't overwrite
    } else {
      const statusMap = {
        'running_raw': 'failed_at_raw',
        'running_merged': 'failed_at_merged',
        'running_trimmed': 'failed_at_trimmed',
        'running_extract': 'failed_at_extract',
        'running_spots': 'failed_at_spots'
      };
      const failedStatus = statusMap[curStatus];
      if (failedStatus) {
        updateConfigField('last_run_status', failedStatus);
      } else if (curStatus !== 'completed_successfully') {
        updateConfigField('last_run_status', 'failed_unknown');
      }
    }
    
    // Log final config state on error
    const finalConfig = loadConfig();
    console.error('\n📋 Final Pipeline State (after error):');
    console.error(`   Last run status: ${finalConfig.last_run_status}`);
    console.error(`   Last raw processed date: ${finalConfig.last_raw_processed_date || 'null'}`);
    console.error(`   Last merged processed date: ${finalConfig.last_merged_processed_date || 'null'}`);
    console.error(`   Last trimmed processed date: ${finalConfig.last_trimmed_processed_date || 'null'}`);
    finalizeManifest(currentRunContext?.manifestPath, finalConfig.last_run_status || 'failed');
    
    releaseLock();
    restoreConsole();
    process.exit(1);
  } finally {
    releaseLock();
    restoreConsole();
  }
}

main();
