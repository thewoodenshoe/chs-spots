#!/usr/bin/env node
/**
 * Load test: simulates N concurrent users hitting the API.
 * Usage: node scripts/load-test.js [--users 30] [--rounds 5] [--base https://chsfinds.com]
 */

const BASE = process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1]
  : 'https://chsfinds.com';

const USERS = parseInt(
  process.argv.includes('--users')
    ? process.argv[process.argv.indexOf('--users') + 1]
    : '30',
  10
);

const ROUNDS = parseInt(
  process.argv.includes('--rounds')
    ? process.argv[process.argv.indexOf('--rounds') + 1]
    : '5',
  10
);

const ENDPOINTS = [
  { path: '/api/spots', weight: 5 },
  { path: '/api/venues', weight: 3 },
  { path: '/api/activities', weight: 2 },
  { path: '/api/areas', weight: 1 },
  { path: '/api/areas/config', weight: 1 },
  { path: '/api/health', weight: 1 },
];

const stats = {};
for (const ep of ENDPOINTS) {
  stats[ep.path] = { count: 0, total: 0, min: Infinity, max: 0, errors: 0, p95: [] };
}

function pickEndpoint() {
  const totalWeight = ENDPOINTS.reduce((s, e) => s + e.weight, 0);
  let r = Math.random() * totalWeight;
  for (const ep of ENDPOINTS) {
    r -= ep.weight;
    if (r <= 0) return ep.path;
  }
  return ENDPOINTS[0].path;
}

async function hitEndpoint(path) {
  const url = `${BASE}${path}`;
  const start = performance.now();
  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    const elapsed = performance.now() - start;
    const s = stats[path];
    s.count++;
    s.total += elapsed;
    s.min = Math.min(s.min, elapsed);
    s.max = Math.max(s.max, elapsed);
    s.p95.push(elapsed);
    if (!res.ok) s.errors++;
    return { path, elapsed, status: res.status };
  } catch (err) {
    const elapsed = performance.now() - start;
    stats[path].count++;
    stats[path].total += elapsed;
    stats[path].errors++;
    stats[path].p95.push(elapsed);
    return { path, elapsed, status: 0, error: err.message };
  }
}

async function simulateUser(userId, rounds) {
  const results = [];
  for (let r = 0; r < rounds; r++) {
    const path = pickEndpoint();
    const result = await hitEndpoint(path);
    results.push(result);
    await new Promise((ok) => setTimeout(ok, 50 + Math.random() * 200));
  }
  return results;
}

function percentile(arr, pct) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * pct / 100) - 1;
  return sorted[Math.max(0, idx)];
}

async function main() {
  console.log(`\n  Load Test: ${USERS} concurrent users × ${ROUNDS} rounds`);
  console.log(`  Target: ${BASE}\n`);
  console.log('  Starting...\n');

  const totalStart = performance.now();

  const userPromises = [];
  for (let u = 0; u < USERS; u++) {
    userPromises.push(simulateUser(u, ROUNDS));
  }
  const allResults = await Promise.all(userPromises);
  const totalElapsed = performance.now() - totalStart;

  const flat = allResults.flat();
  const totalRequests = flat.length;
  const totalErrors = flat.filter((r) => r.error || r.status >= 500).length;

  console.log('  ┌──────────────────────┬───────┬──────────┬──────────┬──────────┬──────────┬────────┐');
  console.log('  │ Endpoint             │ Reqs  │ Avg (ms) │ Min (ms) │ P95 (ms) │ Max (ms) │ Errors │');
  console.log('  ├──────────────────────┼───────┼──────────┼──────────┼──────────┼──────────┼────────┤');

  for (const ep of ENDPOINTS) {
    const s = stats[ep.path];
    if (s.count === 0) continue;
    const avg = (s.total / s.count).toFixed(0);
    const min = s.min === Infinity ? '-' : s.min.toFixed(0);
    const max = s.max.toFixed(0);
    const p95 = percentile(s.p95, 95).toFixed(0);
    const name = ep.path.padEnd(20);
    console.log(
      `  │ ${name} │ ${String(s.count).padStart(5)} │ ${String(avg).padStart(8)} │ ${String(min).padStart(8)} │ ${String(p95).padStart(8)} │ ${String(max).padStart(8)} │ ${String(s.errors).padStart(6)} │`
    );
  }

  console.log('  └──────────────────────┴───────┴──────────┴──────────┴──────────┴──────────┴────────┘');

  const allTimes = flat.map((r) => r.elapsed);
  console.log(`\n  Summary:`);
  console.log(`    Total requests:  ${totalRequests}`);
  console.log(`    Total errors:    ${totalErrors}`);
  console.log(`    Total time:      ${(totalElapsed / 1000).toFixed(1)}s`);
  console.log(`    Throughput:      ${(totalRequests / (totalElapsed / 1000)).toFixed(1)} req/s`);
  console.log(`    Overall avg:     ${(allTimes.reduce((a, b) => a + b, 0) / allTimes.length).toFixed(0)}ms`);
  console.log(`    Overall P95:     ${percentile(allTimes, 95).toFixed(0)}ms`);
  console.log(`    Overall P99:     ${percentile(allTimes, 99).toFixed(0)}ms`);
  console.log(`    Overall max:     ${Math.max(...allTimes).toFixed(0)}ms`);
  console.log('');

  if (percentile(allTimes, 95) > 2000) {
    console.log('  ⚠  P95 > 2s — caching recommended');
  } else if (percentile(allTimes, 95) > 500) {
    console.log('  ⚠  P95 > 500ms — consider caching hot paths');
  } else {
    console.log('  ✓  Response times look healthy');
  }
  console.log('');
}

main().catch(console.error);
