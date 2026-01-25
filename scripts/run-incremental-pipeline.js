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

const RUN_DATE_PARAM = process.argv[2] && /^\d{8}$/.test(process.argv[2]) ? process.argv[2] : null;
const AREA_FILTER = process.argv[2] && !/^\d{8}$/.test(process.argv[2]) ? process.argv[2] : (process.argv[3] || null);

// Logging setup
let logFileStream = null;
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
      cwd: path.join(__dirname, '..')
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

/**
 * Determine recovery point from last_run_status
 */
function getRecoveryPoint(lastRunStatus) {
  const recoveryMap = {
    'failed_at_raw': 'raw',
    'failed_at_merged': 'merged',
    'failed_at_trimmed': 'trimmed',
    'failed_at_extract': 'extract'
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
    console.log('\n🚀 Starting Incremental Pipeline with State Management');
    console.log(`   Starting entire script at ${pipelineStartTimeEST} EST`);
    console.log(`   Log file: ${logPath}`);
    
    // Initialize config
    const config = loadConfig();
    const runDate = getRunDate(RUN_DATE_PARAM);
    
    // Log full config at start
    console.log('\n📋 Pipeline Configuration:');
    console.log(JSON.stringify(config, null, 2));
    console.log(`   Run date: ${runDate}`);
    console.log(`   Last raw processed date: ${config.last_raw_processed_date || 'null'}`);
    console.log(`   Last merged processed date: ${config.last_merged_processed_date || 'null'}`);
    console.log(`   Last trimmed processed date: ${config.last_trimmed_processed_date || 'null'}`);
    console.log(`   Last run status: ${config.last_run_status || 'idle'}`);
    
    // Update run_date in config
    updateConfigField('run_date', runDate);
    
    // Check for recovery
    const lastRunStatus = config.last_run_status;
    const recoveryPoint = getRecoveryPoint(lastRunStatus);
    
    if (recoveryPoint && lastRunStatus !== 'completed_successfully' && lastRunStatus !== 'idle') {
      console.log(`\n⚠️  Previous run failed at ${lastRunStatus}. Attempting recovery from last known good state.`);
      console.log(`   Recovery point: ${recoveryPoint}`);
    }
    
    // Set initial status
    updateConfigField('last_run_status', 'running_raw');
    
    // RAW STEPS
    const RAW_TODAY_DIR = path.join(__dirname, '../data/raw/today');
    const RAW_PREVIOUS_DIR = path.join(__dirname, '../data/raw/previous');
    const rawTodayEmpty = isDirectoryEmpty(RAW_TODAY_DIR);
    const lastRawDate = config.last_raw_processed_date;
    
    if (recoveryPoint && ['merged', 'trimmed', 'extract'].includes(recoveryPoint)) {
      // Skip raw steps - recovering from later stage
      console.log('\n⏭️  Skipping raw steps (recovering from later stage)');
    } else {
      console.log('\n📥 Step 1: Download Raw HTML');
      
      if (rawTodayEmpty) {
        // Empty today/ - download all content
        console.log('   📁 raw/today/ is empty - downloading all content');
        updateConfigField('last_run_status', 'running_raw');
        await runScript('download-raw-html.js', AREA_FILTER ? [AREA_FILTER] : []);
        updateConfigField('last_raw_processed_date', runDate);
        updateConfigField('last_run_status', 'running_raw');
      } else if (lastRawDate === runDate) {
        // Same day - skip downloading
        console.log(`   ⏭️  raw/today/ not empty and last_raw_processed_date (${lastRawDate}) equals run_date (${runDate}) - skipping download`);
        updateConfigField('last_run_status', 'running_raw');
      } else {
        // New day - archive and download
        console.log(`   📅 New day detected (${runDate} vs ${lastRawDate})`);
        console.log('   🗂️  Deleting raw/previous/, copying raw/today/ to raw/previous/');
        
        // Delete previous/
        if (fs.existsSync(RAW_PREVIOUS_DIR)) {
          fs.rmSync(RAW_PREVIOUS_DIR, { recursive: true, force: true });
        }
        fs.mkdirSync(RAW_PREVIOUS_DIR, { recursive: true });
        
        // Copy today/ to previous/
        const todayDirs = fs.readdirSync(RAW_TODAY_DIR).filter(item => {
          const itemPath = path.join(RAW_TODAY_DIR, item);
          return fs.statSync(itemPath).isDirectory();
        });
        let copied = 0;
        for (const dir of todayDirs) {
          try {
            const sourcePath = path.join(RAW_TODAY_DIR, dir);
            const destPath = path.join(RAW_PREVIOUS_DIR, dir);
            fs.cpSync(sourcePath, destPath, { recursive: true });
            copied++;
          } catch (error) {
            console.warn(`   ⚠️  Failed to copy ${dir}: ${error.message}`);
          }
        }
        console.log(`   ✅ Copied ${copied} venue(s) from raw/today/ to raw/previous/`);
        
        // Delete today/
        for (const dir of todayDirs) {
          fs.rmSync(path.join(RAW_TODAY_DIR, dir), { recursive: true, force: true });
        }
        console.log('   🗑️  Deleted all files from raw/today/');
        
        // Download all content
        console.log('   📥 Downloading all content into raw/today/');
        updateConfigField('last_run_status', 'running_raw');
        await runScript('download-raw-html.js', AREA_FILTER ? [AREA_FILTER] : []);
        updateConfigField('last_raw_processed_date', runDate);
        updateConfigField('last_run_status', 'running_raw');
      }
      
      // Delta comparison
      console.log('\n🔍 Step 1.5: Delta Comparison (Raw HTML)');
      updateConfigField('last_run_status', 'running_raw');
      try {
        await runScript('delta-raw-files.js');
      } catch (error) {
        if (error.message.includes('code 0')) {
          console.log('   ⏭️  Delta step completed');
        } else {
          updateConfigField('last_run_status', 'failed_at_raw');
          throw error;
        }
      }
    }
    
    // SILVER_MERGED STEPS
    if (recoveryPoint && ['trimmed', 'extract'].includes(recoveryPoint)) {
      console.log('\n⏭️  Skipping silver_merged steps (recovering from later stage)');
    } else {
      console.log('\n🔗 Step 2: Merge Raw Files');
      updateConfigField('last_run_status', 'running_merged');
      await runScript('merge-raw-files.js', AREA_FILTER ? [AREA_FILTER] : []);
      updateConfigField('last_run_status', 'running_merged');
    }
    
    // SILVER_TRIMMED STEPS
    if (recoveryPoint && recoveryPoint === 'extract') {
      console.log('\n⏭️  Skipping silver_trimmed steps (recovering from extract)');
    } else {
      console.log('\n✂️  Step 3: Trim Silver HTML');
      updateConfigField('last_run_status', 'running_trimmed');
      await runScript('trim-silver-html.js', AREA_FILTER ? [AREA_FILTER] : []);
      updateConfigField('last_run_status', 'running_trimmed');
      
      console.log('\n🔍 Step 3.5: Delta Comparison (Trimmed Content)');
      try {
        await runScript('delta-trimmed-files.js');
      } catch (error) {
        if (error.message.includes('code 0')) {
          console.log('   ⏭️  Delta step completed');
        } else {
          updateConfigField('last_run_status', 'failed_at_trimmed');
          throw error;
        }
      }
    }
    
    // LLM EXTRACTION
    console.log('\n🧠 Step 4: Extract Happy Hours with LLM');
    updateConfigField('last_run_status', 'running_extract');
    
    // Check incremental file count before running
    const SILVER_TRIMMED_INCREMENTAL_DIR = path.join(__dirname, '../data/silver_trimmed/incremental');
    let incrementalFileCount = 0;
    if (fs.existsSync(SILVER_TRIMMED_INCREMENTAL_DIR)) {
      incrementalFileCount = fs.readdirSync(SILVER_TRIMMED_INCREMENTAL_DIR).filter(f => f.endsWith('.json')).length;
    }
    
    // Get maxIncrementalFiles from config (default: 15)
    const currentConfig = loadConfig();
    const maxIncrementalFiles = currentConfig.pipeline?.maxIncrementalFiles || 15;
    
    if (incrementalFileCount > maxIncrementalFiles) {
      const msg = `⚠️  Too many incremental files (${incrementalFileCount} > ${maxIncrementalFiles}). Manual review required. Skipping LLM extraction.`;
      console.log(`\n${msg}`);
      console.log(`   Pipeline completed successfully but skipped expensive LLM step.`);
      console.log(`   Next run will start fresh from the beginning.`);
      updateConfigField('last_run_status', 'completed_successfully');
      // Don't throw error - exit gracefully
      console.log('\n✅ Pipeline completed (graceful shutdown - skipped LLM)');
      
      // Log final config state
      const finalConfig = loadConfig();
      console.log('\n📋 Final Pipeline State:');
      console.log(`   Last run status: ${finalConfig.last_run_status}`);
      console.log(`   Last raw processed date: ${finalConfig.last_raw_processed_date || 'null'}`);
      console.log(`   Last merged processed date: ${finalConfig.last_merged_processed_date || 'null'}`);
      console.log(`   Last trimmed processed date: ${finalConfig.last_trimmed_processed_date || 'null'}`);
      
      restoreConsole();
      process.exit(0); // Exit successfully
    }
    
    try {
      await runScript('extract-happy-hours.js', ['--incremental']);
      updateConfigField('last_run_status', 'completed_successfully');
    } catch (error) {
      updateConfigField('last_run_status', 'failed_at_extract');
      throw error;
    }
    
    // Step 5: Create spots
    console.log('\n📍 Step 5: Create Spots from Gold Data');
    await runScript('create-spots.js');
    
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
    
    // Status already updated in catch blocks above
    const currentConfig = loadConfig();
    if (currentConfig.last_run_status === 'running_raw') {
      updateConfigField('last_run_status', 'failed_at_raw');
    } else if (currentConfig.last_run_status === 'running_merged') {
      updateConfigField('last_run_status', 'failed_at_merged');
    } else if (currentConfig.last_run_status === 'running_trimmed') {
      updateConfigField('last_run_status', 'failed_at_trimmed');
    }
    
    // Log final config state on error
    const finalConfig = loadConfig();
    console.error('\n📋 Final Pipeline State (after error):');
    console.error(`   Last run status: ${finalConfig.last_run_status}`);
    console.error(`   Last raw processed date: ${finalConfig.last_raw_processed_date || 'null'}`);
    console.error(`   Last merged processed date: ${finalConfig.last_merged_processed_date || 'null'}`);
    console.error(`   Last trimmed processed date: ${finalConfig.last_trimmed_processed_date || 'null'}`);
    
    restoreConsole();
    process.exit(1);
  } finally {
    restoreConsole();
  }
}

main();
