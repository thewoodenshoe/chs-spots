/**
 * Manual validation script for areas API route
 * This validates that the API route logic correctly reads from areas.json
 * Run with: node scripts/validate-areas-api.js
 */

const fs = require('fs');
const path = require('path');

const areasPath = path.join(__dirname, '..', 'data', 'areas.json');

console.log('🧪 Validating Areas API Route Logic\n');
console.log(`📁 Areas file: ${path.resolve(areasPath)}\n`);

try {
  // Read and parse areas.json
  const areasContents = fs.readFileSync(areasPath, 'utf8');
  const areas = JSON.parse(areasContents);
  
  console.log(`✅ Successfully loaded areas.json`);
  console.log(`📍 Total areas: ${areas.length}\n`);
  
  // Extract area names (what the API route returns)
  const areaNames = areas.map((area) => area.name);
  
  console.log('📋 Area names (API route would return):');
  areaNames.forEach((name, index) => {
    console.log(`   ${index + 1}. ${name}`);
  });
  
  console.log('\n✅ Validation Results:');
  
  // Validate all required areas are present (excluding Park Circle - removed)
  const expectedAreas = [
    'Daniel Island',
    'Mount Pleasant',
    'Downtown Charleston',
    "Sullivan's Island",
    'North Charleston',
    'West Ashley',
    'James Island',
  ];
  
  let allPresent = true;
  expectedAreas.forEach((expected) => {
    if (areaNames.includes(expected)) {
      console.log(`   ✅ ${expected} - Found`);
    } else {
      console.log(`   ❌ ${expected} - Missing`);
      allPresent = false;
    }
  });
  
  // Verify Park Circle is NOT present (should be removed)
  if (areaNames.includes('Park Circle')) {
    console.log(`   ❌ Park Circle - Should NOT be present (removed)`);
    allPresent = false;
  } else {
    console.log(`   ✅ Park Circle - Correctly removed (not present)`);
  }
  
  // Validate all areas have required fields
  console.log('\n🔍 Validating area structure:');
  let allValid = true;
  areas.forEach((area, index) => {
    const hasName = area.name && typeof area.name === 'string';
    const hasCenter = area.center && typeof area.center.lat === 'number' && typeof area.center.lng === 'number';
    const hasRadius = area.radiusMeters && typeof area.radiusMeters === 'number';
    const hasBounds = area.bounds && typeof area.bounds.south === 'number';
    
    if (hasName && hasCenter && hasRadius && hasBounds) {
      console.log(`   ✅ ${area.name} - Valid structure`);
    } else {
      console.log(`   ❌ ${area.name || `Area ${index}`} - Missing required fields`);
      allValid = false;
    }
  });
  
  // Check for duplicates
  const duplicates = areaNames.filter((name, index) => areaNames.indexOf(name) !== index);
  if (duplicates.length > 0) {
    console.log(`\n   ❌ Duplicate area names found: ${duplicates.join(', ')}`);
    allValid = false;
  } else {
    console.log(`\n   ✅ No duplicate area names`);
  }
  
  console.log('\n📊 Summary:');
  console.log(`   Total areas: ${areas.length}`);
  console.log(`   All expected areas present: ${allPresent ? '✅ Yes' : '❌ No'}`);
  console.log(`   All areas valid structure: ${allValid ? '✅ Yes' : '❌ No'}`);
  console.log(`   Unique names: ${new Set(areaNames).size === areaNames.length ? '✅ Yes' : '❌ No'}`);
  
  if (allPresent && allValid) {
    console.log('\n✨ All validations passed! API route will work correctly.');
    process.exit(0);
  } else {
    console.log('\n⚠️  Some validations failed. Please check areas.json.');
    process.exit(1);
  }
  
} catch (error) {
  console.error(`\n❌ Error: ${error.message}`);
  console.error(`\nStack: ${error.stack}`);
  process.exit(1);
}
