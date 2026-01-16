/**
 * One-time script to fix venue assignments
 * Reassigns venues that are incorrectly assigned to Mount Pleasant but should be in Downtown Charleston
 * Based on coordinate bounds (not running full seed script)
 */

const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const venuesFile = path.join(dataDir, 'venues.json');
const areasFile = path.join(dataDir, 'config', 'areas.json');

// Load data
const venues = JSON.parse(fs.readFileSync(venuesFile, 'utf8'));
const areas = JSON.parse(fs.readFileSync(areasFile, 'utf8'));

const downtownArea = areas.find(a => a.name === 'Downtown Charleston');
const mountPleasantArea = areas.find(a => a.name === 'Mount Pleasant');

if (!downtownArea || !mountPleasantArea) {
  console.error('❌ Could not find Downtown Charleston or Mount Pleasant in areas.json');
  process.exit(1);
}

console.log('🔍 Analyzing venue assignments...\n');
console.log('Downtown Charleston bounds:', downtownArea.bounds);
console.log('Mount Pleasant bounds:', mountPleasantArea.bounds);
console.log('');

// Find Mount Pleasant venues that are actually within Downtown Charleston bounds
const { south, west, north, east } = downtownArea.bounds;

const mountPleasantVenues = venues.filter(v => v.area === 'Mount Pleasant');
const reassignedVenues = [];
let reassignedCount = 0;

console.log(`📊 Mount Pleasant venues before fix: ${mountPleasantVenues.length}`);

// Reassign venues that are within Downtown bounds
venues.forEach(venue => {
  if (venue.area === 'Mount Pleasant' && venue.lat && venue.lng) {
    // Check if venue is within Downtown Charleston bounds
    if (venue.lat >= south && venue.lat <= north && venue.lng >= west && venue.lng <= east) {
      // Extract zip code if available
      const zipCode = venue.address ? (venue.address.match(/\b(\d{5})\b/)?.[1] || null) : null;
      
      // Check if zip code is a Downtown zip code (additional validation)
      const isDowntownZip = zipCode && ['29401', '29403', '29424', '29425'].includes(zipCode);
      
      // Reassign to Downtown Charleston
      venue.area = 'Downtown Charleston';
      reassignedCount++;
      
      if (reassignedCount <= 20) {
        reassignedVenues.push({
          name: venue.name,
          lat: venue.lat,
          lng: venue.lng,
          zip: zipCode || 'N/A',
          address: venue.address?.substring(0, 60)
        });
      }
    }
  }
});

console.log(`✅ Reassigned ${reassignedCount} venues from Mount Pleasant to Downtown Charleston\n`);

if (reassignedVenues.length > 0) {
  console.log('Sample reassigned venues:');
  reassignedVenues.forEach(v => {
    console.log(`  - ${v.name} (zip: ${v.zip}): ${v.address}`);
  });
  if (reassignedCount > 20) {
    console.log(`  ... and ${reassignedCount - 20} more`);
  }
  console.log('');
}

// Count venues by area after reassignment
const areaCounts = {};
venues.forEach(v => {
  const area = v.area || 'Unknown';
  areaCounts[area] = (areaCounts[area] || 0) + 1;
});

console.log('📊 Venues by area after fix:');
Object.entries(areaCounts).sort((a, b) => b[1] - a[1]).forEach(([area, count]) => {
  console.log(`   ${area}: ${count} venues`);
});
console.log('');

// Sort venues by area, then by name
venues.sort((a, b) => {
  if (a.area !== b.area) {
    return (a.area || '').localeCompare(b.area || '');
  }
  return (a.name || '').localeCompare(b.name || '');
});

// Save updated venues.json
fs.writeFileSync(venuesFile, JSON.stringify(venues, null, 2), 'utf8');
console.log(`✅ Updated ${venuesFile}`);
console.log(`\n✨ Fix complete! Reassigned ${reassignedCount} venues.`);
