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
  const pipelineStartTime = getESTTime();
  console.log('\n🚀 Starting Incremental Pipeline with State Management');
  console.log(`   Starting entire script at ${pipelineStartTime} EST`);
  
  // Initialize config
  const config = loadConfig();
  const runDate = getRunDate(RUN_DATE_PARAM);
  
  // Update run_date in config
  updateConfigField('run_date', runDate);
  console.log(`   Run date: ${runDate}`);
  
  // Check for recovery
  const lastRunStatus = config.last_run_status;
  const recoveryPoint = getRecoveryPoint(lastRunStatus);
  
  if (recoveryPoint && lastRunStatus !== 'completed_successfully' && lastRunStatus !== 'idle') {
    console.log(`\n⚠️  Previous run failed at ${lastRunStatus}. Attempting recovery from last known good state.`);
    console.log(`   Recovery point: ${recoveryPoint}`);
  }
  
  // Set initial status
  updateConfigField('last_run_status', 'running_raw');
  
  try {
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
    
    if (incrementalFileCount > 15) {
      const errorMsg = `Too many incremental files (${incrementalFileCount} > 15). Manual review required.`;
      console.error(`\n❌ ${errorMsg}`);
      updateConfigField('last_run_status', 'failed_at_extract');
      throw new Error(errorMsg);
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
    
    const pipelineEndTime = getESTTime();
    console.log('\n' + '='.repeat(60));
    console.log('✅ Incremental Pipeline Complete!');
    console.log(`   Finished entire script at ${pipelineEndTime} EST`);
    console.log('='.repeat(60));
    
  } catch (error) {
    const pipelineEndTime = getESTTime();
    console.error('\n❌ Pipeline failed:', error.message);
    console.error(`   Pipeline ended at ${pipelineEndTime} EST`);
    
    // Status already updated in catch blocks above
    const currentConfig = loadConfig();
    if (currentConfig.last_run_status === 'running_raw') {
      updateConfigField('last_run_status', 'failed_at_raw');
    } else if (currentConfig.last_run_status === 'running_merged') {
      updateConfigField('last_run_status', 'failed_at_merged');
    } else if (currentConfig.last_run_status === 'running_trimmed') {
      updateConfigField('last_run_status', 'failed_at_trimmed');
    }
    
    process.exit(1);
  }
}

main();
