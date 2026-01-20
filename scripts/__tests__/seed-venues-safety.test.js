/**
 * Unit tests for seed-venues.js safety checks
 * Tests that the script requires both --confirm flag and GOOGLE_PLACES_ENABLED=true
 */

const { spawn } = require('child_process');
const path = require('path');

describe('seed-venues.js Safety Checks', () => {
  const scriptPath = path.join(__dirname, '..', 'seed-venues.js');

  test('should exit with error if --confirm flag is missing', (done) => {
    const child = spawn('node', [scriptPath], {
      env: { ...process.env, GOOGLE_PLACES_ENABLED: 'false' }
    });

    let output = '';
    child.stdout.on('data', (data) => {
      output += data.toString();
    });
    child.stderr.on('data', (data) => {
      output += data.toString();
    });

    child.on('close', (code) => {
      expect(code).toBe(1);
      expect(output).toContain('ERROR: This script uses Google Maps API');
      expect(output).toContain('Missing: --confirm flag');
      done();
    });
  });

  test('should exit with error if GOOGLE_PLACES_ENABLED is not true', (done) => {
    const child = spawn('node', [scriptPath, '--confirm'], {
      env: { ...process.env, GOOGLE_PLACES_ENABLED: 'false' }
    });

    let output = '';
    child.stdout.on('data', (data) => {
      output += data.toString();
    });
    child.stderr.on('data', (data) => {
      output += data.toString();
    });

    child.on('close', (code) => {
      expect(code).toBe(1);
      expect(output).toContain('ERROR: This script uses Google Maps API');
      expect(output).toContain('Missing: GOOGLE_PLACES_ENABLED=true');
      done();
    });
  });

  test('should exit with error if both flags are missing', (done) => {
    // Remove GOOGLE_PLACES_ENABLED if it exists from env
    const env = { ...process.env };
    delete env.GOOGLE_PLACES_ENABLED;
    
    const child = spawn('node', [scriptPath], {
      env
    });

    let output = '';
    child.stdout.on('data', (data) => {
      output += data.toString();
    });
    child.stderr.on('data', (data) => {
      output += data.toString();
    });

    child.on('close', (code) => {
      expect(code).toBe(1);
      expect(output).toContain('ERROR: This script uses Google Maps API');
      expect(output).toContain('Missing: --confirm flag');
      expect(output).toContain('Missing: GOOGLE_PLACES_ENABLED=true');
      done();
    });
  });

  test('should exit with error if GOOGLE_PLACES_ENABLED is not exactly "true"', (done) => {
    const child = spawn('node', [scriptPath, '--confirm'], {
      env: { ...process.env, GOOGLE_PLACES_ENABLED: 'True' } // Case sensitive
    });

    let output = '';
    child.stdout.on('data', (data) => {
      output += data.toString();
    });
    child.stderr.on('data', (data) => {
      output += data.toString();
    });

    child.on('close', (code) => {
      expect(code).toBe(1);
      expect(output).toContain('Missing: GOOGLE_PLACES_ENABLED=true');
      done();
    });
  });
});
