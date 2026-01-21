#!/usr/bin/env node

/**
 * Run Incremental Pipeline - Master Script
 * 
 * Runs the full happy hour pipeline in incremental mode, ensuring:
 * 1. Raw HTML only downloads on new days
 * 2. Merge only processes changed raw files
 * 3. Trim only processes changed silver_merged files
 * 4. Gold (LLM) only processes changed silver_trimmed files (via hash check)
 * 
 * This minimizes LLM API costs by only processing actual changes.
 * 
 * NOTE: Venues are treated as STATIC. This pipeline does NOT call Google Maps API.
 *       To add/update venues, manually run: node scripts/seed-venues.js --confirm
 * 
 * Usage: node scripts/run-incremental-pipeline.js [area-filter]
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const AREA_FILTER = process.argv[2] || null;

/**
 * Get current time in EST timezone formatted as HH:MM:SS
 */
function getESTTime() {
  const now = new Date();
  // EST is UTC-5, EDT is UTC-4 (daylight saving)
  // Use toLocaleString with timeZone option for accurate EST/EDT
  const estTime = now.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  // Format: HH:MM:SS (ensure 2-digit format)
  const parts = estTime.split(':');
  return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}:${parts[2].padStart(2, '0')}`;
}

/**
 * Clear raw/incremental/ folder at the start of each pipeline run
 * This ensures clean state - delta will repopulate it on new days,
 * download will populate it on same day (new venues only)
 */
function clearRawIncremental() {
  const RAW_INCREMENTAL_DIR = path.join(__dirname, '../data/raw/incremental');
  
  if (!fs.existsSync(RAW_INCREMENTAL_DIR)) {
    return;
  }
  
  try {
    const dirs = fs.readdirSync(RAW_INCREMENTAL_DIR);
    let cleared = 0;
    
    for (const dir of dirs) {
      const dirPath = path.join(RAW_INCREMENTAL_DIR, dir);
      const stats = fs.statSync(dirPath);
      
      if (stats.isDirectory()) {
        fs.rmSync(dirPath, { recursive: true, force: true });
        cleared++;
      }
    }
    
    if (cleared > 0) {
      console.log(`🧹 Cleared ${cleared} venue(s) from raw/incremental/ (ensuring clean state)\n`);
    }
  } catch (error) {
    console.warn(`⚠️  Warning: Could not clear raw/incremental/: ${error.message}`);
  }
}

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
      stdio: 'inherit', // Pass through all output
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

async function main() {
  const pipelineStartTime = getESTTime();
  console.log('\n🚀 Starting Incremental Pipeline');
  console.log(`   Starting entire script at ${pipelineStartTime} EST`);
  console.log('   Mode: Incremental (only process changes)');
  console.log('   Goal: Minimize LLM API costs');
  console.log('   📍 Using static venues.json - no Google API calls\n');
  
  if (AREA_FILTER) {
    console.log(`📍 Area filter: ${AREA_FILTER}\n`);
  }
  
  // Clear raw/incremental/ at the start to ensure clean state
  // Delta will repopulate it on new days, download will populate it on same day (new venues only)
  clearRawIncremental();
  
  try {
    // Step 1: Download raw HTML
    // - Same day: Only new venues (venues without raw files)
    // - New day: All venues (full batch)
    console.log('\n📥 Step 1: Download Raw HTML');
    try {
      await runScript('download-raw-html.js', AREA_FILTER ? [AREA_FILTER] : []);
    } catch (error) {
      if (error.message.includes('code 0')) {
        // Script exited with 0 but we caught it as error - this shouldn't happen
        // But handle gracefully if script exits early
        console.log('   ⏭️  Download step skipped (same day - no new venues)');
      } else {
        throw error;
      }
    }
    
    // Step 1.5: Delta comparison (only on new day - finds what changed)
    // Compares raw/today/ vs raw/previous/ and copies only changed files to raw/incremental/
    console.log('\n🔍 Step 1.5: Delta Comparison (find changes)');
    try {
      await runScript('delta-raw-files.js');
    } catch (error) {
      if (error.message.includes('code 0')) {
        console.log('   ⏭️  Delta step completed');
      } else {
        throw error;
      }
    }
    
    // Step 2: Merge raw files (only processes files in raw/incremental/)
    console.log('\n🔗 Step 2: Merge Raw Files (incremental)');
    await runScript('merge-raw-files.js', AREA_FILTER ? [AREA_FILTER] : []);
    
    // Step 3: Trim silver HTML (only changed files)
    console.log('\n✂️  Step 3: Trim Silver HTML (incremental)');
    await runScript('trim-silver-html.js', AREA_FILTER ? [AREA_FILTER] : []);

    // Step 3.5: Delta comparison on trimmed content (finds actual content changes)
    // Compares silver_trimmed/today/ vs silver_trimmed/previous/ and copies only changed files to silver_trimmed/incremental/
    // This compares trimmed content (no ads/tracking), so much more accurate than raw HTML comparison
    console.log('\n🔍 Step 3.5: Delta Comparison (Trimmed Content - find actual content changes)');
    try {
      await runScript('delta-trimmed-files.js');
    } catch (error) {
      if (error.message.includes('code 0')) {
        console.log('   ⏭️  Delta step completed');
      } else {
        throw error;
      }
    }

    // Step 4: Extract happy hours with LLM (only changed files via trimmed content delta)
    console.log('\n🧠 Step 4: Extract Happy Hours with LLM (incremental - trimmed content delta)');
    await runScript('extract-happy-hours.js', ['--incremental']);
    
    // Step 5: Create spots from gold data
    console.log('\n📍 Step 5: Create Spots from Gold Data');
    await runScript('create-spots.js');
    
    const pipelineEndTime = getESTTime();
    console.log('\n' + '='.repeat(60));
    console.log('✅ Incremental Pipeline Complete!');
    console.log(`   Finished entire script at ${pipelineEndTime} EST`);
    console.log('='.repeat(60));
    console.log('\n📊 Summary:');
    console.log('   • Raw HTML: Same day = new venues only, New day = all venues');
    console.log('   • Delta (Raw): Finds changes in raw HTML (new day only)');
    console.log('   • Merge: Only processes files in raw/incremental/');
    console.log('   • Trim: Only processes files in silver_merged/incremental/');
    console.log('   • Delta (Trimmed): Finds actual content changes in trimmed text (ignores ads/tracking)');
    console.log('   • Gold (LLM): Only processes files in silver_trimmed/incremental/ (actual content changes)');
    console.log('   • Spots: Updated from gold data');
    console.log('\n💡 Result: Small batch per day - only actual content changes are processed!\n');
    
  } catch (error) {
    const pipelineEndTime = getESTTime();
    console.error('\n❌ Pipeline failed:', error.message);
    console.error(`   Pipeline ended at ${pipelineEndTime} EST`);
    process.exit(1);
  }
}

main();
