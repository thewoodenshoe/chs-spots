/**
 * Config Utility - Load and Save Pipeline Configuration
 * 
 * Manages pipeline state in data/config/config.json
 */

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../../data/config/config.json');
const CONFIG_DIR = path.dirname(CONFIG_PATH);

// Ensure config directory exists
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

/**
 * Get today's date in YYYYMMDD format
 */
function getTodayDateString() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Load config from config.json
 * Returns default config if file doesn't exist
 */
function loadConfig() {
  const defaultConfig = {
    run_date: getTodayDateString(),
    last_raw_processed_date: null,
    last_run_status: 'idle',
    pipeline: {
      maxIncrementalFiles: 15
    }
  };

  if (!fs.existsSync(CONFIG_PATH)) {
    return defaultConfig;
  }

  try {
    const content = fs.readFileSync(CONFIG_PATH, 'utf8');
    const config = JSON.parse(content);
    
    // Merge with defaults to ensure all fields exist
    return {
      ...defaultConfig,
      ...config,
      pipeline: {
        ...defaultConfig.pipeline,
        ...(config.pipeline || {})
      }
    };
  } catch (error) {
    console.warn(`⚠️  Warning: Could not load config from ${CONFIG_PATH}: ${error.message}`);
    console.warn(`   Using default config.`);
    return defaultConfig;
  }
}

/**
 * Save config to config.json
 */
function saveConfig(config) {
  try {
    // Ensure config directory exists
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8');
    return true;
  } catch (error) {
    console.error(`❌ Error saving config to ${CONFIG_PATH}: ${error.message}`);
    return false;
  }
}

/**
 * Update a specific field in config
 */
function updateConfigField(field, value) {
  const config = loadConfig();
  const keys = field.split('.');
  let target = config;
  
  for (let i = 0; i < keys.length - 1; i++) {
    if (!target[keys[i]]) {
      target[keys[i]] = {};
    }
    target = target[keys[i]];
  }
  
  target[keys[keys.length - 1]] = value;
  saveConfig(config);
  return config;
}

/**
 * Get run date from config or parameter
 */
function getRunDate(runDateParam = null) {
  if (runDateParam) {
    // Validate format YYYYMMDD
    if (!/^\d{8}$/.test(runDateParam)) {
      throw new Error(`Invalid run_date format: ${runDateParam}. Expected YYYYMMDD`);
    }
    return runDateParam;
  }
  return getTodayDateString();
}

module.exports = {
  loadConfig,
  saveConfig,
  updateConfigField,
  getRunDate,
  getTodayDateString,
  CONFIG_PATH
};
