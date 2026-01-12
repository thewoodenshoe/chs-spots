/**
 * Validation script to check if venues are correctly assigned to areas based on addresses
 * This script analyzes venues.json and identifies potential misassignments
 */

const fs = require('fs');
const path = require('path');

const venuesPath = path.join(__dirname, '..', 'data', 'venues.json');
const areasPath = path.join(__dirname, '..', 'data', 'areas.json');

// Load data
const venues = JSON.parse(fs.readFileSync(venuesPath, 'utf8'));
const areas = JSON.parse(fs.readFileSync(areasPath, 'utf8'));

// Address keywords that indicate specific areas (matches seed-venues.js logic)
const explicitAreaKeywords = {
  'north charleston': 'North Charleston',
  'n charleston': 'North Charleston',
  'downtown': 'Downtown Charleston',
  'downtown charleston': 'Downtown Charleston',
  'mount pleasant': 'Mount Pleasant',
  'mt pleasant': 'Mount Pleasant',
  'mt. pleasant': 'Mount Pleasant',
  'west ashley': 'West Ashley',
  'james island': 'James Island',
  "sullivan's island": "Sullivan's Island",
  'sullivans island': "Sullivan's Island",
  'daniel island': 'Daniel Island',
};

function extractAreaFromAddress(address) {
  if (!address) return null;
  const addressLower = address.toLowerCase();
  
  // Check explicit area names first
  const sortedExplicit = Object.keys(explicitAreaKeywords).sort((a, b) => b.length - a.length);
  for (const keyword of sortedExplicit) {
    if (addressLower.includes(keyword)) {
      return explicitAreaKeywords[keyword];
    }
  }
  
  // King Street: 1-2000 = Downtown, 2000+ = West Ashley
  if (addressLower.includes('king street')) {
    const numberMatch = address.match(/(\d+)\s+king street/i);
    if (numberMatch) {
      const streetNumber = parseInt(numberMatch[1]);
      if (streetNumber >= 1 && streetNumber <= 2000) {
        return 'Downtown Charleston';
      } else if (streetNumber > 2000) {
        return 'West Ashley';
      }
    }
  }
  
  // East Bay Street: Downtown Charleston
  if (addressLower.includes('east bay street') || addressLower.includes('east bay st')) {
    return 'Downtown Charleston';
  }
  
  // Meeting Street: 1-400 = Downtown, 400+ = North Charleston
  if (addressLower.includes('meeting street')) {
    const numberMatch = address.match(/(\d+)\s+meeting street/i);
    if (numberMatch) {
      const streetNumber = parseInt(numberMatch[1]);
      if (streetNumber >= 1 && streetNumber <= 400) {
        return 'Downtown Charleston';
      } else if (streetNumber >= 400) {
        return 'North Charleston';
      }
    }
  }
  
  // Pittsburgh Avenue: North Charleston
  if (addressLower.includes('pittsburgh avenue') || addressLower.includes('pittsburgh ave')) {
    return 'North Charleston';
  }
  
  // Clements Ferry Road: Daniel Island (if zip 29492 or within bounds)
  if (addressLower.includes('clements ferry') || addressLower.includes('clements ferry road')) {
    return 'Daniel Island'; // Will be validated with zip code or bounds
  }
  
  // Island Park Drive: Daniel Island
  if (addressLower.includes('island park') || addressLower.includes('island park drive')) {
    return 'Daniel Island';
  }
  
  // Seven Farms Drive: Daniel Island
  if (addressLower.includes('seven farms') || addressLower.includes('seven farms drive')) {
    return 'Daniel Island';
  }
  
  return null;
}

function isInBounds(lat, lng, area) {
  if (!area.bounds || !lat || !lng) return false;
  const { south, west, north, east } = area.bounds;
  return lat >= south && lat <= north && lng >= west && lng <= east;
}

console.log('🔍 Validating Venue Area Assignments\n');
console.log(`Total venues: ${venues.length}\n`);

// Group venues by assigned area
const venuesByArea = {};
venues.forEach(v => {
  const area = v.area || 'Unknown';
  if (!venuesByArea[area]) venuesByArea[area] = [];
  venuesByArea[area].push(v);
});

// Analyze each area
const misassignments = {};
const areaStats = {};

for (const areaName of Object.keys(venuesByArea).sort()) {
  const areaVenues = venuesByArea[areaName];
  const areaConfig = areas.find(a => a.name === areaName);
  
  console.log(`\n📍 ${areaName} (${areaVenues.length} venues):`);
  areaStats[areaName] = {
    total: areaVenues.length,
    misassigned: [],
    potentialIssues: []
  };
  
  areaVenues.forEach(venue => {
    const addressArea = extractAreaFromAddress(venue.address);
    const inBounds = areaConfig && isInBounds(venue.lat, venue.lng, areaConfig);
    
    // Check for misassignments
    if (addressArea && addressArea !== areaName) {
      // Address indicates a different area
      const issue = {
        name: venue.name,
        address: venue.address,
        assignedArea: areaName,
        addressIndicates: addressArea,
        coordinates: `(${venue.lat}, ${venue.lng})`,
        reason: `Address contains "${addressArea}" but assigned to ${areaName}`
      };
      areaStats[areaName].misassigned.push(issue);
      misassignments[areaName] = misassignments[areaName] || [];
      misassignments[areaName].push(issue);
    } else if (areaConfig && !inBounds) {
      // Coordinates outside bounds
      const zipCode = venue.address ? venue.address.match(/\b(\d{5})\b/)?.[1] : null;
      const issue = {
        name: venue.name,
        address: venue.address,
        assignedArea: areaName,
        coordinates: `(${venue.lat}, ${venue.lng})`,
        zipCode: zipCode || 'N/A',
        reason: `Coordinates outside ${areaName} bounds${zipCode && areaConfig.zipCodes?.includes(zipCode) ? ' (but zip code matches)' : ''}`
      };
      areaStats[areaName].potentialIssues.push(issue);
    }
  });
  
  // Print summary
  if (areaStats[areaName].misassigned.length > 0) {
    console.log(`  ❌ Misassigned: ${areaStats[areaName].misassigned.length}`);
  }
  if (areaStats[areaName].potentialIssues.length > 0) {
    console.log(`  ⚠️  Potential issues: ${areaStats[areaName].potentialIssues.length}`);
  }
  if (areaStats[areaName].misassigned.length === 0 && areaStats[areaName].potentialIssues.length === 0) {
    console.log(`  ✅ All venues correctly assigned`);
  }
}

// Print detailed misassignments
if (Object.keys(misassignments).length > 0) {
  console.log('\n\n📋 Detailed Misassignments:\n');
  
  for (const areaName of Object.keys(misassignments).sort()) {
    console.log(`\n${areaName} (${misassignments[areaName].length} misassigned):`);
    misassignments[areaName].forEach(issue => {
      console.log(`  ❌ ${issue.name}`);
      console.log(`     Address: ${issue.address}`);
      console.log(`     Assigned to: ${issue.assignedArea}`);
      console.log(`     Address indicates: ${issue.addressIndicates}`);
      console.log(`     Reason: ${issue.reason}`);
      console.log('');
    });
  }
} else {
  console.log('\n\n✅ No misassignments found!');
}

// Summary
console.log('\n\n📊 Summary:');
let totalMisassigned = 0;
for (const areaName of Object.keys(areaStats)) {
  totalMisassigned += areaStats[areaName].misassigned.length;
}
console.log(`Total misassigned venues: ${totalMisassigned}`);
console.log(`Total venues: ${venues.length}`);
console.log(`Accuracy: ${((venues.length - totalMisassigned) / venues.length * 100).toFixed(1)}%`);

// Exit with error code if misassignments found
process.exit(totalMisassigned > 0 ? 1 : 0);
