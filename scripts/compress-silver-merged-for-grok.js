/**
 * Compress Silver Merged Files for Grok Upload
 * 
 * Combines all files from data/silver_merged/all/ into multiple compressed JSON files
 * (roughly 50MB each) for Grok upload. Keeps venues together (doesn't split venues
 * across files).
 * 
 * Output: data/silver_merged/compressed/part-1.json, part-2.json, etc.
 * 
 * Run with: node scripts/compress-silver-merged-for-grok.js
 */

const fs = require('fs');
const path = require('path');

// Logging setup
const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logPath = path.join(logDir, 'compress-silver-merged-for-grok.log');

fs.writeFileSync(logPath, '', 'utf8');

function log(message) {
  const ts = new Date().toISOString();
  console.log(message);
  fs.appendFileSync(logPath, `[${ts}] ${message}\n`);
}

// Paths - Now reading from silver_merged/all/ instead of silver_matched/
const SILVER_MERGED_ALL_DIR = path.join(__dirname, '../data/silver_merged/all');
const COMPRESSED_DIR = path.join(__dirname, '../data/silver_merged/compressed');

// Target size per file (roughly 50MB, but in bytes we'll use 45MB to leave buffer)
const TARGET_SIZE_BYTES = 45 * 1024 * 1024; // 45MB

// Ensure compressed directory exists
if (!fs.existsSync(COMPRESSED_DIR)) {
  fs.mkdirSync(COMPRESSED_DIR, { recursive: true });
}

/**
 * Get file size in bytes
 */
function getFileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch (e) {
    return 0;
  }
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Main function
 */
function main() {
  log('📦 Compressing Silver Merged Files for Grok Upload\n');
  
  // Check silver_merged/all directory
  if (!fs.existsSync(SILVER_MERGED_ALL_DIR)) {
    log(`❌ Silver merged directory not found: ${SILVER_MERGED_ALL_DIR}`);
    log(`   Run merge-raw-files.js first`);
    process.exit(1);
  }
  
  // Get all JSON files
  const files = fs.readdirSync(SILVER_MERGED_ALL_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => path.join(SILVER_MERGED_ALL_DIR, f));
  
  log(`📁 Found ${files.length} venue file(s) in silver_merged/all/\n`);
  
  if (files.length === 0) {
    log('❌ No venue files to compress. Run merge-raw-files.js first.');
    process.exit(1);
  }
  
  // Sort files by size (largest first) to better distribute across parts
  const filesWithSize = files.map(f => ({
    path: f,
    size: getFileSize(f),
    name: path.basename(f)
  })).sort((a, b) => b.size - a.size);
  
  log(`📊 Total size: ${formatBytes(filesWithSize.reduce((sum, f) => sum + f.size, 0))}\n`);
  
  // Clean up existing compressed files
  const existingCompressed = fs.readdirSync(COMPRESSED_DIR).filter(f => f.endsWith('.json'));
  if (existingCompressed.length > 0) {
    log(`🗑️  Removing ${existingCompressed.length} existing compressed file(s)...`);
    existingCompressed.forEach(f => {
      fs.unlinkSync(path.join(COMPRESSED_DIR, f));
    });
    log(`✅ Cleaned up existing compressed files\n`);
  }
  
  // Combine files into parts
  const parts = [];
  let currentPart = {
    venues: [],
    size: 0
  };
  let partNumber = 1;
  
  for (const fileInfo of filesWithSize) {
    try {
      const content = fs.readFileSync(fileInfo.path, 'utf8');
      const data = JSON.parse(content);
      
      // Calculate size of this venue as JSON string
      const venueJsonString = JSON.stringify(data);
      const venueSize = Buffer.byteLength(venueJsonString, 'utf8');
      
      // Check if adding this venue would exceed target size
      if (currentPart.venues.length > 0 && currentPart.size + venueSize > TARGET_SIZE_BYTES) {
        // Save current part
        const partData = {
          totalVenues: currentPart.venues.length,
          compressedAt: new Date().toISOString(),
          venues: currentPart.venues
        };
        
        const partPath = path.join(COMPRESSED_DIR, `part-${partNumber}.json`);
        fs.writeFileSync(partPath, JSON.stringify(partData, null, 2), 'utf8');
        
        const partSize = getFileSize(partPath);
        parts.push({
          partNumber,
          file: `part-${partNumber}.json`,
          size: partSize,
          venueCount: currentPart.venues.length
        });
        
        log(`✅ Created part-${partNumber}.json: ${formatBytes(partSize)} (${currentPart.venues.length} venues)`);
        
        // Start new part
        currentPart = {
          venues: [],
          size: 0
        };
        partNumber++;
      }
      
      // Add venue to current part
      currentPart.venues.push(data);
      currentPart.size += venueSize;
      
    } catch (error) {
      log(`  ⚠️  Error processing ${fileInfo.name}: ${error.message}`);
    }
  }
  
  // Save last part if it has venues
  if (currentPart.venues.length > 0) {
    const partData = {
      totalVenues: currentPart.venues.length,
      compressedAt: new Date().toISOString(),
      venues: currentPart.venues
    };
    
    const partPath = path.join(COMPRESSED_DIR, `part-${partNumber}.json`);
    fs.writeFileSync(partPath, JSON.stringify(partData, null, 2), 'utf8');
    
    const partSize = getFileSize(partPath);
    parts.push({
      partNumber,
      file: `part-${partNumber}.json`,
      size: partSize,
      venueCount: currentPart.venues.length
    });
    
    log(`✅ Created part-${partNumber}.json: ${formatBytes(partSize)} (${currentPart.venues.length} venues)`);
  }
  
  // Summary
  const totalSize = parts.reduce((sum, p) => sum + p.size, 0);
  const totalVenues = parts.reduce((sum, p) => sum + p.venueCount, 0);
  
  log(`\n📊 Summary:`);
  log(`   📁 Total Parts: ${parts.length}`);
  log(`   📦 Total Size: ${formatBytes(totalSize)}`);
  log(`   🏢 Total Venues: ${totalVenues}`);
  log(`   📄 Output Directory: ${path.resolve(COMPRESSED_DIR)}`);
  log(`\n✨ Done!`);
  log(`\n📋 Next Steps:`);
  log(`   1. Upload the part-*.json files to Grok (one at a time)`);
  log(`   2. Use the provided Grok prompt for extraction`);
  log(`   3. Save results for each part`);
  log(`   4. Combine results after all parts are processed`);
}

try {
  main();
} catch (error) {
  log(`❌ Fatal error: ${error.message || error}`);
  console.error(error);
  process.exit(1);
}
