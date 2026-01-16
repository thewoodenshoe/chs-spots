/**
 * Script to create/update areas.json configuration file
 * This generates the areas configuration used by seed-venues.js and the UI
 * Run with: node scripts/create-areas.js
 */

const fs = require('fs');
const path = require('path');

// Logging setup
const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logPath = path.join(logDir, 'create-areas.log');

/**
 * Logger function: logs to console (with emojis) and file (without emojis, with timestamp)
 */
function log(message) {
  // Log to console (with emojis/colors)
  console.log(message);
  
  // Format timestamp as [YYYY-MM-DD HH:mm:ss]
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const timestamp = `[${year}-${month}-${day} ${hours}:${minutes}:${seconds}]`;
  
  // Strip emojis from message for file logging
  // Emoji ranges: \u{1F300}-\u{1F5FF} (Misc Symbols), \u{1F600}-\u{1F64F} (Emoticons), 
  // \u{1F680}-\u{1F6FF} (Transport), \u{2600}-\u{26FF} (Misc symbols), \u{2700}-\u{27BF} (Dingbats)
  const messageWithoutEmojis = message.replace(/[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim();
  
  // Append to log file
  fs.appendFileSync(logPath, `${timestamp} ${messageWithoutEmojis}\n`, 'utf8');
}

/**
 * Verbose logger: writes detailed information to log file only (not to console)
 * Use for --vvv level detailed logging
 */
function logVerbose(message) {
  // Format timestamp as [YYYY-MM-DD HH:mm:ss]
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const timestamp = `[${year}-${month}-${day} ${hours}:${minutes}:${seconds}]`;
  
  // Strip emojis from message
  const messageWithoutEmojis = message.replace(/[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim();
  
  // Append to log file (verbose details only in file)
  fs.appendFileSync(logPath, `${timestamp} ${messageWithoutEmojis}\n`, 'utf8');
}

const dataDir = path.join(__dirname, '..', 'data');
const areasFile = path.join(dataDir, 'areas.json');

/**
 * Validate bounds for an area
 * Checks: south < north, west < east, lat/lng in Charleston range (lat 32-33, lng -80.1 to -79)
 * Throws error if invalid
 */
function validateBounds(area) {
  const { bounds, center, name } = area;
  
  // Validate bounds structure
  if (!bounds || typeof bounds.south !== 'number' || typeof bounds.north !== 'number' ||
      typeof bounds.west !== 'number' || typeof bounds.east !== 'number') {
    throw new Error(`Invalid bounds structure for area "${name}": bounds must have south, north, west, east as numbers`);
  }
  
  // Validate bounds values: south < north, west < east
  if (bounds.south >= bounds.north) {
    throw new Error(`Invalid bounds for area "${name}": south (${bounds.south}) must be less than north (${bounds.north})`);
  }
  
  if (bounds.west >= bounds.east) {
    throw new Error(`Invalid bounds for area "${name}": west (${bounds.west}) must be less than east (${bounds.east})`);
  }
  
  // Validate center coordinates are in Charleston range (32-33, -80.1 to -79)
  if (center) {
    if (typeof center.lat !== 'number' || center.lat < 32 || center.lat > 33) {
      throw new Error(`Invalid center latitude for area "${name}": ${center.lat} must be between 32 and 33`);
    }
    
    if (typeof center.lng !== 'number' || center.lng < -80.1 || center.lng > -79) {
      throw new Error(`Invalid center longitude for area "${name}": ${center.lng} must be between -80.1 and -79`);
    }
  }
  
  // Validate bounds coordinates are in Charleston range (32-33, -80.1 to -79)
  if (bounds.south < 32 || bounds.north > 33) {
    throw new Error(`Invalid bounds latitude for area "${name}": bounds must be between 32 and 33 (south: ${bounds.south}, north: ${bounds.north})`);
  }
  
  if (bounds.west < -80.1 || bounds.east > -79) {
    throw new Error(`Invalid bounds longitude for area "${name}": bounds must be between -80.1 and -79 (west: ${bounds.west}, east: ${bounds.east})`);
  }
}

// Define all areas
const areas = [
  {
    name: "Daniel Island",
    displayName: "Daniel Island",
    description: "Includes Clements Ferry Road and northern extensions",
    center: { lat: 32.845, lng: -79.908 },
    radiusMeters: 8000,
    bounds: { south: 32.82, west: -79.96, north: 32.89, east: -79.88 },
    zipCodes: ["29492"]
  },
  {
    name: "Mount Pleasant",
    displayName: "Mount Pleasant",
    description: "Broad coverage including Shem Creek",
    center: { lat: 32.795, lng: -79.875 },
    radiusMeters: 12000,
    bounds: { south: 32.75, west: -80.00, north: 32.90, east: -79.80 },
    zipCodes: ["29464", "29466"]
  },
  {
    name: "Downtown Charleston",
    displayName: "Downtown Charleston",
    description: "Historic downtown and surrounding neighborhoods",
    center: { lat: 32.776, lng: -79.931 },
    radiusMeters: 5000,
    bounds: { south: 32.76, west: -79.96, north: 32.79, east: -79.91 },
    zipCodes: ["29401", "29403"]
  },
  {
    name: "Sullivan's Island",
    displayName: "Sullivan's Island",
    description: "Beach community and restaurants",
    center: { lat: 32.760, lng: -79.840 },
    radiusMeters: 3000,
    bounds: { south: 32.75, west: -79.87, north: 32.77, east: -79.83 },
    zipCodes: ["29482"]
  },
  {
    name: "North Charleston",
    displayName: "North Charleston",
    description: "North Charleston area including Tanger Outlets and airport area",
    center: { lat: 32.888, lng: -80.006 },
    radiusMeters: 10000,
    bounds: { south: 32.82, west: -80.10, north: 32.95, east: -79.90 },
    zipCodes: ["29405", "29418", "29420"]
  },
  {
    name: "West Ashley",
    displayName: "West Ashley",
    description: "West Ashley area across the Ashley River",
    center: { lat: 32.785, lng: -80.040 },
    radiusMeters: 8000,
    bounds: { south: 32.72, west: -80.10, north: 32.85, east: -79.95 },
    zipCodes: ["29407", "29414", "29415"]
  },
  {
    name: "James Island",
    displayName: "James Island",
    description: "James Island including western coverage like The Harlow",
    center: { lat: 32.737, lng: -79.965 },
    radiusMeters: 10000,
    bounds: { south: 32.7, west: -79.98, north: 32.75, east: -79.9 },
    zipCodes: ["29412"]
  },
  {
    name: "Isle of Palms",
    displayName: "Isle of Palms",
    description: "Isle of Palms beach community and restaurants",
    center: { lat: 32.786, lng: -79.795 },
    radiusMeters: 5000,
    bounds: { south: 32.77, west: -79.82, north: 32.80, east: -79.77 },
    zipCodes: ["29451"]
  }
];

// Ensure data directory exists
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  log(`📁 Created data directory: ${dataDir}`);
}

// Validate all areas before writing
try {
  log(`🔍 Validating ${areas.length} areas...`);
  areas.forEach((area) => {
    validateBounds(area);
  });
  log(`✅ All areas validated successfully`);
} catch (validationError) {
  log(`❌ Validation error: ${validationError.message}`);
  logVerbose(`Validation error details: Message="${validationError.message}" | Stack="${validationError.stack || 'N/A'}"`);
  process.exit(1);
}

// Write areas.json
try {
  logVerbose(`Writing areas.json to: ${path.resolve(areasFile)}`);
  logVerbose(`Total areas to write: ${areas.length}`);
  
  fs.writeFileSync(areasFile, JSON.stringify(areas, null, 2), 'utf8');
  // Terminal: Simple message
  log(`✅ Successfully created/updated ${path.resolve(areasFile)}`);
  log(`\n📍 Generated ${areas.length} areas:`);
  
  areas.forEach((area, index) => {
    // Terminal: Simple message
    log(`   ${index + 1}. ${area.displayName || area.name}`);
    log(`      Center: (${area.center.lat}, ${area.center.lng})`);
    log(`      Radius: ${area.radiusMeters}m\n`);
    // File: Detailed information
    logVerbose(`Area ${index + 1}: Name="${area.name}" | DisplayName="${area.displayName || area.name}" | Center=(${area.center.lat}, ${area.center.lng}) | Radius=${area.radiusMeters}m | Bounds=(${area.bounds.south}, ${area.bounds.west}) to (${area.bounds.north}, ${area.bounds.east}) | Description="${area.description || 'N/A'}"`);
  });
  
  logVerbose(`File write successful. Output file: ${path.resolve(areasFile)} | File size: ${fs.statSync(areasFile).size} bytes`);
  log(`\n✨ Areas configuration file created successfully!`);
  log(`Done! Log saved to logs/create-areas.log`);
} catch (error) {
  log(`❌ Error writing areas.json: ${error.message}`);
  logVerbose(`Error details: Message="${error.message}" | Stack="${error.stack || 'N/A'}" | Output file="${areasFile}"`);
  process.exit(1);
}
