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
 * Usage: node scripts/run-incremental-pipeline.js [area-filter]
 */

const { spawn } = require('child_process');
const path = require('path');

const AREA_FILTER = process.argv[2] || null;

function runScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const fullPath = path.join(__dirname, scriptPath);
    const nodeArgs = [fullPath, ...args].filter(Boolean);
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Running: node ${scriptPath}${args.length > 0 ? ' ' + args.join(' ') : ''}`);
    console.log('='.repeat(60));
    
    const child = spawn('node', nodeArgs, {
      stdio: 'inherit', // Pass through all output
      cwd: path.join(__dirname, '..')
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        resolve(code);
      } else {
        reject(new Error(`Script exited with code ${code}`));
      }
    });
    
    child.on('error', (error) => {
      reject(error);
    });
  });
}

async function main() {
  console.log('\n🚀 Starting Incremental Pipeline');
  console.log('   Mode: Incremental (only process changes)');
  console.log('   Goal: Minimize LLM API costs\n');
  
  if (AREA_FILTER) {
    console.log(`📍 Area filter: ${AREA_FILTER}\n`);
  }
  
  try {
    // Step 1: Download raw HTML (only if new day)
    console.log('\n📥 Step 1: Download Raw HTML (skips if same day)');
    try {
      await runScript('download-raw-html.js', AREA_FILTER ? [AREA_FILTER] : []);
    } catch (error) {
      if (error.message.includes('code 0')) {
        // Script exited with 0 but we caught it as error - this shouldn't happen
        // But handle gracefully if script exits early
        console.log('   ⏭️  Download step skipped (same day or no changes)');
      } else {
        throw error;
      }
    }
    
    // Step 2: Merge raw files (only changed files)
    console.log('\n🔗 Step 2: Merge Raw Files (incremental)');
    await runScript('merge-raw-files.js', AREA_FILTER ? [AREA_FILTER] : []);
    
    // Step 3: Trim silver HTML (only changed files)
    console.log('\n✂️  Step 3: Trim Silver HTML (incremental)');
    await runScript('trim-silver-html.js', AREA_FILTER ? [AREA_FILTER] : []);
    
    // Step 4: Extract happy hours with LLM (only changed files via hash check)
    console.log('\n🧠 Step 4: Extract Happy Hours with LLM (incremental hash-based)');
    await runScript('extract-happy-hours.js', ['--incremental']);
    
    // Step 5: Create spots from gold data
    console.log('\n📍 Step 5: Create Spots from Gold Data');
    await runScript('create-spots.js');
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ Incremental Pipeline Complete!');
    console.log('='.repeat(60));
    console.log('\n📊 Summary:');
    console.log('   • Raw HTML: Only downloaded if new day');
    console.log('   • Merge: Only processed changed files');
    console.log('   • Trim: Only processed changed files');
    console.log('   • Gold (LLM): Only processed changed files (hash-based)');
    console.log('   • Spots: Updated from gold data\n');
    
  } catch (error) {
    console.error('\n❌ Pipeline failed:', error.message);
    process.exit(1);
  }
}

main();
