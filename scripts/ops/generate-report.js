#!/usr/bin/env node

/**
 * generate-report.js
 *
 * Comprehensive CHS Finds daily report with:
 *   - Per-day and per-month visitor/pageview stats
 *   - Unique visitors (24h, 7d, 30d)
 *   - Top 5 returning visitors (session count)
 *   - All sessions from last 24h with device, browser, OS, duration
 *   - Most popular features (activity filters, area views, events)
 *   - ETL pipeline info (duration, LLM calls, new/updated spots)
 *
 * Usage:
 *   node scripts/ops/generate-report.js [--send-telegram] [--report-dir /var/www/reports]
 *
 * Environment variables:
 *   UMAMI_API_URL      – Umami base URL  (default: http://127.0.0.1:3001)
 *   UMAMI_USERNAME     – Umami admin user (default: admin)
 *   UMAMI_PASSWORD     – Umami admin pass (default: umami)
 *   UMAMI_WEBSITE_ID   – Website ID to query
 *   TELEGRAM_BOT_TOKEN
 *   TELEGRAM_ADMIN_CHAT_ID
 *   SERVER_PUBLIC_URL  – e.g. https://chsfinds.com
 */

const fs = require('fs');
const path = require('path');
const { dataPath, reportingPath, configPath } = require('../utils/data-dir');

// ── CLI args ────────────────────────────────────────────────────
const args = process.argv.slice(2);
const sendTelegram = args.includes('--send-telegram');
const reportDirArg = args.find((_, i, a) => a[i - 1] === '--report-dir');
const REPORT_DIR = reportDirArg || process.env.REPORT_DIR || '/var/www/reports';

// ── Config ──────────────────────────────────────────────────────
const UMAMI_API = process.env.UMAMI_API_URL || 'http://127.0.0.1:3001';
const UMAMI_USER = process.env.UMAMI_USERNAME || 'admin';
const UMAMI_PASS = process.env.UMAMI_PASSWORD || 'umami';
const WEBSITE_ID = process.env.UMAMI_WEBSITE_ID || process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID || '';
const SERVER_URL = process.env.SERVER_PUBLIC_URL || '';

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT = process.env.TELEGRAM_ADMIN_CHAT_ID || '';

// ── Helpers ─────────────────────────────────────────────────────
async function umamiLogin() {
  const res = await fetch(`${UMAMI_API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: UMAMI_USER, password: UMAMI_PASS }),
  });
  if (!res.ok) throw new Error(`Umami login failed: ${res.status}`);
  const data = await res.json();
  return data.token;
}

async function umamiGet(token, endpoint) {
  const url = `${UMAMI_API}/api/websites/${WEBSITE_ID}${endpoint}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    console.warn(`  Umami GET ${endpoint} → ${res.status}`);
    return null;
  }
  return res.json();
}

function dateStr(d) { return d.toISOString().split('T')[0]; }
function estNow() { return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })); }
function fmtDuration(ms) {
  if (!ms || ms < 0) return '–';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
function toEST(isoStr) {
  if (!isoStr) return '–';
  try {
    return new Date(isoStr).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  } catch { return isoStr; }
}
function fmtSessionDuration(totaltime) {
  // totaltime from Umami is in seconds
  if (!totaltime || totaltime <= 0) return '< 1s';
  if (totaltime < 60) return `${totaltime}s`;
  const m = Math.floor(totaltime / 60);
  if (m < 60) return `${m}m ${totaltime % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// ── Fetch all sessions (paginated) ──────────────────────────────
async function fetchAllSessions(token, startAt, endAt) {
  const all = [];
  let page = 1;
  const pageSize = 100;
  while (true) {
    const data = await umamiGet(token, `/sessions?startAt=${startAt}&endAt=${endAt}&page=${page}&pageSize=${pageSize}`);
    if (!data || !data.data || data.data.length === 0) break;
    all.push(...data.data);
    if (all.length >= (data.count || 0)) break;
    page++;
    if (page > 50) break; // safety
  }
  return all;
}

// ── Collect pipeline data ───────────────────────────────────────
function getPipelineData() {
  const appDir = path.resolve(__dirname, '../..');
  const result = {
    llmModel: 'unknown',
    totalSpots: 0,
    spotsByArea: {},
    spotsByActivity: {},
    lastPipelineRun: null,
    pipelineDuration: null,
    pipelineSteps: null,
    llmCallCount: null,
    newSpots: [],
    updatedSpots: [],
    updateStreaks: {},
  };

  // Read LLM model
  try {
    const src = fs.readFileSync(path.join(appDir, 'scripts/extract-promotions.js'), 'utf8');
    const m = src.match(/GROK_MODEL\s*=\s*['"]([^'"]+)['"]/);
    if (m) result.llmModel = m[1];
  } catch { /* ignore */ }

  // Read spots
  try {
    const spotsPath = reportingPath('spots.json');
    if (fs.existsSync(spotsPath)) {
      const spots = JSON.parse(fs.readFileSync(spotsPath, 'utf8'));
      result.totalSpots = spots.length;
      for (const spot of spots) {
        const area = spot.area || 'Unknown';
        const activity = spot.type || spot.activityType || 'Unknown';
        result.spotsByArea[area] = (result.spotsByArea[area] || 0) + 1;
        result.spotsByActivity[activity] = (result.spotsByActivity[activity] || 0) + 1;
      }
    }
  } catch { /* ignore */ }

  // Read latest pipeline manifest
  try {
    const manifestDir = path.join(appDir, 'logs/pipeline-manifests');
    if (fs.existsSync(manifestDir)) {
      const files = fs.readdirSync(manifestDir).filter(f => f.endsWith('.json')).sort().reverse();
      if (files.length > 0) {
        const manifest = JSON.parse(fs.readFileSync(path.join(manifestDir, files[0]), 'utf8'));
        result.lastPipelineRun = manifest.startedAt || files[0].replace('.json', '');
        result.pipelineSteps = manifest.steps || null;
        result.pipelineAreaFilter = manifest.areaFilter || null;
        if (manifest.startedAt && manifest.finishedAt) {
          result.pipelineDuration = new Date(manifest.finishedAt).getTime() - new Date(manifest.startedAt).getTime();
        }
      }
    }
  } catch { /* ignore */ }

  // Parse nightly pipeline log for skip reasons and stats
  result.pipelineSkipReasons = [];
  result.pipelineVenuesDownloaded = null;
  result.pipelineVenuesProcessed = null;
  // Delta/normalization stats
  result.deltaNew = null;
  result.deltaChanged = null;
  result.deltaUnchanged = null;
  result.deltaFiltered = null;
  result.deltaForLLM = null;
  // LLM processing results
  result.llmProcessed = null;
  result.llmSkipped = null;
  result.llmErrors = null;
  result.llmFoundPromotions = null;
  result.llmNoPromotions = null;
  // Limit info
  result.maxIncrementalFiles = null;
  result.limitHit = false;
  // Archive info
  result.archiveDays = null;
  result.archiveSizeMB = null;
  // Read pipeline config status
  try {
    const configFilePath = configPath('config.json');
    if (fs.existsSync(configFilePath)) {
      const cfg = JSON.parse(fs.readFileSync(configFilePath, 'utf8'));
      result.configStatus = cfg.last_run_status || 'unknown';
      if (cfg.pipeline?.maxIncrementalFiles && !result.maxIncrementalFiles) {
        result.maxIncrementalFiles = cfg.pipeline.maxIncrementalFiles;
      }
    }
  } catch { /* ignore */ }

  try {
    // Search BOTH log directories: logs/ops/ (nightly wrapper) and logs/ (pipeline's own)
    const candidates = [];
    const opsDir = path.join(appDir, 'logs/ops');
    if (fs.existsSync(opsDir)) {
      candidates.push(...fs.readdirSync(opsDir)
        .filter(f => f.startsWith('nightly-pipeline'))
        .map(f => {
          const fp = path.join(opsDir, f);
          return { path: fp, name: f, mtime: fs.statSync(fp).mtimeMs };
        }));
    }
    const logsDir = path.join(appDir, 'logs');
    if (fs.existsSync(logsDir)) {
      candidates.push(...fs.readdirSync(logsDir)
        .filter(f => f.startsWith('pipeline-run'))
        .map(f => {
          const fp = path.join(logsDir, f);
          return { path: fp, name: f, mtime: fs.statSync(fp).mtimeMs };
        }));
    }
    // Sort by modification time descending (most recent first)
    candidates.sort((a, b) => b.mtime - a.mtime);
    if (candidates.length > 0) {
      const logContent = fs.readFileSync(candidates[0].path, 'utf8');

        // LLM calls — count "Successfully processed" lines
        const processedMatches = logContent.match(/Successfully processed/g);
        if (processedMatches) {
          result.llmCallCount = processedMatches.length;
          result.llmProcessed = processedMatches.length;
        }
        // Skipped (unchanged hash)
        const skippedMatches = logContent.match(/Skipping\b.*?\b(?:No meaningful changes|No changes|hash match|unchanged)/gi);
        if (skippedMatches) result.llmSkipped = skippedMatches.length;
        // Errors
        const errorMatches = logContent.match(/Error calling Grok|Error processing:|LLM .* error|API error/gi);
        if (errorMatches) result.llmErrors = errorMatches.length;

        // Venues downloaded / processed
        const filteredMatch = logContent.match(/Filtered to (\d+) venue/);
        if (filteredMatch) result.pipelineVenuesProcessed = parseInt(filteredMatch[1]);
        const processingMatch = logContent.match(/Processing (\d+) venue/);
        if (processingMatch) result.pipelineVenuesDownloaded = parseInt(processingMatch[1]);
        const successMatch = logContent.match(/Successful: (\d+)/);
        if (successMatch) result.pipelineVenuesDownloaded = parseInt(successMatch[1]);

        // Delta stats from delta-trimmed-files output
        // Log lines have emoji prefixes like "✨ New venues: 3" and may be wrapped in [LOG]
        const dnew = logContent.match(/New venues:\s*(\d+)/);
        if (dnew) result.deltaNew = parseInt(dnew[1]);
        const dchanged = logContent.match(/Changed venues:\s*(\d+)/);
        if (dchanged) result.deltaChanged = parseInt(dchanged[1]);
        const dunchanged = logContent.match(/Unchanged venues:\s*(\d+)/);
        if (dunchanged) result.deltaUnchanged = parseInt(dunchanged[1]);
        const dfiltered = logContent.match(/Below threshold.*?:\s*(\d+)/);
        if (dfiltered) result.deltaFiltered = parseInt(dfiltered[1]);
        const dforllm = logContent.match(/Total files ready for LLM:\s*(\d+)/);
        if (dforllm) result.deltaForLLM = parseInt(dforllm[1]);

        // maxIncrementalFiles limit
        const limitMatch = logContent.match(/Too many incremental files \((\d+) > (\d+)\)/);
        if (limitMatch) {
          result.limitHit = true;
          result.maxIncrementalFiles = parseInt(limitMatch[2]);
          result.pipelineSkipReasons.push(`LLM limit hit: ${limitMatch[1]} files > ${limitMatch[2]} max. LLM extraction skipped.`);
        }
        const limitSet = logContent.match(/maxIncrementalFiles=(\d+)/);
        if (limitSet && !result.maxIncrementalFiles) result.maxIncrementalFiles = parseInt(limitSet[1]);

        // Skip reasons
        if (logContent.includes('No incremental changes detected')) {
          result.pipelineSkipReasons.push('No content changes detected — LLM extraction and spot creation skipped');
        }
        if (logContent.includes('Filtered to 0 venue')) {
          const filterMatch = logContent.match(/Filtering by area: (.+)/);
          const filterName = filterMatch ? filterMatch[1].trim() : 'unknown';
          result.pipelineSkipReasons.push(`Area filter "${filterName}" matched 0 venues — nothing downloaded`);
        }
        if (logContent.includes('No files found in') || logContent.includes('folder is empty')) {
          result.pipelineSkipReasons.push('Input folder was empty — downstream steps had nothing to process');
        }
        if (logContent.includes('skipping LLM extraction entirely')) {
          result.pipelineSkipReasons.push('LLM extraction skipped (no new/changed content)');
        }
        if (logContent.includes('skipping spot creation')) {
          result.pipelineSkipReasons.push('Spot creation skipped (no new happy hours to process)');
        }
        // Pipeline failure
        if (logContent.includes('Pipeline FAILED') || logContent.includes('Fatal error')) {
          result.pipelineSkipReasons.push('Pipeline encountered an error — check logs');
        }
        // Deduplicate
        result.pipelineSkipReasons = [...new Set(result.pipelineSkipReasons)];
    }
  } catch { /* ignore */ }

  // Download error stats
  result.downloadErrors = 0;
  result.downloadErrorsByType = {};
  result.topFailedVenues = [];
  try {
    const dlLogPath = path.join(appDir, 'logs/download-raw-html.log');
    if (fs.existsSync(dlLogPath)) {
      const dlLog = fs.readFileSync(dlLogPath, 'utf8');
      const errorLines = dlLog.match(/❌.*|Error.*downloading.*|Failed.*|timeout.*|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|HTTP\s+\d{3}/gim) || [];
      result.downloadErrors = errorLines.length;

      const typeCounts = {};
      for (const line of errorLines) {
        let errorType = 'Other';
        if (/timeout|ETIMEDOUT/i.test(line)) errorType = 'Timeout';
        else if (/ECONNREFUSED/i.test(line)) errorType = 'Connection Refused';
        else if (/ENOTFOUND/i.test(line)) errorType = 'DNS Failure';
        else if (/403/i.test(line)) errorType = 'Forbidden (403)';
        else if (/404/i.test(line)) errorType = 'Not Found (404)';
        else if (/5\d{2}/i.test(line)) errorType = 'Server Error (5xx)';
        else if (/SSL|certificate/i.test(line)) errorType = 'SSL Error';
        typeCounts[errorType] = (typeCounts[errorType] || 0) + 1;
      }
      result.downloadErrorsByType = typeCounts;

      // Top failed venues (parse venue names from "Error processing <name>:" lines)
      const venueErrorCounts = {};
      const venueNameMatches = dlLog.matchAll(/Error processing ([^:]+):/gim);
      for (const m of venueNameMatches) {
        const name = m[1].trim();
        if (name) venueErrorCounts[name] = (venueErrorCounts[name] || 0) + 1;
      }
      result.topFailedVenues = Object.entries(venueErrorCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([name, count]) => ({ id: name, count }));
    }
  } catch { /* ignore */ }

  // Venue watchlist stats
  result.watchlistExcluded = 0;
  result.watchlistFlagged = 0;
  result.watchlistFlaggedVenues = [];
  result.watchlistExcludedByArea = {};
  try {
    const watchlistPath = configPath('venue-watchlist.json');
    if (fs.existsSync(watchlistPath)) {
      const wl = JSON.parse(fs.readFileSync(watchlistPath, 'utf8'));
      const venues = wl.venues || {};
      for (const [id, entry] of Object.entries(venues)) {
        if (entry.status === 'excluded') {
          result.watchlistExcluded++;
          const area = entry.area || 'Unknown';
          result.watchlistExcludedByArea[area] = (result.watchlistExcludedByArea[area] || 0) + 1;
        } else if (entry.status === 'flagged') {
          result.watchlistFlagged++;
          let goldStatus = 'unknown';
          try {
            const gp = dataPath('gold', id + '.json');
            if (fs.existsSync(gp)) {
              const g = JSON.parse(fs.readFileSync(gp, 'utf8'));
              const promo = g.promotions || g.happyHour || {};
              goldStatus = promo.found ? 'Has promotions' : 'No promotions';
            }
          } catch { /* ignore */ }
          result.watchlistFlaggedVenues.push({
            name: entry.name || id,
            area: entry.area || 'Unknown',
            reason: entry.reason || '',
            goldStatus
          });
        }
      }
    }
  } catch { /* ignore */ }

  // Archive stats
  try {
    const archiveDirs = [
      dataPath('silver_trimmed', 'archive'),
      dataPath('raw', 'archive'),
    ];
    let maxDays = 0;
    for (const ad of archiveDirs) {
      if (fs.existsSync(ad)) {
        const days = fs.readdirSync(ad).filter(d => /^\d{8}$/.test(d)).length;
        if (days > maxDays) maxDays = days;
      }
    }
    result.archiveDays = maxDays;
  } catch { /* ignore */ }

  // LLM found vs not found from gold files
  try {
    const goldDir = dataPath('gold');
    if (fs.existsSync(goldDir)) {
      const goldFiles = fs.readdirSync(goldDir).filter(f => f.endsWith('.json'));
      let found = 0, notFound = 0;
      for (const gf of goldFiles) {
        try {
          const g = JSON.parse(fs.readFileSync(path.join(goldDir, gf), 'utf8'));
          const promo = g.promotions || g.happyHour || {};
          if (promo.found === true || (promo.entries && promo.entries.length > 0)) found++;
          else notFound++;
        } catch { /* skip corrupt files */ }
      }
      result.llmFoundPromotions = found;
      result.llmNoPromotions = notFound;
    }
  } catch { /* ignore */ }

  // Find updated spots from create-spots log
  try {
    const logPath = path.join(appDir, 'logs/create-spots.log');
    if (fs.existsSync(logPath)) {
      const logContent = fs.readFileSync(logPath, 'utf8');

      // "Updated spot:" lines (content changes detected by create-spots)
      const updatedLines = logContent.match(/Updated spot:\s*.+/g) || [];
      for (const line of updatedLines.slice(0, 40)) {
        const clean = line.replace(/^Updated spot:\s*/, '').trim();
        if (clean) result.updatedSpots.push(clean);
      }

      // Fall back to "Created spot:" lines if no "Updated" lines found
      if (result.updatedSpots.length === 0) {
        const createdLines = logContent.match(/Created spot:\s*.+/g) || [];
        for (const line of createdLines.slice(0, 20)) {
          const clean = line.replace(/^Created spot:\s*/, '').trim();
          if (clean) result.newSpots.push(clean);
        }
      }
    }
  } catch { /* ignore */ }

  // Read update streaks
  try {
    const streaksPath = reportingPath('update-streaks.json');
    if (fs.existsSync(streaksPath)) {
      result.updateStreaks = JSON.parse(fs.readFileSync(streaksPath, 'utf8'));
    }
  } catch { /* ignore */ }

  return result;
}

// ── Build HTML report ───────────────────────────────────────────
function buildHtml(data) {
  const now = estNow();
  const reportDate = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const reportTime = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });

  const { analytics, pipeline } = data;
  const sv = (obj, key) => (obj && typeof obj[key] === 'number' ? obj[key] : (obj?.[key]?.value ?? '–'));

  // ── Section: Summary cards ──
  const summaryHtml = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${sv(analytics.stats24h, 'visitors')}</div>
        <div class="stat-label">Visitors (24h)</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${sv(analytics.stats24h, 'pageviews')}</div>
        <div class="stat-label">Pageviews (24h)</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${sv(analytics.stats7d, 'visitors')}</div>
        <div class="stat-label">Visitors (7d)</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${sv(analytics.stats30d, 'visitors')}</div>
        <div class="stat-label">Visitors (30d)</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${sv(analytics.stats30d, 'pageviews')}</div>
        <div class="stat-label">Pageviews (30d)</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${sv(analytics.stats24h, 'visits')}</div>
        <div class="stat-label">Sessions (24h)</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${sv(analytics.stats24h, 'bounces')}</div>
        <div class="stat-label">Bounces (24h)</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${analytics.activeNow ?? '–'}</div>
        <div class="stat-label">Active Now</div>
      </div>
    </div>`;

  // ── Section: Daily breakdown (last 14 days) ──
  const dailyRows = (analytics.dailyPageviews || [])
    .map((pv, i) => {
      const sessions = analytics.dailySessions?.[i];
      const date = pv.x ? new Date(pv.x).toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'short' }) : '–';
      return `<tr><td>${date}</td><td>${pv.y ?? '–'}</td><td>${sessions?.y ?? '–'}</td></tr>`;
    }).join('');

  const dailyHtml = dailyRows
    ? `<table><tr><th>Date</th><th>Pageviews</th><th>Sessions</th></tr>${dailyRows}</table>`
    : '<p class="muted">No daily data available.</p>';

  // ── Section: Monthly breakdown ──
  const monthlyRows = (analytics.monthlyPageviews || [])
    .map((pv, i) => {
      const sessions = analytics.monthlySessions?.[i];
      const date = pv.x ? new Date(pv.x).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '–';
      return `<tr><td>${date}</td><td>${pv.y ?? '–'}</td><td>${sessions?.y ?? '–'}</td></tr>`;
    }).join('');

  const monthlyHtml = monthlyRows
    ? `<table><tr><th>Month</th><th>Pageviews</th><th>Sessions</th></tr>${monthlyRows}</table>`
    : '<p class="muted">No monthly data available.</p>';

  // ── Section: Top 5 returning visitors ──
  // Group sessions by visitor fingerprint (same browser+os+device+screen+language+country = likely same person)
  const visitorMap = {};
  for (const s of analytics.allSessions30d || []) {
    // Create a fingerprint from stable attributes
    const fp = `${s.browser}|${s.os}|${s.device}|${s.screen}|${s.language}|${s.country}`;
    if (!visitorMap[fp]) {
      visitorMap[fp] = { browser: s.browser, os: s.os, device: s.device, country: s.country, totalVisits: 0, totalViews: 0, sessions: [] };
    }
    visitorMap[fp].totalVisits += (s.visits || 1);
    visitorMap[fp].totalViews += (s.views || 0);
    visitorMap[fp].sessions.push(s);
  }
  const topReturning = Object.values(visitorMap)
    .sort((a, b) => b.totalVisits - a.totalVisits)
    .slice(0, 5);

  const returningHtml = topReturning.length > 0
    ? `<table><tr><th>#</th><th>Device</th><th>Browser / OS</th><th>Country</th><th>Visits</th><th>Views</th><th>Sessions</th></tr>
       ${topReturning.map((v, i) => `<tr><td>${i + 1}</td><td>${v.device}</td><td>${v.browser} / ${v.os}</td><td>${v.country || '–'}</td><td>${v.totalVisits}</td><td>${v.totalViews}</td><td>${v.sessions.length}</td></tr>`).join('')}
       </table>`
    : '<p class="muted">No returning visitor data yet.</p>';

  // ── Section: All sessions last 24h ──
  const sessions24h = (analytics.sessions24h || []).sort((a, b) => new Date(b.lastAt || b.createdAt) - new Date(a.lastAt || a.createdAt));
  const sessionsHtml = sessions24h.length > 0
    ? `<table class="small-table">
        <tr><th>Time</th><th>Device</th><th>Browser</th><th>OS</th><th>Country</th><th>Views</th><th>Duration</th></tr>
        ${sessions24h.map(s => {
          const time = s.lastAt ? new Date(s.lastAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York', hour12: true }) + ' EST' : '–';
          const dur = s.totaltime ? fmtSessionDuration(s.totaltime) : (s.lastAt && s.firstAt ? fmtDuration(new Date(s.lastAt) - new Date(s.firstAt)) : '–');
          return `<tr><td>${time}</td><td>${s.device || '–'}</td><td>${s.browser || '–'}</td><td>${s.os || '–'}</td><td>${s.country || '–'}</td><td>${s.views || '–'}</td><td>${dur}</td></tr>`;
        }).join('')}
       </table>`
    : '<p class="muted">No sessions in the last 24 hours.</p>';

  // ── Section: Popular features (events) ──
  const eventRows = (analytics.topEvents || [])
    .map(e => `<tr><td>${e.x || e.eventName || '–'}</td><td>${e.y ?? '–'}</td></tr>`)
    .join('');
  const eventsHtml = eventRows
    ? `<table><tr><th>Event</th><th>Count (7d)</th></tr>${eventRows}</table>`
    : '<p class="muted">No custom events recorded yet.</p>';

  // ── Section: Top pages ──
  const pageRows = (analytics.topPages || [])
    .slice(0, 10)
    .map(p => `<tr><td>${p.x || '–'}</td><td>${p.y ?? '–'}</td></tr>`)
    .join('');
  const pagesHtml = pageRows
    ? `<table><tr><th>Page</th><th>Views (7d)</th></tr>${pageRows}</table>`
    : '';

  // ── Section: Device breakdown ──
  const deviceRows = (analytics.devices || [])
    .map(d => `<tr><td>${d.x || '–'}</td><td>${d.y ?? '–'}</td></tr>`)
    .join('');
  const devicesHtml = deviceRows
    ? `<table><tr><th>Device</th><th>Visitors (7d)</th></tr>${deviceRows}</table>`
    : '';

  // ── Section: Spots breakdown ──
  const areaRows = Object.entries(pipeline.spotsByArea)
    .sort(([, a], [, b]) => b - a)
    .map(([area, count]) => `<tr><td>${area}</td><td>${count}</td></tr>`)
    .join('');

  const activityRows = Object.entries(pipeline.spotsByActivity)
    .sort(([, a], [, b]) => b - a)
    .map(([activity, count]) => `<tr><td>${activity}</td><td>${count}</td></tr>`)
    .join('');

  // ── Section: ETL Pipeline ──
  const stepsHtml = (pipeline.pipelineSteps && typeof pipeline.pipelineSteps === 'object')
    ? Object.entries(pipeline.pipelineSteps).map(([name, step]) => {
        if (!step || typeof step !== 'object') return '';
        const status = step.status || '–';
        const badge = status === 'completed' ? 'badge-ok' : status === 'skipped' ? 'badge-skip' : status === 'failed' ? 'badge-fail' : 'badge-pending';
        let dur = '–';
        if (step.startedAt && step.finishedAt) {
          try { dur = fmtDuration(new Date(step.finishedAt) - new Date(step.startedAt)); } catch { /* ignore */ }
        }
        const startEST = step.startedAt ? toEST(step.startedAt) : '–';
        return `<tr><td>${name}</td><td><span class="badge ${badge}">${status}</span></td><td>${dur}</td><td>${startEST}</td></tr>`;
      }).join('')
    : '';

  const skipReasonsHtml = (pipeline.pipelineSkipReasons || []).length > 0
    ? `<div class="skip-reasons"><strong>Skip reasons:</strong><ul>${pipeline.pipelineSkipReasons.map(r => `<li>${r}</li>`).join('')}</ul></div>`
    : '';

  // Build updated-spots table with streak column, sorted by streak desc
  const streakMap = pipeline.updateStreaks || {};
  const streakByName = {};
  for (const [, v] of Object.entries(streakMap)) {
    if (v && v.name) streakByName[v.name] = v.streak || 1;
  }
  const updatedList = pipeline.updatedSpots.length > 0 ? pipeline.updatedSpots : pipeline.newSpots;
  const sortedUpdated = [...updatedList].sort((a, b) => (streakByName[b] || 1) - (streakByName[a] || 1));

  const updatedSpotsHtml = sortedUpdated.length > 0
    ? `<table><tr><th>#</th><th>Spot</th><th>Streak (days)</th></tr>
       ${sortedUpdated.slice(0, 30).map((s, i) => {
         const streak = streakByName[s] || 1;
         const streakIcon = streak >= 5 ? '🔥' : streak >= 3 ? '📈' : '';
         return `<tr><td>${i + 1}</td><td>${s}</td><td>${streakIcon} ${streak}d</td></tr>`;
       }).join('')}</table>`
    : '<p class="muted">No updated spots in last run.</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CHS Finds – Daily Report – ${dateStr(new Date())}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; color: #1e293b; padding: 16px; max-width: 700px; margin: 0 auto; }
  h1 { font-size: 1.4rem; color: #0d9488; margin-bottom: 4px; }
  h2 { font-size: 1.1rem; color: #334155; margin: 24px 0 8px; border-bottom: 2px solid #e2e8f0; padding-bottom: 4px; }
  h3 { font-size: 0.95rem; color: #475569; margin: 16px 0 6px; }
  .subtitle { font-size: 0.85rem; color: #64748b; margin-bottom: 16px; }
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; margin: 10px 0; }
  .stat-card { background: #fff; border-radius: 10px; padding: 14px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .stat-value { font-size: 1.5rem; font-weight: 700; color: #0d9488; }
  .stat-label { font-size: 0.72rem; color: #64748b; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 0.82rem; }
  th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #e2e8f0; }
  th { background: #f1f5f9; font-weight: 600; }
  .small-table { font-size: 0.75rem; }
  .small-table th, .small-table td { padding: 3px 6px; }
  .muted { color: #94a3b8; font-style: italic; font-size: 0.82rem; margin: 4px 0; }
  .badge { display: inline-block; font-size: 0.7rem; padding: 1px 8px; border-radius: 9999px; font-weight: 600; }
  .badge-ok { background: #d1fae5; color: #065f46; }
  .badge-skip { background: #e0e7ff; color: #3730a3; }
  .badge-fail { background: #fee2e2; color: #991b1b; }
  .badge-pending { background: #fef3c7; color: #92400e; }
  .model-info { background: #fff; border-radius: 10px; padding: 12px; margin: 8px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.08); font-size: 0.85rem; }
  .model-info strong { color: #0d9488; }
  .skip-reasons { background: #fef3c7; border-radius: 8px; padding: 10px 14px; margin: 8px 0; font-size: 0.82rem; }
  .skip-reasons ul { margin: 4px 0 0 18px; }
  .skip-reasons li { margin-bottom: 2px; color: #92400e; }
  .spot-list { margin: 6px 0 6px 20px; font-size: 0.82rem; }
  .spot-list li { margin-bottom: 2px; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 500px) { .two-col { grid-template-columns: 1fr; } }
  footer { margin-top: 28px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 0.72rem; color: #94a3b8; text-align: center; }
</style>
</head>
<body>

<h1>CHS Finds Daily Report</h1>
<p class="subtitle">${reportDate} at ${reportTime} EST</p>

<h2>Overview</h2>
${summaryHtml}

<h2>Daily Breakdown (Last 14 Days)</h2>
${dailyHtml}

<h2>Monthly Breakdown</h2>
${monthlyHtml}

<h2>Top 5 Returning Visitors (30 Days)</h2>
${returningHtml}

<h2>All Sessions – Last 24 Hours</h2>
<p class="muted">${sessions24h.length} session(s)</p>
${sessionsHtml}

<h2>Popular Features & Events (7 Days)</h2>
${eventsHtml}
${pagesHtml ? '<h3>Top Pages</h3>' + pagesHtml : ''}

<h2>Device Breakdown (7 Days)</h2>
${devicesHtml}

<div class="two-col">
  <div>
    <h2>Spots by Area</h2>
    <p class="muted">Total: <strong>${pipeline.totalSpots}</strong></p>
    ${areaRows ? `<table><tr><th>Area</th><th>#</th></tr>${areaRows}</table>` : ''}
  </div>
  <div>
    <h2>Spots by Activity</h2>
    ${activityRows ? `<table><tr><th>Activity</th><th>#</th></tr>${activityRows}</table>` : ''}
  </div>
</div>

<h2>ETL Pipeline</h2>
<div class="model-info">
  <p>Last run: <strong>${pipeline.lastPipelineRun ? toEST(pipeline.lastPipelineRun) + ' EST' : '–'}</strong></p>
  <p>Duration: <strong>${pipeline.pipelineDuration ? fmtDuration(pipeline.pipelineDuration) : '–'}</strong></p>
  <p>LLM model: <strong>${pipeline.llmModel}</strong></p>
  ${pipeline.pipelineAreaFilter ? `<p>Area filter: <strong>${pipeline.pipelineAreaFilter}</strong> <span style="color:#dc2626;">(may have filtered out venues!)</span></p>` : ''}
  ${pipeline.configStatus ? `<p>Pipeline status: <strong>${pipeline.configStatus}</strong>${pipeline.configStatus.startsWith('failed') ? ' <span class="badge badge-fail">FAILED</span>' : pipeline.configStatus === 'completed_successfully' ? ' <span class="badge badge-ok">OK</span>' : ''}</p>` : ''}
  ${pipeline.maxIncrementalFiles != null ? `<p>LLM file limit: <strong>${pipeline.maxIncrementalFiles}</strong>${pipeline.limitHit ? ' <span class="badge badge-fail">LIMIT HIT</span>' : ''}</p>` : ''}
  ${pipeline.archiveDays != null ? `<p>Archive history: <strong>${pipeline.archiveDays} day(s)</strong> retained</p>` : ''}
</div>
${skipReasonsHtml}

<h3>Content Delta</h3>
<div class="stats-grid">
  <div class="stat-card">
    <div class="stat-value">${pipeline.deltaNew ?? '–'}</div>
    <div class="stat-label">New Venues</div>
  </div>
  <div class="stat-card">
    <div class="stat-value">${pipeline.deltaChanged ?? '–'}</div>
    <div class="stat-label">Changed</div>
  </div>
  <div class="stat-card">
    <div class="stat-value">${pipeline.deltaFiltered ?? '–'}</div>
    <div class="stat-label">Noise Filtered</div>
  </div>
  <div class="stat-card">
    <div class="stat-value">${pipeline.deltaUnchanged ?? '–'}</div>
    <div class="stat-label">Unchanged</div>
  </div>
  <div class="stat-card">
    <div class="stat-value">${pipeline.deltaForLLM ?? '–'}</div>
    <div class="stat-label">Sent to LLM</div>
  </div>
</div>

<h3>Download Health</h3>
<div class="stats-grid">
  <div class="stat-card">
    <div class="stat-value">${pipeline.pipelineVenuesDownloaded ?? '–'}</div>
    <div class="stat-label">Venues Downloaded</div>
  </div>
  <div class="stat-card">
    <div class="stat-value">${pipeline.downloadErrors ?? 0}</div>
    <div class="stat-label">Download Errors</div>
  </div>
</div>
${Object.keys(pipeline.downloadErrorsByType || {}).length > 0 ? `<table><tr><th>Error Type</th><th>Count</th></tr>${Object.entries(pipeline.downloadErrorsByType).sort(([,a],[,b]) => b - a).map(([type, count]) => `<tr><td>${type}</td><td>${count}</td></tr>`).join('')}</table>` : ''}
${(pipeline.topFailedVenues || []).length > 0 ? `<p style="font-size:0.8rem;color:#64748b;margin-top:6px;">Top failing venues: ${pipeline.topFailedVenues.map(v => `${v.id} (${v.count}x)`).join(', ')}</p>` : ''}

<h3>LLM Processing</h3>
<div class="stats-grid">
  <div class="stat-card">
    <div class="stat-value">${pipeline.llmProcessed ?? pipeline.llmCallCount ?? '–'}</div>
    <div class="stat-label">LLM Calls</div>
  </div>
  <div class="stat-card">
    <div class="stat-value">${pipeline.llmSkipped ?? '–'}</div>
    <div class="stat-label">Skipped (unchanged)</div>
  </div>
  <div class="stat-card">
    <div class="stat-value">${pipeline.llmErrors ?? 0}</div>
    <div class="stat-label">Errors</div>
  </div>
  <div class="stat-card">
    <div class="stat-value">${pipeline.llmFoundPromotions ?? '–'}</div>
    <div class="stat-label">With Promotions</div>
  </div>
  <div class="stat-card">
    <div class="stat-value">${pipeline.llmNoPromotions ?? '–'}</div>
    <div class="stat-label">No Promotions</div>
  </div>
</div>

<h3>Venue Watchlist${pipeline.watchlistFlagged > 0 ? ' <span class="badge badge-fail" style="font-size:0.75rem;vertical-align:middle;">ACTION NEEDED</span>' : ''}</h3>
<div class="stats-grid">
  <div class="stat-card">
    <div class="stat-value">${pipeline.watchlistExcluded}</div>
    <div class="stat-label">Excluded</div>
  </div>
  <div class="stat-card"${pipeline.watchlistFlagged > 0 ? ' style="border:2px solid #dc2626;background:#fef2f2;"' : ''}>
    <div class="stat-value" ${pipeline.watchlistFlagged > 0 ? 'style="color:#dc2626;"' : ''}>${pipeline.watchlistFlagged > 0 ? '⚠️ ' : ''}${pipeline.watchlistFlagged}</div>
    <div class="stat-label">Flagged for Review</div>
  </div>
</div>
${pipeline.watchlistFlagged > 0 ? `<table><tr><th></th><th>Venue</th><th>Area</th><th>Reason</th><th>Gold Status</th></tr>${(pipeline.watchlistFlaggedVenues || []).map(v => `<tr><td style="font-size:1.1rem;text-align:center;">⚠️</td><td><strong>${v.name}</strong></td><td>${v.area}</td><td style="font-size:0.75rem;">${v.reason}</td><td><span class="badge ${v.goldStatus === 'Has promotions' ? 'badge-ok' : 'badge-fail'}">${v.goldStatus}</span></td></tr>`).join('')}</table>` : ''}
${Object.keys(pipeline.watchlistExcludedByArea || {}).length > 0 ? `<p style="font-size:0.78rem;color:#64748b;margin-top:6px;">Excluded by area: ${Object.entries(pipeline.watchlistExcludedByArea).sort(([,a],[,b]) => b - a).map(([area, count]) => `${area} (${count})`).join(', ')}</p>` : ''}

${stepsHtml ? `<h3>Pipeline Steps</h3><table><tr><th>Step</th><th>Status</th><th>Duration</th><th>Started (EST)</th></tr>${stepsHtml}</table>` : ''}

<h3>Updated Spots</h3>
${updatedSpotsHtml}

<footer>Auto-generated by CHS Finds analytics &bull; ${new Date().toISOString()}</footer>
</body>
</html>`;
}

// ── Main ────────────────────────────────────────────────────────
async function main() {
  console.log('📊 Generating CHS Finds report...');

  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);

  const analytics = {
    stats24h: null, stats7d: null, stats30d: null,
    activeNow: null,
    dailyPageviews: [], dailySessions: [],
    monthlyPageviews: [], monthlySessions: [],
    sessions24h: [], allSessions30d: [],
    topEvents: [], topPages: [], devices: [],
  };

  // 1. Login to Umami
  let token = null;
  if (WEBSITE_ID) {
    try {
      token = await umamiLogin();
      console.log('  ✓ Umami login OK');
    } catch (err) {
      console.warn('  ✗ Umami login failed:', err.message);
    }
  } else {
    console.warn('  ⚠ No UMAMI_WEBSITE_ID set, skipping analytics');
  }

  // 2. Fetch analytics data
  if (token) {
    // Stats
    const [s24h, s7d, s30d] = await Promise.all([
      umamiGet(token, `/stats?startAt=${oneDayAgo.getTime()}&endAt=${now.getTime()}`),
      umamiGet(token, `/stats?startAt=${oneWeekAgo.getTime()}&endAt=${now.getTime()}`),
      umamiGet(token, `/stats?startAt=${oneMonthAgo.getTime()}&endAt=${now.getTime()}`),
    ]);
    analytics.stats24h = s24h;
    analytics.stats7d = s7d;
    analytics.stats30d = s30d;

    // Active users
    try {
      const active = await umamiGet(token, '/active');
      analytics.activeNow = active?.visitors ?? null;
    } catch { /* ignore */ }

    // Daily pageviews (last 14 days)
    try {
      const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      const daily = await umamiGet(token, `/pageviews?startAt=${twoWeeksAgo.getTime()}&endAt=${now.getTime()}&unit=day&timezone=America/New_York`);
      analytics.dailyPageviews = daily?.pageviews || [];
      analytics.dailySessions = daily?.sessions || [];
    } catch { /* ignore */ }

    // Monthly pageviews (last 6 months)
    try {
      const monthly = await umamiGet(token, `/pageviews?startAt=${sixMonthsAgo.getTime()}&endAt=${now.getTime()}&unit=month&timezone=America/New_York`);
      analytics.monthlyPageviews = monthly?.pageviews || [];
      analytics.monthlySessions = monthly?.sessions || [];
    } catch { /* ignore */ }

    // Sessions (last 24h — detailed)
    try {
      analytics.sessions24h = await fetchAllSessions(token, oneDayAgo.getTime(), now.getTime());
    } catch (e) { console.warn('  sessions24h failed:', e.message); }

    // Sessions (last 30d — for returning visitor analysis)
    try {
      analytics.allSessions30d = await fetchAllSessions(token, oneMonthAgo.getTime(), now.getTime());
    } catch (e) { console.warn('  sessions30d failed:', e.message); }

    // Top events (7d)
    try {
      const events = await umamiGet(token, `/metrics?startAt=${oneWeekAgo.getTime()}&endAt=${now.getTime()}&type=event`);
      analytics.topEvents = Array.isArray(events) ? events.sort((a, b) => (b.y || 0) - (a.y || 0)).slice(0, 15) : [];
    } catch { /* ignore */ }

    // Top pages (7d)
    try {
      const pages = await umamiGet(token, `/metrics?startAt=${oneWeekAgo.getTime()}&endAt=${now.getTime()}&type=path`);
      analytics.topPages = Array.isArray(pages) ? pages.sort((a, b) => (b.y || 0) - (a.y || 0)).slice(0, 10) : [];
    } catch { /* ignore */ }

    // Devices (7d)
    try {
      const devices = await umamiGet(token, `/metrics?startAt=${oneWeekAgo.getTime()}&endAt=${now.getTime()}&type=device`);
      analytics.devices = Array.isArray(devices) ? devices : [];
    } catch { /* ignore */ }

    console.log(`  ✓ Analytics fetched (${analytics.sessions24h.length} sessions 24h, ${analytics.allSessions30d.length} sessions 30d)`);
  }

  // 3. Pipeline data
  const pipeline = getPipelineData();
  console.log(`  ✓ Pipeline data: ${pipeline.totalSpots} spots, model: ${pipeline.llmModel}`);

  // 4. Generate HTML
  const html = buildHtml({ analytics, pipeline });

  // 5. Save report
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const today = dateStr(new Date());
  const htmlPath = path.join(REPORT_DIR, `report-${today}.html`);
  fs.writeFileSync(htmlPath, html);
  console.log(`  ✓ HTML saved: ${htmlPath}`);

  // 6. PDF (optional)
  let pdfPath = null;
  try {
    const { chromium } = require('playwright');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    pdfPath = path.join(REPORT_DIR, `report-${today}.pdf`);
    await page.pdf({ path: pdfPath, format: 'A4', printBackground: true, margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' } });
    await browser.close();
    console.log(`  ✓ PDF saved: ${pdfPath}`);
  } catch (err) {
    console.warn(`  ⚠ PDF skipped: ${err.message}`);
  }

  // 7. Telegram
  if (sendTelegram && TELEGRAM_TOKEN && TELEGRAM_CHAT) {
    try {
      const reportUrl = SERVER_URL ? `${SERVER_URL}/reports/report-${today}.html` : `(local) ${htmlPath}`;
      const visitors24h = analytics.stats24h && typeof analytics.stats24h.visitors === 'number' ? analytics.stats24h.visitors : (analytics.stats24h?.visitors?.value ?? '-');
      const pageviews24h = analytics.stats24h && typeof analytics.stats24h.pageviews === 'number' ? analytics.stats24h.pageviews : (analytics.stats24h?.pageviews?.value ?? '-');
      const visitors30d = analytics.stats30d && typeof analytics.stats30d.visitors === 'number' ? analytics.stats30d.visitors : (analytics.stats30d?.visitors?.value ?? '-');
      // Build pipeline status line
      const pipelineStatusParts = [];
      if (pipeline.pipelineDuration) pipelineStatusParts.push(fmtDuration(pipeline.pipelineDuration));
      if (pipeline.configStatus && pipeline.configStatus.startsWith('failed')) pipelineStatusParts.push('FAILED');
      else if (pipeline.limitHit) pipelineStatusParts.push('LIMIT HIT');
      else if (pipeline.pipelineSkipReasons.length > 0) pipelineStatusParts.push('SKIPPED');
      else pipelineStatusParts.push('OK');

      // Build delta line
      const deltaLine = pipeline.deltaChanged != null
        ? `🔍 Delta: ${pipeline.deltaChanged ?? 0} changed, ${pipeline.deltaFiltered ?? 0} filtered, ${pipeline.deltaNew ?? 0} new`
        : null;

      // Build LLM line
      const llmLine = pipeline.llmProcessed != null
        ? `🤖 LLM: ${pipeline.llmProcessed} processed, ${pipeline.llmSkipped ?? 0} skipped, ${pipeline.llmErrors ?? 0} errors`
        : (pipeline.limitHit ? `🤖 LLM: skipped (limit ${pipeline.maxIncrementalFiles})` : null);

      // Download errors line
      const dlErrorLine = pipeline.downloadErrors > 0
        ? `📥 Downloads: ${pipeline.pipelineVenuesDownloaded ?? '?'} OK, ${pipeline.downloadErrors} errors`
        : (pipeline.pipelineVenuesDownloaded ? `📥 Downloads: ${pipeline.pipelineVenuesDownloaded} OK` : null);

      const lines = [
        `📊 CHS Finds Daily Report — ${today}`,
        '',
        `👤 Visitors: ${visitors24h} (24h) | ${visitors30d} (30d)`,
        `📄 Pageviews: ${pageviews24h} (24h)`,
        `🔎 Sessions today: ${analytics.sessions24h.length}`,
        `📍 Total spots: ${pipeline.totalSpots}`,
        '',
        `⚙️ Pipeline: ${pipelineStatusParts.join(' · ')}`,
        dlErrorLine,
        deltaLine,
        llmLine,
        pipeline.updatedSpots.length > 0 ? `🔄 Updated spots: ${pipeline.updatedSpots.length}` : (pipeline.newSpots.length > 0 ? `🔄 Updated spots: ${pipeline.newSpots.length}` : null),
        (pipeline.watchlistExcluded > 0 || pipeline.watchlistFlagged > 0) ? `🚫 Watchlist: ${pipeline.watchlistExcluded} excluded, ${pipeline.watchlistFlagged} flagged` : null,
        pipeline.pipelineSkipReasons.length > 0 ? `⚠️ ${pipeline.pipelineSkipReasons[0]}` : null,
        '',
        `📎 Full report: ${reportUrl}`,
      ].filter(l => l != null);

      const sendRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT, text: lines.join('\n'), disable_web_page_preview: true }),
      });
      const sendData = await sendRes.json();
      if (!sendData.ok) {
        console.warn('  ⚠ Telegram response:', JSON.stringify(sendData));
      }

      // Send PDF if available
      if (pdfPath && fs.existsSync(pdfPath)) {
        const pdfBuffer = fs.readFileSync(pdfPath);
        const boundary = '----FormBoundary' + Date.now().toString(16);
        const fileName = `report-${today}.pdf`;
        const parts = [];
        parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${TELEGRAM_CHAT}`);
        parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\nCHS Finds Report - ${today}`);
        parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${fileName}"\r\nContent-Type: application/pdf\r\n\r\n`);
        const head = Buffer.from(parts.join('\r\n') + '\r\n', 'utf8');
        const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
        const body = Buffer.concat([head, pdfBuffer, tail]);
        await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendDocument`, {
          method: 'POST',
          headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
          body,
        });
      }

      console.log('  ✓ Telegram notification sent');
    } catch (err) {
      console.error('  ✗ Telegram failed:', err.message);
    }
  } else if (sendTelegram) {
    console.warn('  ⚠ Telegram skipped: missing TELEGRAM_BOT_TOKEN or TELEGRAM_ADMIN_CHAT_ID');
  }

  console.log('✅ Report generation complete');
}

main().catch(err => {
  console.error('Report generation failed:', err);
  process.exit(1);
});
