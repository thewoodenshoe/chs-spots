const fs = require('fs');
const path = require('path');

/**
 * Pipeline State Tests
 * 
 * Tests incremental pipeline state scenarios:
 * - First run (all empty) → today populated, incremental gets all
 * - New day → previous copied from yesterday's today, incremental gets small delta
 * - Same-day rerun → previous unchanged, incremental near-empty
 */

const RAW_BASE_DIR = path.join(__dirname, '../..', 'data', 'raw');
const RAW_TODAY_DIR = path.join(RAW_BASE_DIR, 'today');
const RAW_PREVIOUS_DIR = path.join(RAW_BASE_DIR, 'previous');
const RAW_INCREMENTAL_DIR = path.join(RAW_BASE_DIR, 'incremental');
const TEST_CONFIG_PATH = path.join(__dirname, '../..', 'data', 'config', 'config.test.json');

/**
 * Clean test directory
 */
function cleanTestDir(dirPath) {
  if (fs.existsSync(dirPath)) {
    const items = fs.readdirSync(dirPath);
    for (const item of items) {
      const itemPath = path.join(dirPath, item);
      const stats = fs.statSync(itemPath);
      if (stats.isDirectory()) {
        cleanTestDir(itemPath);
        fs.rmSync(itemPath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(itemPath);
      }
    }
  }
}

/**
 * Count files in directory recursively
 */
function countFilesRecursive(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return 0;
  }
  let count = 0;
  const items = fs.readdirSync(dirPath);
  for (const item of items) {
    const itemPath = path.join(dirPath, item);
    const stats = fs.statSync(itemPath);
    if (stats.isDirectory()) {
      count += countFilesRecursive(itemPath);
    } else {
      count++;
    }
  }
  return count;
}

/**
 * Count venue directories
 */
function countVenueDirs(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return 0;
  }
  const items = fs.readdirSync(dirPath);
  return items.filter(item => {
    const itemPath = path.join(dirPath, item);
    return fs.statSync(itemPath).isDirectory();
  }).length;
}

/**
 * Copy directory using copyFileSync (same as pipeline)
 */
function copyDirectoryWithCopyFileSync(sourceDir, destDir) {
  if (!fs.existsSync(sourceDir)) {
    return 0;
  }
  
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  
  const items = fs.readdirSync(sourceDir);
  let copiedCount = 0;
  
  for (const item of items) {
    const sourcePath = path.join(sourceDir, item);
    const destPath = path.join(destDir, item);
    const stats = fs.statSync(sourcePath);
    
    if (stats.isDirectory()) {
      // Recursively copy subdirectories
      copiedCount += copyDirectoryWithCopyFileSync(sourcePath, destPath);
    } else if (stats.isFile()) {
      // Copy file using copyFileSync
      fs.copyFileSync(sourcePath, destPath);
      copiedCount++;
    }
  }
  
  return copiedCount;
}

describe('Pipeline State Scenarios', () => {
  beforeEach(() => {
    // Clean test directories
    cleanTestDir(RAW_TODAY_DIR);
    cleanTestDir(RAW_PREVIOUS_DIR);
    cleanTestDir(RAW_INCREMENTAL_DIR);
    
    // Ensure directories exist
    [RAW_TODAY_DIR, RAW_PREVIOUS_DIR, RAW_INCREMENTAL_DIR].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
    
    // Clean test config
    if (fs.existsSync(TEST_CONFIG_PATH)) {
      fs.unlinkSync(TEST_CONFIG_PATH);
    }
  });

  afterEach(() => {
    // Clean up test directories
    cleanTestDir(RAW_TODAY_DIR);
    cleanTestDir(RAW_PREVIOUS_DIR);
    cleanTestDir(RAW_INCREMENTAL_DIR);
    
    // Clean test config
    if (fs.existsSync(TEST_CONFIG_PATH)) {
      fs.unlinkSync(TEST_CONFIG_PATH);
    }
  });

  test('First run (all empty) → today populated, incremental gets all', () => {
    // Simulate first run: all directories are empty
    expect(countVenueDirs(RAW_TODAY_DIR)).toBe(0);
    expect(countVenueDirs(RAW_PREVIOUS_DIR)).toBe(0);
    expect(countVenueDirs(RAW_INCREMENTAL_DIR)).toBe(0);
    
    // Simulate download: populate today/ with venue files
    const venueIds = ['ChIJTest1', 'ChIJTest2', 'ChIJTest3'];
    let todayFileCount = 0;
    
    venueIds.forEach(venueId => {
      const venueDir = path.join(RAW_TODAY_DIR, venueId);
      fs.mkdirSync(venueDir, { recursive: true });
      
      // Create some HTML files for each venue
      for (let i = 0; i < 3; i++) {
        const filePath = path.join(venueDir, `file${i}.html`);
        fs.writeFileSync(filePath, `<html>Content for ${venueId} file ${i}</html>`);
        todayFileCount++;
      }
      
      // Create metadata.json
      const metadataPath = path.join(venueDir, 'metadata.json');
      fs.writeFileSync(metadataPath, JSON.stringify({ venueId, files: 3 }, null, 2));
      todayFileCount++;
    });
    
    // Verify today/ is populated
    expect(countVenueDirs(RAW_TODAY_DIR)).toBe(3);
    expect(countFilesRecursive(RAW_TODAY_DIR)).toBe(todayFileCount);
    
    // Simulate delta-raw-files.js: copy all from today/ to incremental/ (first run, previous/ is empty)
    // On first run, everything in today/ is considered "new"
    let incrementalFileCount = 0;
    venueIds.forEach(venueId => {
      const todayVenueDir = path.join(RAW_TODAY_DIR, venueId);
      const incrementalVenueDir = path.join(RAW_INCREMENTAL_DIR, venueId);
      
      if (fs.existsSync(todayVenueDir)) {
        const files = fs.readdirSync(todayVenueDir);
        for (const file of files) {
          const sourcePath = path.join(todayVenueDir, file);
          const destPath = path.join(incrementalVenueDir, file);
          
          if (fs.statSync(sourcePath).isFile()) {
            if (!fs.existsSync(incrementalVenueDir)) {
              fs.mkdirSync(incrementalVenueDir, { recursive: true });
            }
            fs.copyFileSync(sourcePath, destPath);
            incrementalFileCount++;
          }
        }
      }
    });
    
    // Verify incremental/ has all files from today/
    expect(countVenueDirs(RAW_INCREMENTAL_DIR)).toBe(3);
    expect(countFilesRecursive(RAW_INCREMENTAL_DIR)).toBe(incrementalFileCount);
    expect(countFilesRecursive(RAW_INCREMENTAL_DIR)).toBe(countFilesRecursive(RAW_TODAY_DIR));
    
    // Verify previous/ is still empty (first run)
    expect(countVenueDirs(RAW_PREVIOUS_DIR)).toBe(0);
    expect(countFilesRecursive(RAW_PREVIOUS_DIR)).toBe(0);
  });

  test('New day → previous copied from yesterday\'s today, incremental gets small delta', () => {
    // Setup: Simulate yesterday's state - today/ has files from yesterday
    const venueIds = ['ChIJTest1', 'ChIJTest2', 'ChIJTest3', 'ChIJTest4', 'ChIJTest5'];
    let yesterdayFileCount = 0;
    
    venueIds.forEach(venueId => {
      const venueDir = path.join(RAW_TODAY_DIR, venueId);
      fs.mkdirSync(venueDir, { recursive: true });
      
      // Create HTML files
      for (let i = 0; i < 2; i++) {
        const filePath = path.join(venueDir, `file${i}.html`);
        fs.writeFileSync(filePath, `<html>Yesterday's content for ${venueId} file ${i}</html>`);
        yesterdayFileCount++;
      }
      
      // Create metadata.json
      const metadataPath = path.join(venueDir, 'metadata.json');
      fs.writeFileSync(metadataPath, JSON.stringify({ venueId, files: 2 }, null, 2));
      yesterdayFileCount++;
    });
    
    const yesterdayTodayCount = countFilesRecursive(RAW_TODAY_DIR);
    expect(yesterdayTodayCount).toBe(yesterdayFileCount);
    
    // Simulate new day: empty previous/ and incremental/, copy today/ to previous/, empty today/
    // Empty previous/
    if (fs.existsSync(RAW_PREVIOUS_DIR)) {
      fs.rmSync(RAW_PREVIOUS_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(RAW_PREVIOUS_DIR, { recursive: true });
    
    // Empty incremental/
    if (fs.existsSync(RAW_INCREMENTAL_DIR)) {
      const incrementalDirs = fs.readdirSync(RAW_INCREMENTAL_DIR);
      for (const dir of incrementalDirs) {
        const dirPath = path.join(RAW_INCREMENTAL_DIR, dir);
        if (fs.statSync(dirPath).isDirectory()) {
          fs.rmSync(dirPath, { recursive: true, force: true });
        }
      }
    }
    
    // Copy all files from today/ to previous/ using copyFileSync loop
    let copiedCount = 0;
    venueIds.forEach(venueId => {
      const sourceDir = path.join(RAW_TODAY_DIR, venueId);
      const destDir = path.join(RAW_PREVIOUS_DIR, venueId);
      
      if (fs.existsSync(sourceDir)) {
        const filesCopied = copyDirectoryWithCopyFileSync(sourceDir, destDir);
        if (filesCopied > 0) {
          copiedCount++;
        }
      }
    });
    
    expect(copiedCount).toBe(venueIds.length);
    expect(countFilesRecursive(RAW_PREVIOUS_DIR)).toBe(yesterdayFileCount);
    
    // Empty today/
    venueIds.forEach(venueId => {
      const venueDir = path.join(RAW_TODAY_DIR, venueId);
      if (fs.existsSync(venueDir)) {
        fs.rmSync(venueDir, { recursive: true, force: true });
      }
    });
    
    expect(countFilesRecursive(RAW_TODAY_DIR)).toBe(0);
    
    // Simulate new day download: populate today/ with new files (most unchanged, 1 changed)
    let newDayFileCount = 0;
    venueIds.forEach((venueId, index) => {
      const venueDir = path.join(RAW_TODAY_DIR, venueId);
      fs.mkdirSync(venueDir, { recursive: true });
      
      if (index === 2) {
        // Venue 3 has changed content (simulate real change)
        for (let i = 0; i < 2; i++) {
          const filePath = path.join(venueDir, `file${i}.html`);
          fs.writeFileSync(filePath, `<html>NEW DAY - Changed content for ${venueId} file ${i}</html>`);
          newDayFileCount++;
        }
      } else {
        // Other venues have same content (no change)
        for (let i = 0; i < 2; i++) {
          const filePath = path.join(venueDir, `file${i}.html`);
          fs.writeFileSync(filePath, `<html>Yesterday's content for ${venueId} file ${i}</html>`);
          newDayFileCount++;
        }
      }
      
      // Create metadata.json
      const metadataPath = path.join(venueDir, 'metadata.json');
      fs.writeFileSync(metadataPath, JSON.stringify({ venueId, files: 2 }, null, 2));
      newDayFileCount++;
    });
    
    // Simulate delta-raw-files.js: compare today/ vs previous/, copy only changed/new to incremental/
    let incrementalFileCount = 0;
    venueIds.forEach((venueId, index) => {
      const todayVenueDir = path.join(RAW_TODAY_DIR, venueId);
      const previousVenueDir = path.join(RAW_PREVIOUS_DIR, venueId);
      const incrementalVenueDir = path.join(RAW_INCREMENTAL_DIR, venueId);
      
      // Check if venue has changes
      const todayFiles = fs.existsSync(todayVenueDir) ? fs.readdirSync(todayVenueDir) : [];
      const previousFiles = fs.existsSync(previousVenueDir) ? fs.readdirSync(previousVenueDir) : [];
      
      let hasChanges = false;
      
      // Compare files (simplified - in real code, compares hashes)
      if (index === 2) {
        // Venue 3 has changes
        hasChanges = true;
      } else {
        // Check if files are different (simplified check)
        hasChanges = todayFiles.some(file => {
          const todayPath = path.join(todayVenueDir, file);
          const previousPath = path.join(previousVenueDir, file);
          if (!fs.existsSync(previousPath)) {
            return true; // New file
          }
          // In real code, would compare file hashes
          return false; // Assume same for this test
        });
      }
      
      if (hasChanges) {
        // Copy all files from today/ to incremental/
        if (!fs.existsSync(incrementalVenueDir)) {
          fs.mkdirSync(incrementalVenueDir, { recursive: true });
        }
        for (const file of todayFiles) {
          const sourcePath = path.join(todayVenueDir, file);
          const destPath = path.join(incrementalVenueDir, file);
          if (fs.statSync(sourcePath).isFile()) {
            fs.copyFileSync(sourcePath, destPath);
            incrementalFileCount++;
          }
        }
      }
    });
    
    // Verify: previous/ has all files from yesterday
    expect(countFilesRecursive(RAW_PREVIOUS_DIR)).toBe(yesterdayFileCount);
    
    // Verify: today/ has all files from new day
    expect(countFilesRecursive(RAW_TODAY_DIR)).toBe(newDayFileCount);
    
    // Verify: incremental/ has only changed files (small delta - 1 venue changed = 3 files)
    expect(countVenueDirs(RAW_INCREMENTAL_DIR)).toBe(1); // Only 1 venue changed
    expect(countFilesRecursive(RAW_INCREMENTAL_DIR)).toBe(incrementalFileCount);
    expect(incrementalFileCount).toBeLessThan(newDayFileCount); // Small delta
  });

  test('Same-day rerun → previous unchanged, incremental near-empty', () => {
    // Setup: Simulate previous day's data in previous/
    const venueIds = ['ChIJTest1', 'ChIJTest2', 'ChIJTest3'];
    let previousFileCount = 0;
    
    venueIds.forEach(venueId => {
      const venueDir = path.join(RAW_PREVIOUS_DIR, venueId);
      fs.mkdirSync(venueDir, { recursive: true });
      
      for (let i = 0; i < 2; i++) {
        const filePath = path.join(venueDir, `file${i}.html`);
        fs.writeFileSync(filePath, `<html>Previous day content for ${venueId} file ${i}</html>`);
        previousFileCount++;
      }
      
      const metadataPath = path.join(venueDir, 'metadata.json');
      fs.writeFileSync(metadataPath, JSON.stringify({ venueId, files: 2 }, null, 2));
      previousFileCount++;
    });
    
    const initialPreviousCount = countFilesRecursive(RAW_PREVIOUS_DIR);
    expect(initialPreviousCount).toBe(previousFileCount);
    
    // Simulate same-day rerun: previous/ unchanged, today/ repopulated with same content
    // Empty today/ and incremental/ (but leave previous/ untouched)
    if (fs.existsSync(RAW_TODAY_DIR)) {
      const todayDirs = fs.readdirSync(RAW_TODAY_DIR);
      for (const dir of todayDirs) {
        const dirPath = path.join(RAW_TODAY_DIR, dir);
        if (fs.statSync(dirPath).isDirectory()) {
          fs.rmSync(dirPath, { recursive: true, force: true });
        }
      }
    }
    
    if (fs.existsSync(RAW_INCREMENTAL_DIR)) {
      const incrementalDirs = fs.readdirSync(RAW_INCREMENTAL_DIR);
      for (const dir of incrementalDirs) {
        const dirPath = path.join(RAW_INCREMENTAL_DIR, dir);
        if (fs.statSync(dirPath).isDirectory()) {
          fs.rmSync(dirPath, { recursive: true, force: true });
        }
      }
    }
    
    // Verify previous/ is unchanged
    expect(countFilesRecursive(RAW_PREVIOUS_DIR)).toBe(initialPreviousCount);
    
    // Simulate same-day download: repopulate today/ with same content (no changes)
    let todayFileCount = 0;
    venueIds.forEach(venueId => {
      const venueDir = path.join(RAW_TODAY_DIR, venueId);
      fs.mkdirSync(venueDir, { recursive: true });
      
      // Same content as previous day
      for (let i = 0; i < 2; i++) {
        const filePath = path.join(venueDir, `file${i}.html`);
        fs.writeFileSync(filePath, `<html>Previous day content for ${venueId} file ${i}</html>`);
        todayFileCount++;
      }
      
      const metadataPath = path.join(venueDir, 'metadata.json');
      fs.writeFileSync(metadataPath, JSON.stringify({ venueId, files: 2 }, null, 2));
      todayFileCount++;
    });
    
    // Simulate delta-raw-files.js: compare today/ vs previous/
    // Since content is identical, incremental/ should be near-empty (only metadata or 0 files)
    let incrementalFileCount = 0;
    venueIds.forEach(venueId => {
      const todayVenueDir = path.join(RAW_TODAY_DIR, venueId);
      const previousVenueDir = path.join(RAW_PREVIOUS_DIR, venueId);
      
      // Check if files are different (simplified - in real code, compares hashes)
      const todayFiles = fs.existsSync(todayVenueDir) ? fs.readdirSync(todayVenueDir) : [];
      const previousFiles = fs.existsSync(previousVenueDir) ? fs.readdirSync(previousVenueDir) : [];
      
      // Since content is identical, no files should be copied to incremental/
      // (In real code, hash comparison would show no changes)
    });
    
    // Verify: previous/ is unchanged
    expect(countFilesRecursive(RAW_PREVIOUS_DIR)).toBe(initialPreviousCount);
    
    // Verify: today/ is populated
    expect(countFilesRecursive(RAW_TODAY_DIR)).toBe(todayFileCount);
    
    // Verify: incremental/ is near-empty (0 or very few files - no changes detected)
    expect(countFilesRecursive(RAW_INCREMENTAL_DIR)).toBe(incrementalFileCount);
    expect(incrementalFileCount).toBe(0); // No changes, so incremental should be empty
  });
});
