#!/usr/bin/env node

/**
 * generate-report.js
 *
 * CHS Finds daily report with three distinct sections:
 *   Page 1 — Actions Needed: items requiring human review/decision
 *   Page 2 — ETL / Technical: pipeline status, content delta, LLM processing
 *   Page 3 — User Analytics: unique users, engagement, behavior
 *
 * Usage:
 *   node scripts/ops/generate-report.js [--send-telegram] [--report-dir /var/www/reports]
 */

const fs = require('fs');
const path = require('path');
const { dataPath, reportingPath, configPath } = require('../utils/data-dir');
const db = require('../utils/db');

// ── CLI args ────────────────────────────────────────────────────
const args = process.argv.slice(2);
const sendTelegram = args.includes('--send-telegram');
const reportDirArg = args.find((_, i, a) => a[i - 1] === '--report-dir');
const REPORT_DIR = reportDirArg || process.env.REPORT_DIR || '/var/www/reports';

// ── Structured logging ──────────────────────────────────────────
const LOG_PATH = path.join(__dirname, '../../logs/generate-report.log');
const _logStream = (() => {
  try {
    if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) return null;
    const logsDir = path.dirname(LOG_PATH);
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    return fs.createWriteStream(LOG_PATH, { flags: 'a' });
  } catch { return null; }
})();
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(msg);
  if (_logStream && !_logStream.destroyed) _logStream.write(line + '\n');
}
function logError(msg) {
  const line = `[${new Date().toISOString()}] ERROR: ${msg}`;
  console.error(msg);
  if (_logStream && !_logStream.destroyed) _logStream.write(line + '\n');
}
const DEBUG = process.env.DEBUG === '1' || process.env.REPORT_DEBUG === '1';
function debugLog(section, err) {
  if (!DEBUG) return;
  const msg = `[report:${section}] skipped: ${err?.message || 'unknown'}`;
  console.warn(msg);
  if (_logStream && !_logStream.destroyed) _logStream.write(`[${new Date().toISOString()}] WARN: ${msg}\n`);
}

// ── Config ──────────────────────────────────────────────────────
const UMAMI_API = process.env.UMAMI_API_URL || 'http://127.0.0.1:3001';
const UMAMI_USER = process.env.UMAMI_USERNAME || 'admin';
const UMAMI_PASS = process.env.UMAMI_PASSWORD || 'umami';
const WEBSITE_ID = process.env.UMAMI_WEBSITE_ID || process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID || '';
const SERVER_URL = process.env.SERVER_PUBLIC_URL || '';

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT = process.env.TELEGRAM_ADMIN_CHAT_ID || '';
const { chat, getApiKey } = require('../utils/llm-client');

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
    console.warn(`  Umami GET ${endpoint} -> ${res.status}`);
    return null;
  }
  return res.json();
}

function dateStr(d) { return d.toISOString().split('T')[0]; }
function estNow() { return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })); }
function fmtDuration(ms) {
  if (!ms || ms < 0) return '\u2013';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
function toEST(isoStr) {
  if (!isoStr) return '\u2013';
  try {
    return new Date(isoStr).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  } catch { return isoStr; }
}
function fmtSessionDuration(totaltime) {
  if (!totaltime || totaltime <= 0) return '< 1s';
  if (totaltime < 60) return `${totaltime}s`;
  const m = Math.floor(totaltime / 60);
  if (m < 60) return `${m}m ${totaltime % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

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
    if (page > 50) break;
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

  try {
    const src = fs.readFileSync(path.join(appDir, 'scripts/extract-promotions.js'), 'utf8');
    const m = src.match(/GROK_MODEL\s*=\s*['"]([^'"]+)['"]/);
    if (m) result.llmModel = m[1];
  } catch (e) { debugLog('llmModel', e); }

  try {
    const allSpots = db.spots.getAll();
    const venueMap = {};
    for (const v of db.venues.getAll()) venueMap[v.id] = v;

    result.totalSpots = allSpots.length;
    for (const spot of allSpots) {
      const venue = venueMap[spot.venue_id];
      const area = spot.area || venue?.area || 'Unknown';
      const activity = spot.type || 'Unknown';
      result.spotsByArea[area] = (result.spotsByArea[area] || 0) + 1;
      result.spotsByActivity[activity] = (result.spotsByActivity[activity] || 0) + 1;
    }
  } catch (e) { debugLog('spotCounts', e); }

  try {
    const database = db.getDb();

    // Auto-fix stale pipeline runs (started > 2h ago, still "running")
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const staleFixed = database.prepare(
      "UPDATE pipeline_runs SET status = 'failed_stale', finished_at = datetime('now') WHERE status = 'running' AND started_at < ?",
    ).run(twoHoursAgo);
    if (staleFixed.changes > 0) {
      console.log(`  Auto-fixed ${staleFixed.changes} stale pipeline run(s)`);
      database.prepare(
        "UPDATE pipeline_state SET value = 'completed_successfully' WHERE key = 'last_run_status' AND value LIKE 'running%'",
      ).run();
    }

    // Use most recent completed run for report data; fall back to latest if none
    const run = database.prepare(
      "SELECT * FROM pipeline_runs WHERE status != 'running' ORDER BY id DESC LIMIT 1",
    ).get() || db.pipelineRuns.latest();

    if (run) {
      result.lastPipelineRun = run.started_at;
      result.pipelineSteps = run.steps ? JSON.parse(run.steps) : null;
      result.pipelineAreaFilter = run.area_filter || null;
      if (run.started_at && run.finished_at) {
        result.pipelineDuration = new Date(run.finished_at).getTime() - new Date(run.started_at).getTime();
      }
    }
  } catch (e) { debugLog('data', e); }

  result.pipelineSkipReasons = [];
  result.pipelineVenuesDownloaded = null;
  result.pipelineVenuesProcessed = null;
  result.deltaNew = null;
  result.deltaChanged = null;
  result.deltaUnchanged = null;
  result.deltaFiltered = null;
  result.deltaForLLM = null;
  result.llmProcessed = null;
  result.llmSkipped = null;
  result.llmErrors = null;
  result.llmFoundPromotions = null;
  result.llmNoPromotions = null;
  result.maxIncrementalFiles = null;
  result.limitHit = false;
  result.archiveDays = null;

  try {
    const cfg = db.config.loadConfig();
    result.configStatus = cfg.last_run_status || 'unknown';
    if (cfg.pipeline?.maxIncrementalFiles && !result.maxIncrementalFiles) {
      result.maxIncrementalFiles = cfg.pipeline.maxIncrementalFiles;
    }
  } catch (e) { debugLog('data', e); }

  try {
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
    candidates.sort((a, b) => b.mtime - a.mtime);
    if (candidates.length > 0) {
      const logContent = fs.readFileSync(candidates[0].path, 'utf8');

      const processedMatches = logContent.match(/Successfully processed/g);
      if (processedMatches) {
        result.llmCallCount = processedMatches.length;
        result.llmProcessed = processedMatches.length;
      }
      const skippedMatches = logContent.match(/Skipping\b.*?\b(?:No meaningful changes|No changes|hash match|unchanged)/gi);
      if (skippedMatches) result.llmSkipped = skippedMatches.length;
      const errorMatches = logContent.match(/Error calling Grok|Error processing:|LLM .* error|API error/gi);
      if (errorMatches) result.llmErrors = errorMatches.length;

      const filteredMatch = logContent.match(/Filtered to (\d+) venue/);
      if (filteredMatch) result.pipelineVenuesProcessed = parseInt(filteredMatch[1]);
      const processingMatch = logContent.match(/Processing (\d+) venue/);
      if (processingMatch) result.pipelineVenuesDownloaded = parseInt(processingMatch[1]);
      const successMatch = logContent.match(/Successful: (\d+)/);
      if (successMatch) result.pipelineVenuesDownloaded = parseInt(successMatch[1]);

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

      const limitMatch = logContent.match(/Too many incremental files \((\d+) > (\d+)\)/);
      if (limitMatch) {
        result.limitHit = true;
        result.maxIncrementalFiles = parseInt(limitMatch[2]);
        result.pipelineSkipReasons.push(`LLM limit hit: ${limitMatch[1]} files > ${limitMatch[2]} max`);
      }
      const limitSet = logContent.match(/maxIncrementalFiles=(\d+)/);
      if (limitSet && !result.maxIncrementalFiles) result.maxIncrementalFiles = parseInt(limitSet[1]);

      if (logContent.includes('No incremental changes detected')) {
        result.pipelineSkipReasons.push('No content changes detected');
      }
      if (logContent.includes('Filtered to 0 venue')) {
        const filterMatch = logContent.match(/Filtering by area: (.+)/);
        const filterName = filterMatch ? filterMatch[1].trim() : 'unknown';
        result.pipelineSkipReasons.push(`Area filter "${filterName}" matched 0 venues`);
      }
      if (logContent.includes('No files found in') || logContent.includes('folder is empty')) {
        result.pipelineSkipReasons.push('Input folder was empty');
      }
      if (logContent.includes('skipping LLM extraction entirely')) {
        result.pipelineSkipReasons.push('LLM extraction skipped');
      }
      if (logContent.includes('skipping spot creation')) {
        result.pipelineSkipReasons.push('Spot creation skipped');
      }
      if (logContent.includes('Pipeline FAILED') || logContent.includes('Fatal error')) {
        result.pipelineSkipReasons.push('Pipeline encountered an error');
      }
      result.pipelineSkipReasons = [...new Set(result.pipelineSkipReasons)];
    }
  } catch (e) { debugLog('data', e); }

  result.downloadErrors = 0;
  result.downloadErrorsByType = {};
  result.topFailedVenues = [];
  try {
    const dlLogPath = path.join(appDir, 'logs/download-raw-html.log');
    if (fs.existsSync(dlLogPath)) {
      const dlLog = fs.readFileSync(dlLogPath, 'utf8');
      const errorLines = dlLog.match(/Error.*downloading.*|Failed.*|timeout.*|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|HTTP\s+\d{3}/gim) || [];
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
  } catch (e) { debugLog('data', e); }

  result.watchlistExcluded = 0;
  result.watchlistFlagged = 0;
  result.watchlistFlaggedVenues = [];
  try {
    const excluded = db.watchlist.getExcluded();
    const flagged = db.watchlist.getFlagged();
    result.watchlistExcluded = excluded.length;
    result.watchlistFlagged = flagged.length;
    for (const entry of flagged) {
      let goldStatus = 'unknown';
      try {
        const g = db.gold.get(entry.venue_id);
        if (g) {
          const promo = typeof g.promotions === 'string' ? JSON.parse(g.promotions) : (g.promotions || {});
          goldStatus = promo.found ? 'Has promotions' : 'No promotions';
        }
      } catch (e) { debugLog('data', e); }
      result.watchlistFlaggedVenues.push({
        name: entry.name || entry.venue_id,
        area: entry.area || 'Unknown',
        reason: entry.reason || '',
        goldStatus,
      });
    }
  } catch (e) { debugLog('data', e); }

  try {
    const archiveDirs = [dataPath('silver_trimmed', 'archive'), dataPath('raw', 'archive')];
    let maxDays = 0;
    for (const ad of archiveDirs) {
      if (fs.existsSync(ad)) {
        const days = fs.readdirSync(ad).filter(d => /^\d{8}$/.test(d)).length;
        if (days > maxDays) maxDays = days;
      }
    }
    result.archiveDays = maxDays;
  } catch (e) { debugLog('data', e); }

  try {
    const goldRows = db.gold.getAll();
    let found = 0, notFound = 0;
    for (const g of goldRows) {
      const promo = typeof g.promotions === 'string' ? JSON.parse(g.promotions) : (g.promotions || {});
      if (promo.found === true || (promo.entries && promo.entries.length > 0)) found++;
      else notFound++;
    }
    result.llmFoundPromotions = found;
    result.llmNoPromotions = notFound;
  } catch (e) { debugLog('data', e); }

  try {
    const logPath = path.join(appDir, 'logs/create-spots.log');
    if (fs.existsSync(logPath)) {
      const logContent = fs.readFileSync(logPath, 'utf8');
      const updatedLines = logContent.match(/Updated spot:\s*.+/g) || [];
      for (const line of updatedLines.slice(0, 40)) {
        const clean = line.replace(/^Updated spot:\s*/, '').trim();
        if (clean) result.updatedSpots.push(clean);
      }
      if (result.updatedSpots.length === 0) {
        const createdLines = logContent.match(/Created spot:\s*.+/g) || [];
        for (const line of createdLines.slice(0, 20)) {
          const clean = line.replace(/^Created spot:\s*/, '').trim();
          if (clean) result.newSpots.push(clean);
        }
      }
    }
  } catch (e) { debugLog('data', e); }

  try {
    const streakRows = db.streaks.getAll();
    const streakObj = {};
    for (const s of streakRows) {
      streakObj[s.venue_id + ':' + s.type] = { name: s.name, streak: s.streak, lastDate: s.last_date, venueId: s.venue_id };
    }
    result.updateStreaks = streakObj;
  } catch (e) { debugLog('data', e); }

  // ── Opening Discovery Stats ──
  result.discoveryRssArticles = null;
  result.discoveryGrokResults = null;
  result.discoveryCandidates = null;
  result.discoveryGeocoded = null;
  result.discoveryInserted = null;
  result.discoveryCleanedUp = null;
  result.discoveryLastRun = null;
  result.discoveryDuration = null;
  result.recentlyOpenedSpots = [];
  result.comingSoonSpots = [];

  try {
    const discoverLog = path.join(appDir, 'logs/discover-openings.log');
    if (fs.existsSync(discoverLog)) {
      const content = fs.readFileSync(discoverLog, 'utf8');
      const tsMatch = content.match(/^\[([^\]]+)\]/);
      if (tsMatch) result.discoveryLastRun = tsMatch[1];
      const rssMatch = content.match(/RSS articles:\s*(\d+)/);
      if (rssMatch) result.discoveryRssArticles = parseInt(rssMatch[1]);
      const articlesMatch = content.match(/Articles scanned:\s*(\d+)/);
      if (articlesMatch && !result.discoveryRssArticles) result.discoveryRssArticles = parseInt(articlesMatch[1]);
      const grokMatch = content.match(/Grok API:\s*(\d+)\s*results/);
      if (grokMatch) result.discoveryGrokResults = parseInt(grokMatch[1]);
      const candidatesMatch = content.match(/Candidates found:\s*(\d+)/);
      if (candidatesMatch) result.discoveryCandidates = parseInt(candidatesMatch[1]);
      const geocodedMatch = content.match(/Geocoded:\s*(\d+)/);
      if (geocodedMatch) result.discoveryGeocoded = parseInt(geocodedMatch[1]);
      const insertedMatch = content.match(/New spots inserted:\s*(\d+)/);
      if (insertedMatch) result.discoveryInserted = parseInt(insertedMatch[1]);
      const cleanedMatch = content.match(/Expired spots removed:\s*(\d+)/);
      if (cleanedMatch) result.discoveryCleanedUp = parseInt(cleanedMatch[1]);
      const durationMatch = content.match(/Discovery complete in ([\d.]+)s/);
      if (durationMatch) result.discoveryDuration = parseFloat(durationMatch[1]);
    }
  } catch (e) { debugLog('data', e); }

  try {
    const database = db.getDb();
    result.recentlyOpenedSpots = database.prepare(
      "SELECT id, title, area, description, source_url, lat, lng FROM spots WHERE type = 'Recently Opened' ORDER BY id DESC",
    ).all();
    result.comingSoonSpots = database.prepare(
      "SELECT id, title, area, description, source_url, lat, lng FROM spots WHERE type = 'Coming Soon' ORDER BY id DESC",
    ).all();
  } catch (e) { debugLog('data', e); }

  // ── Actionable Items ──
  result.actions = [];

  // 1. High-streak venues (updating daily with changes for 5+ days)
  try {
    const streakMap = result.updateStreaks;
    const highStreaks = Object.values(streakMap)
      .filter(s => s.streak >= 5)
      .sort((a, b) => b.streak - a.streak);
    for (const s of highStreaks) {
      result.actions.push({
        severity: s.streak >= 10 ? 'high' : 'medium',
        category: 'Venue Noise',
        title: `${s.name} updated ${s.streak} days in a row`,
        detail: `Content keeps changing daily. Likely dynamic pricing, rotating menu, or scraping noise.`,
        instruction: `Review if promotions are real. If noise, exclude:\n  nano data/config/venue-watchlist.json\n  Add: { "name": "${s.name}", "status": "excluded", "reason": "Daily content churn" }`,
      });
    }
  } catch (e) { debugLog('data', e); }

  // 2. Discovery spots needing review (no area, no website, suspect location)
  try {
    const discoverySpots = [...result.recentlyOpenedSpots, ...result.comingSoonSpots];
    for (const s of discoverySpots) {
      const issues = [];
      if (!s.area || s.area === 'Unknown') issues.push('no area assigned');
      if (!s.source_url) issues.push('no website found');
      if (!s.lat || !s.lng) issues.push('no coordinates');
      if (issues.length > 0) {
        result.actions.push({
          severity: 'medium',
          category: 'Discovery Review',
          title: `${s.title} (${s.area || 'no area'})`,
          detail: `Issues: ${issues.join(', ')}`,
          instruction: `Verify on Google Maps. To delete: reply to the Telegram bot with /delete ${s.id}`,
        });
      }
    }
  } catch (e) { debugLog('data', e); }

  // 3. Spots with no area assignment (recent only, skip user submissions with gibberish)
  try {
    const database = db.getDb();
    const noAreaSpots = database.prepare(
      "SELECT id, title, type FROM spots WHERE (area IS NULL OR area = '' OR area = 'Unknown') AND source = 'automated' AND type IN ('Happy Hour', 'Brunch') ORDER BY id DESC LIMIT 10",
    ).all();
    if (noAreaSpots.length > 0) {
      result.actions.push({
        severity: 'low',
        category: 'Data Quality',
        title: `${noAreaSpots.length} automated spots have no area`,
        detail: noAreaSpots.slice(0, 5).map(s => `#${s.id} ${s.title} [${s.type}]`).join(', '),
        instruction: `These spots won't appear when users filter by area. Run:\n  node scripts/analyze-spots-by-area.js\nto investigate area assignment gaps.`,
      });
    }
  } catch (e) { debugLog('data', e); }

  // 4. Flagged watchlist venues
  if (result.watchlistFlaggedVenues.length > 0) {
    for (const v of result.watchlistFlaggedVenues) {
      result.actions.push({
        severity: 'medium',
        category: 'Watchlist',
        title: `${v.name} is flagged`,
        detail: `Area: ${v.area}. Reason: ${v.reason}. Gold status: ${v.goldStatus}`,
        instruction: `Decide: exclude or unflag.\n  nano data/config/venue-watchlist.json\n  Change status to "excluded" or remove entry.`,
      });
    }
  }

  // 5. Pipeline failures
  if (result.configStatus?.startsWith('failed') || result.pipelineSkipReasons.some(r => r.includes('error') || r.includes('FAILED'))) {
    result.actions.push({
      severity: 'high',
      category: 'Pipeline Error',
      title: 'ETL pipeline failed last run',
      detail: result.pipelineSkipReasons.join('; ') || 'Unknown failure',
      instruction: `Check logs:\n  tail -100 ~/projects/chs-spots/logs/ops/nightly-pipeline-*.log\n  pm2 logs chs-spots --lines 50`,
    });
  }

  // 6. LLM errors
  if ((result.llmErrors ?? 0) > 0) {
    result.actions.push({
      severity: result.llmErrors >= 5 ? 'high' : 'medium',
      category: 'LLM Errors',
      title: `${result.llmErrors} LLM processing error(s) in last run`,
      detail: `Some venues failed to get promotions extracted. May indicate API issues or rate limiting.`,
      instruction: `Check extract-promotions log for details:\n  grep -i "error" ~/projects/chs-spots/logs/ops/nightly-pipeline-*.log | tail -20`,
    });
  }

  // 7. Download failures (top venues failing repeatedly)
  if (result.topFailedVenues.length > 0) {
    const chronic = result.topFailedVenues.filter(v => v.count >= 3);
    for (const v of chronic) {
      result.actions.push({
        severity: 'low',
        category: 'Download Failure',
        title: `${v.id} failed ${v.count}x`,
        detail: `Website may be down, blocking scrapers, or URL changed.`,
        instruction: `Check if site is still active. If permanently down, exclude:\n  nano data/config/venue-watchlist.json`,
      });
    }
  }

  // 8. LLM limit hit
  if (result.limitHit) {
    result.actions.push({
      severity: 'medium',
      category: 'Pipeline Limit',
      title: `LLM file limit hit (max: ${result.maxIncrementalFiles})`,
      detail: 'Too many venue changes in one run. Some venues were skipped.',
      instruction: `Increase limit in pipeline config if this keeps happening, or review if a mass website change triggered it.`,
    });
  }

  // 9. Low-confidence spots (only unreviewed items — LLM-resolved and human-reviewed are excluded)
  result.confidenceFlagged = [];
  result.confidenceRejected = [];
  result.llmAutoApplied = 0;
  result.reviewsInDb = 0;
  try {
    const reviewPath = reportingPath('confidence-review.json');
    if (fs.existsSync(reviewPath)) {
      const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
      result.confidenceFlagged = review.flagged || [];
      result.confidenceRejected = review.rejected || [];
      result.llmAutoApplied = review.llmAutoApplied || 0;
      result.reviewsInDb = review.reviewsInDb || 0;

      for (const f of result.confidenceFlagged) {
        const llmNote = f.llmReasoning ? ` LLM says: "${f.llmReasoning}" (confidence: ${f.llmReviewConfidence})` : '';
        result.actions.push({
          severity: 'medium',
          category: 'Confidence Review',
          title: `${f.venue} [${f.type}] — confidence ${f.effectiveConfidence}/${f.llmConfidence}`,
          detail: `Flags: ${f.flags.join(', ')}. Times: ${f.times || 'N/A'}, Days: ${f.days || 'N/A'}, Label: "${f.label || ''}"${llmNote}`,
          instruction: `Review if this ${f.type} is genuine. If wrong, exclude via Telegram: /delete <spotId>\nOr add to watchlist to prevent future extraction.`,
        });
      }
      if (result.confidenceRejected.length > 0) {
        result.actions.push({
          severity: 'low',
          category: 'Confidence Review',
          title: `${result.confidenceRejected.length} spot(s) need human review (heuristic-rejected, LLM uncertain)`,
          detail: result.confidenceRejected.slice(0, 5).map(r =>
            `${r.venue} [${r.type}]: ${r.flags.join(', ')} (score: ${r.effectiveConfidence})${r.llmReasoning ? ' — LLM: "' + r.llmReasoning + '"' : ''}`
          ).join('\n'),
          instruction: 'These were not created as spots. Review if any should be manually added.',
        });
      }
      if (result.llmAutoApplied > 0) {
        result.actions.push({
          severity: 'low',
          category: 'Confidence Review',
          title: `${result.llmAutoApplied} entries auto-resolved by LLM review (${result.reviewsInDb} total in DB)`,
          detail: 'High-confidence LLM decisions were automatically applied. No action needed.',
          instruction: 'For reference only. These decisions persist across pipeline runs.',
        });
      }
    }
  } catch (e) { debugLog('confidenceReview', e); }

  // Sort actions: high > medium > low
  const severityOrder = { high: 0, medium: 1, low: 2 };
  result.actions.sort((a, b) => (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3));

  return result;
}

// ── Build HTML report (three-page tabbed layout) ─────────────────
function buildHtml(data) {
  const now = estNow();
  const reportDate = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const reportTime = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });

  const { analytics, pipeline } = data;
  const sv = (obj, key) => (obj && typeof obj[key] === 'number' ? obj[key] : (obj?.[key]?.value ?? '\u2013'));

  // ── User metrics ──
  const visitorMap = {};
  for (const s of analytics.allSessions30d || []) {
    const fp = `${s.browser}|${s.os}|${s.device}|${s.screen}|${s.language}|${s.country}`;
    if (!visitorMap[fp]) {
      visitorMap[fp] = { browser: s.browser, os: s.os, device: s.device, country: s.country, totalVisits: 0, totalViews: 0, sessions: [] };
    }
    visitorMap[fp].totalVisits += (s.visits || 1);
    visitorMap[fp].totalViews += (s.views || 0);
    visitorMap[fp].sessions.push(s);
  }
  const allVisitors = Object.values(visitorMap);
  const returningVisitors = allVisitors.filter(v => v.sessions.length > 1);
  const topReturning = [...allVisitors].sort((a, b) => b.totalVisits - a.totalVisits).slice(0, 5);

  const sessions24h = (analytics.sessions24h || []).sort((a, b) => new Date(b.lastAt || b.createdAt) - new Date(a.lastAt || a.createdAt));
  const totalSessions24h = sessions24h.length;
  const bouncedSessions24h = sessions24h.filter(s => (s.views || 0) <= 1 && (!s.totaltime || s.totaltime <= 0)).length;
  const engagedSessions24h = sessions24h.filter(s => (s.views || 0) >= 2 || (s.totaltime && s.totaltime > 10)).length;
  const avgDuration24h = totalSessions24h > 0
    ? Math.round(sessions24h.reduce((sum, s) => sum + (s.totaltime || 0), 0) / totalSessions24h)
    : 0;
  const bounceRate24h = totalSessions24h > 0 ? Math.round((bouncedSessions24h / totalSessions24h) * 100) : 0;
  const engagementRate24h = totalSessions24h > 0 ? Math.round((engagedSessions24h / totalSessions24h) * 100) : 0;

  const mobileCount = (analytics.devices || []).find(d => d.x === 'mobile')?.y || 0;
  const desktopCount = (analytics.devices || []).find(d => d.x === 'laptop' || d.x === 'desktop')?.y || 0;
  const totalDevices = mobileCount + desktopCount || 1;
  const mobilePct = Math.round((mobileCount / totalDevices) * 100);

  const eventMap = {};
  for (const e of analytics.topEvents || []) {
    eventMap[e.x || e.eventName] = e.y || 0;
  }

  const behaviorEvents = [
    { key: 'area-view', label: 'Area Browsing' },
    { key: 'activity-filter', label: 'Activity Filtering' },
    { key: 'spot-click', label: 'Spot Views' },
    { key: 'search-filter', label: 'Searches' },
    { key: 'venue-toggle', label: 'Venue Toggles' },
    { key: 'view-mode', label: 'View Switches' },
    { key: 'near-me', label: 'Near Me Usage' },
    { key: 'share', label: 'Shares' },
    { key: 'favorite', label: 'Favorites' },
    { key: 'spot-submit', label: 'Spot Submissions' },
    { key: 'feedback-submit', label: 'Feedback Sent' },
  ].filter(b => eventMap[b.key] > 0);

  const topAreas = (analytics.eventDataFields?.area || []).slice(0, 8);
  const topActivities = (analytics.eventDataFields?.activity || []).slice(0, 8);
  const topSpotNames = (analytics.eventDataFields?.spotName || []).slice(0, 10);
  const topSearchQueries = (analytics.eventDataFields?.query || [])
    .filter(q => q.value && q.value.length >= 3)
    .slice(0, 10);

  const dailyRows = (analytics.dailyPageviews || [])
    .map((pv, i) => {
      const sessions = analytics.dailySessions?.[i];
      if ((pv.y || 0) === 0 && (sessions?.y || 0) === 0) return null;
      const date = pv.x ? new Date(pv.x).toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'short' }) : '\u2013';
      return `<tr><td>${date}</td><td>${sessions?.y ?? '\u2013'}</td></tr>`;
    }).filter(Boolean).join('');

  // ── ETL sections ──
  const stepsHtml = (pipeline.pipelineSteps && typeof pipeline.pipelineSteps === 'object')
    ? Object.entries(pipeline.pipelineSteps).map(([name, step]) => {
        if (!step || typeof step !== 'object') return '';
        const status = step.status || '\u2013';
        const badge = status === 'completed' ? 'badge-ok' : status === 'skipped' ? 'badge-skip' : status === 'failed' ? 'badge-fail' : 'badge-pending';
        let dur = '\u2013';
        if (step.startedAt && step.finishedAt) {
          try { dur = fmtDuration(new Date(step.finishedAt) - new Date(step.startedAt)); } catch (e) { debugLog('data', e); }
        }
        return `<tr><td>${name}</td><td><span class="badge ${badge}">${status}</span></td><td>${dur}</td></tr>`;
      }).join('')
    : '';

  const skipReasonsHtml = (pipeline.pipelineSkipReasons || []).length > 0
    ? `<div class="skip-reasons"><strong>Notes:</strong><ul>${pipeline.pipelineSkipReasons.map(r => `<li>${r}</li>`).join('')}</ul></div>`
    : '';

  const streakMap = pipeline.updateStreaks || {};
  const streakByName = {};
  for (const [, v] of Object.entries(streakMap)) {
    if (v && v.name) streakByName[v.name] = v.streak || 1;
  }
  const updatedList = pipeline.updatedSpots.length > 0 ? pipeline.updatedSpots : pipeline.newSpots;
  const sortedUpdated = [...updatedList].sort((a, b) => (streakByName[b] || 1) - (streakByName[a] || 1));

  const pipelineOk = pipeline.configStatus === 'completed_successfully' && !pipeline.limitHit && (pipeline.llmErrors ?? 0) === 0;
  const pipelineFailed = pipeline.configStatus?.startsWith('failed');
  const pipelineStatusBadge = pipelineFailed ? 'badge-fail' : pipelineOk ? 'badge-ok' : 'badge-pending';
  const pipelineStatusLabel = pipelineFailed ? 'FAILED' : pipelineOk ? 'OK' : 'WARNING';

  // ── Actions section ──
  const actions = pipeline.actions || [];
  const actionCount = actions.length;
  const highCount = actions.filter(a => a.severity === 'high').length;
  const medCount = actions.filter(a => a.severity === 'medium').length;

  const actionsBadge = actionCount === 0 ? 'badge-ok' : highCount > 0 ? 'badge-fail' : 'badge-pending';
  const actionsLabel = actionCount === 0 ? 'ALL CLEAR' : `${actionCount} ITEM${actionCount > 1 ? 'S' : ''}`;

  const actionsHtml = actions.length > 0
    ? actions.map(a => {
        const sevBadge = a.severity === 'high' ? 'badge-fail' : a.severity === 'medium' ? 'badge-pending' : 'badge-skip';
        const sevLabel = a.severity.toUpperCase();
        return `
        <div class="action-card action-${a.severity}">
          <div class="action-header">
            <span class="badge ${sevBadge}">${sevLabel}</span>
            <span class="action-category">${escHtml(a.category)}</span>
          </div>
          <div class="action-title">${escHtml(a.title)}</div>
          <div class="action-detail">${escHtml(a.detail)}</div>
          <div class="action-instruction"><strong>How to fix:</strong><pre>${escHtml(a.instruction)}</pre></div>
        </div>`;
      }).join('')
    : '<div class="all-clear"><span class="all-clear-icon">&#10003;</span> No actions needed. Everything looks healthy.</div>';

  // ── Discovery spots table ──
  const openingSpotsHtml = (spots, label) => {
    if (!spots || spots.length === 0) return '';
    return `
    <h3>${label} (${spots.length})</h3>
    <table class="small-table"><tr><th>Name</th><th>Area</th><th>Website</th></tr>
    ${spots.map(s => {
      const websiteCell = s.source_url
        ? `<a href="${escHtml(s.source_url)}" target="_blank" style="color:#0d9488;text-decoration:none;">${new URL(s.source_url).hostname.replace('www.','')}</a>`
        : '<span style="color:#94a3b8;">none</span>';
      return `<tr><td>${escHtml(s.title)}</td><td>${escHtml(s.area || '—')}</td><td>${websiteCell}</td></tr>`;
    }).join('')}
    </table>`;
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CHS Finds \u2013 Daily Report \u2013 ${dateStr(new Date())}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; color: #1e293b; padding: 0; max-width: 720px; margin: 0 auto; }
  .header { padding: 20px 16px 0; }
  h1 { font-size: 1.4rem; color: #0d9488; margin-bottom: 4px; }
  h2 { font-size: 1.05rem; color: #334155; margin: 20px 0 8px; border-bottom: 2px solid #e2e8f0; padding-bottom: 4px; }
  h3 { font-size: 0.9rem; color: #475569; margin: 14px 0 6px; }
  .subtitle { font-size: 0.85rem; color: #64748b; margin-bottom: 12px; }
  .tabs { display: flex; border-bottom: 2px solid #e2e8f0; margin: 0; position: sticky; top: 0; background: #f8fafc; z-index: 10; padding: 0 16px; }
  .tab { padding: 10px 14px; cursor: pointer; font-weight: 600; font-size: 0.85rem; color: #64748b; border-bottom: 3px solid transparent; margin-bottom: -2px; transition: all 0.2s; user-select: none; white-space: nowrap; }
  .tab:hover { color: #0d9488; }
  .tab.active { color: #0d9488; border-bottom-color: #0d9488; }
  .tab .tab-badge { display: inline-block; font-size: 0.65rem; padding: 1px 6px; border-radius: 9999px; font-weight: 700; margin-left: 4px; vertical-align: middle; }
  .tab-content { display: none; padding: 0 16px 16px; }
  .tab-content.active { display: block; }
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 10px; margin: 10px 0; }
  .stat-card { background: #fff; border-radius: 10px; padding: 14px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .stat-value { font-size: 1.5rem; font-weight: 700; color: #0d9488; }
  .stat-value.warn { color: #f59e0b; }
  .stat-value.bad { color: #ef4444; }
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
  .info-box { background: #fff; border-radius: 10px; padding: 12px; margin: 8px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.08); font-size: 0.85rem; }
  .info-box strong { color: #0d9488; }
  .skip-reasons { background: #fef3c7; border-radius: 8px; padding: 10px 14px; margin: 8px 0; font-size: 0.82rem; }
  .skip-reasons ul { margin: 4px 0 0 18px; }
  .skip-reasons li { margin-bottom: 2px; color: #92400e; }
  .behavior-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; margin: 10px 0; }
  .behavior-item { background: #fff; border-radius: 8px; padding: 10px; display: flex; align-items: center; gap: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.06); font-size: 0.82rem; }
  .behavior-item .count { font-weight: 700; color: #0d9488; font-size: 1rem; min-width: 28px; }
  .behavior-item .label { color: #475569; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .pipeline-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }

  /* Actions */
  .action-card { background: #fff; border-radius: 10px; padding: 14px; margin: 10px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.08); border-left: 4px solid #94a3b8; }
  .action-high { border-left-color: #ef4444; }
  .action-medium { border-left-color: #f59e0b; }
  .action-low { border-left-color: #6366f1; }
  .action-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .action-category { font-size: 0.72rem; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
  .action-title { font-size: 0.9rem; font-weight: 700; color: #1e293b; margin-bottom: 4px; }
  .action-detail { font-size: 0.8rem; color: #475569; margin-bottom: 8px; }
  .action-instruction { font-size: 0.75rem; background: #f8fafc; border-radius: 6px; padding: 8px 10px; }
  .action-instruction pre { font-family: 'SF Mono', Menlo, monospace; font-size: 0.72rem; white-space: pre-wrap; word-break: break-all; color: #334155; margin: 4px 0 0; }
  .all-clear { background: #d1fae5; border-radius: 10px; padding: 20px; text-align: center; font-size: 1rem; color: #065f46; font-weight: 600; margin: 16px 0; }
  .all-clear-icon { font-size: 1.4rem; margin-right: 8px; }

  @media (max-width: 500px) { .two-col { grid-template-columns: 1fr; } .stats-grid { grid-template-columns: repeat(2, 1fr); } .behavior-grid { grid-template-columns: repeat(2, 1fr); } }
  footer { margin: 28px 16px 16px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 0.72rem; color: #94a3b8; text-align: center; }
</style>
</head>
<body>

<div class="header">
  <h1>CHS Finds Daily Report</h1>
  <p class="subtitle">${reportDate} at ${reportTime} EST</p>
</div>

<div class="tabs">
  <div class="tab active" onclick="switchTab('actions')">Actions <span class="tab-badge" style="background:${actionCount === 0 ? '#d1fae5;color:#065f46' : highCount > 0 ? '#fee2e2;color:#991b1b' : '#fef3c7;color:#92400e'}">${actionsLabel}</span></div>
  <div class="tab" onclick="switchTab('etl')">ETL / Pipeline</div>
  <div class="tab" onclick="switchTab('users')">Analytics</div>
</div>

<!-- ===== PAGE 1: ACTIONS NEEDED ===== -->
<div id="tab-actions" class="tab-content active">

  <h2>
    <div class="pipeline-header">
      Actions Needed
      <span class="badge ${actionsBadge}">${actionsLabel}</span>
    </div>
  </h2>
  ${actionsHtml}

  <h2>Opening Discovery</h2>
  ${pipeline.discoveryLastRun ? `
  <div class="info-box">
    <p>Last run: <strong>${toEST(pipeline.discoveryLastRun)} EST</strong>
    ${pipeline.discoveryDuration != null ? ` \u2022 Duration: <strong>${pipeline.discoveryDuration}s</strong>` : ''}</p>
    <p>Sources: RSS feeds + Grok API \u2022 New spots: <strong>${pipeline.discoveryInserted ?? 0}</strong></p>
  </div>` : '<p class="muted">No discovery run data available.</p>'}

  ${openingSpotsHtml(pipeline.recentlyOpenedSpots, 'Recently Opened')}
  ${openingSpotsHtml(pipeline.comingSoonSpots, 'Coming Soon')}
  ${pipeline.recentlyOpenedSpots.length === 0 && pipeline.comingSoonSpots.length === 0 ? '<p class="muted">No active opening spots.</p>' : ''}

  <h2>Content Snapshot</h2>
  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-value">${pipeline.totalSpots}</div>
      <div class="stat-label">Total Spots</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${pipeline.recentlyOpenedSpots.length}</div>
      <div class="stat-label">Recently Opened</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${pipeline.comingSoonSpots.length}</div>
      <div class="stat-label">Coming Soon</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${pipeline.watchlistExcluded}</div>
      <div class="stat-label">Excluded Venues</div>
    </div>
  </div>

</div>

<!-- ===== PAGE 2: ETL / TECHNICAL ===== -->
<div id="tab-etl" class="tab-content">

  <h2>
    <div class="pipeline-header">
      Pipeline Status
      <span class="badge ${pipelineStatusBadge}">${pipelineStatusLabel}</span>
    </div>
  </h2>
  <div class="info-box">
    <p>Last run: <strong>${pipeline.lastPipelineRun ? toEST(pipeline.lastPipelineRun) + ' EST' : '\u2013'}</strong></p>
    <p>Duration: <strong>${pipeline.pipelineDuration ? fmtDuration(pipeline.pipelineDuration) : '\u2013'}</strong></p>
    <p>LLM model: <strong>${pipeline.llmModel}</strong></p>
    ${pipeline.pipelineAreaFilter ? `<p>Area filter: <strong>${pipeline.pipelineAreaFilter}</strong></p>` : ''}
    ${pipeline.maxIncrementalFiles != null ? `<p>LLM file limit: <strong>${pipeline.maxIncrementalFiles}</strong>${pipeline.limitHit ? ' <span class="badge badge-fail">LIMIT HIT</span>' : ''}</p>` : ''}
    ${pipeline.archiveDays != null ? `<p>Archive: <strong>${pipeline.archiveDays} day(s)</strong> retained</p>` : ''}
  </div>
  ${skipReasonsHtml}

  <h2>Content Delta</h2>
  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-value">${pipeline.deltaNew ?? '\u2013'}</div>
      <div class="stat-label">New Venues</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${pipeline.deltaChanged ?? '\u2013'}</div>
      <div class="stat-label">Changed</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${pipeline.deltaForLLM ?? '\u2013'}</div>
      <div class="stat-label">Sent to LLM</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${pipeline.deltaFiltered ?? '\u2013'}</div>
      <div class="stat-label">Noise Filtered</div>
    </div>
  </div>

  <h2>LLM Processing</h2>
  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-value">${pipeline.llmProcessed ?? pipeline.llmCallCount ?? '\u2013'}</div>
      <div class="stat-label">LLM Calls</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${pipeline.llmSkipped ?? '\u2013'}</div>
      <div class="stat-label">Skipped</div>
    </div>
    <div class="stat-card">
      <div class="stat-value${(pipeline.llmErrors ?? 0) > 0 ? ' bad' : ''}">${pipeline.llmErrors ?? 0}</div>
      <div class="stat-label">Errors</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${pipeline.llmFoundPromotions ?? '\u2013'}</div>
      <div class="stat-label">Has Promotions</div>
    </div>
  </div>

  <h2>Download Health</h2>
  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-value">${pipeline.pipelineVenuesDownloaded ?? '\u2013'}</div>
      <div class="stat-label">Venues Downloaded</div>
    </div>
    <div class="stat-card">
      <div class="stat-value${(pipeline.downloadErrors ?? 0) > 10 ? ' warn' : ''}">${pipeline.downloadErrors ?? 0}</div>
      <div class="stat-label">Errors</div>
    </div>
  </div>
  ${Object.keys(pipeline.downloadErrorsByType || {}).length > 0 ? `<table class="small-table"><tr><th>Error Type</th><th>Count</th></tr>${Object.entries(pipeline.downloadErrorsByType).sort(([,a],[,b]) => b - a).map(([type, count]) => `<tr><td>${type}</td><td>${count}</td></tr>`).join('')}</table>` : ''}
  ${(pipeline.topFailedVenues || []).length > 0 ? `<p class="muted">Top failing: ${pipeline.topFailedVenues.map(v => v.id + ' (' + v.count + 'x)').join(', ')}</p>` : ''}

  ${stepsHtml ? `
  <h2>Pipeline Steps</h2>
  <table><tr><th>Step</th><th>Status</th><th>Duration</th></tr>${stepsHtml}</table>` : ''}

  <h2>Updated Spots</h2>
  ${sortedUpdated.length > 0
    ? `<table><tr><th>#</th><th>Spot</th><th>Streak</th></tr>
       ${sortedUpdated.slice(0, 30).map((s, i) => {
         const streak = streakByName[s] || 1;
         const streakIcon = streak >= 5 ? '\uD83D\uDD25' : streak >= 3 ? '\uD83D\uDCC8' : '';
         return `<tr><td>${i + 1}</td><td>${s}</td><td>${streakIcon} ${streak}d</td></tr>`;
       }).join('')}</table>`
    : '<p class="muted">No updated spots in last run.</p>'}

  <h2>Discovery Pipeline</h2>
  ${pipeline.discoveryLastRun ? `
  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-value">${pipeline.discoveryRssArticles ?? '\u2013'}</div>
      <div class="stat-label">RSS Articles</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${pipeline.discoveryGrokResults ?? '\u2013'}</div>
      <div class="stat-label">Grok Results</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${pipeline.discoveryCandidates ?? '\u2013'}</div>
      <div class="stat-label">Candidates</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${pipeline.discoveryGeocoded ?? '\u2013'}</div>
      <div class="stat-label">Geocoded</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${pipeline.discoveryInserted ?? 0}</div>
      <div class="stat-label">New Spots</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${pipeline.discoveryCleanedUp ?? 0}</div>
      <div class="stat-label">Expired Removed</div>
    </div>
  </div>` : '<p class="muted">No discovery run data available.</p>'}

  <h2>Content Inventory</h2>
  <p class="muted">Total spots: <strong>${pipeline.totalSpots}</strong></p>
  <div class="two-col">
    <div>
      <h3>By Area</h3>
      ${Object.entries(pipeline.spotsByArea).length > 0
        ? `<table class="small-table"><tr><th>Area</th><th>#</th></tr>${Object.entries(pipeline.spotsByArea).sort(([,a],[,b]) => b - a).map(([area, count]) => `<tr><td>${area}</td><td>${count}</td></tr>`).join('')}</table>`
        : ''}
    </div>
    <div>
      <h3>By Activity</h3>
      ${Object.entries(pipeline.spotsByActivity).length > 0
        ? `<table class="small-table"><tr><th>Activity</th><th>#</th></tr>${Object.entries(pipeline.spotsByActivity).sort(([,a],[,b]) => b - a).map(([act, count]) => `<tr><td>${act}</td><td>${count}</td></tr>`).join('')}</table>`
        : ''}
    </div>
  </div>

</div>

<!-- ===== PAGE 3: USER ANALYTICS ===== -->
<div id="tab-users" class="tab-content">

  <h2>At a Glance</h2>
  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-value">${sv(analytics.stats24h, 'visitors')}</div>
      <div class="stat-label">Unique Users Today</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${sv(analytics.stats7d, 'visitors')}</div>
      <div class="stat-label">Users (7d)</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${sv(analytics.stats30d, 'visitors')}</div>
      <div class="stat-label">Users (30d)</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${analytics.activeNow ?? '\u2013'}</div>
      <div class="stat-label">Active Now</div>
    </div>
  </div>

  <h2>Engagement Quality</h2>
  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-value">${fmtSessionDuration(avgDuration24h)}</div>
      <div class="stat-label">Avg Session (24h)</div>
    </div>
    <div class="stat-card">
      <div class="stat-value${engagementRate24h >= 50 ? '' : engagementRate24h >= 25 ? ' warn' : ' bad'}">${engagementRate24h}%</div>
      <div class="stat-label">Engaged (24h)</div>
    </div>
    <div class="stat-card">
      <div class="stat-value${bounceRate24h <= 30 ? '' : bounceRate24h <= 60 ? ' warn' : ' bad'}">${bounceRate24h}%</div>
      <div class="stat-label">Bounce Rate (24h)</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${mobilePct}%</div>
      <div class="stat-label">Mobile Users (7d)</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${returningVisitors.length}</div>
      <div class="stat-label">Returning (30d)</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${allVisitors.length - returningVisitors.length}</div>
      <div class="stat-label">New Users (30d)</div>
    </div>
  </div>

  <h2>What Users Do (7d)</h2>
  ${behaviorEvents.length > 0 ? `
  <div class="behavior-grid">
    ${behaviorEvents.map(b => `
    <div class="behavior-item">
      <span class="count">${eventMap[b.key]}</span>
      <span class="label">${b.label}</span>
    </div>`).join('')}
  </div>` : '<p class="muted">No user interactions recorded yet.</p>'}

  ${topActivities.length > 0 ? `
  <h3>Top Activities Browsed</h3>
  <table><tr><th>Activity</th><th>Times Selected</th></tr>
  ${topActivities.map(a => `<tr><td>${a.value}</td><td>${a.total}</td></tr>`).join('')}
  </table>` : ''}

  ${topAreas.length > 0 ? `
  <h3>Top Areas Explored</h3>
  <table><tr><th>Area</th><th>Views</th></tr>
  ${topAreas.map(a => `<tr><td>${a.value}</td><td>${a.total}</td></tr>`).join('')}
  </table>` : ''}

  ${topSpotNames.length > 0 ? `
  <h3>Most Clicked Spots</h3>
  <table><tr><th>Spot</th><th>Clicks</th></tr>
  ${topSpotNames.map(s => `<tr><td>${s.value}</td><td>${s.total}</td></tr>`).join('')}
  </table>` : ''}

  ${topSearchQueries.length > 0 ? `
  <h3>Top Search Queries</h3>
  <table><tr><th>Query</th><th>Times</th></tr>
  ${topSearchQueries.map(q => `<tr><td>${q.value}</td><td>${q.total}</td></tr>`).join('')}
  </table>` : ''}

  <h2>Daily Users (14d)</h2>
  ${dailyRows
    ? `<table><tr><th>Date</th><th>Sessions</th></tr>${dailyRows}</table>`
    : '<p class="muted">No daily data available.</p>'}

  <h2>Top Returning Users (30d)</h2>
  ${topReturning.length > 0
    ? `<table><tr><th>#</th><th>Device</th><th>Platform</th><th>Visits</th><th>Sessions</th></tr>
       ${topReturning.map((v, i) => `<tr><td>${i + 1}</td><td>${v.device}</td><td>${v.browser} / ${v.os}</td><td>${v.totalVisits}</td><td>${v.sessions.length}</td></tr>`).join('')}
       </table>`
    : '<p class="muted">No returning visitor data yet.</p>'}

  <h2>Today's Sessions</h2>
  <p class="muted">${sessions24h.length} session(s) \u2014 ${engagedSessions24h} engaged, ${bouncedSessions24h} bounced</p>
  ${sessions24h.length > 0
    ? `<table class="small-table">
        <tr><th>Time</th><th>Device</th><th>Duration</th><th>Country</th></tr>
        ${sessions24h.map(s => {
          const time = s.lastAt ? new Date(s.lastAt).toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York', hour12: true }) : '\u2013';
          const dur = s.totaltime ? fmtSessionDuration(s.totaltime) : '< 1s';
          return `<tr><td>${time}</td><td>${s.device || '\u2013'}</td><td>${dur}</td><td>${s.country || '\u2013'}</td></tr>`;
        }).join('')}
       </table>`
    : '<p class="muted">No sessions yet today.</p>'}

</div>

<footer>Auto-generated by CHS Finds analytics \u2022 ${new Date().toISOString()}</footer>

<script>
function switchTab(id) {
  document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
  document.querySelectorAll('.tab-content').forEach(function(c) { c.classList.remove('active'); });
  document.getElementById('tab-' + id).classList.add('active');
  var tabs = document.querySelectorAll('.tab');
  for (var i = 0; i < tabs.length; i++) {
    if (tabs[i].getAttribute('onclick').indexOf(id) !== -1) tabs[i].classList.add('active');
  }
}
</script>
</body>
</html>`;
}

// ── Main ────────────────────────────────────────────────────────
async function main() {
  log('═══ generate-report.js START ═══');

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
    eventDataFields: {},
  };

  let token = null;
  if (WEBSITE_ID) {
    try {
      token = await umamiLogin();
      console.log('  Umami login OK');
    } catch (err) {
      console.warn('  Umami login failed:', err.message);
    }
  } else {
    console.warn('  No UMAMI_WEBSITE_ID set, skipping analytics');
  }

  if (token) {
    const [s24h, s7d, s30d] = await Promise.all([
      umamiGet(token, `/stats?startAt=${oneDayAgo.getTime()}&endAt=${now.getTime()}`),
      umamiGet(token, `/stats?startAt=${oneWeekAgo.getTime()}&endAt=${now.getTime()}`),
      umamiGet(token, `/stats?startAt=${oneMonthAgo.getTime()}&endAt=${now.getTime()}`),
    ]);
    analytics.stats24h = s24h;
    analytics.stats7d = s7d;
    analytics.stats30d = s30d;

    try {
      const active = await umamiGet(token, '/active');
      analytics.activeNow = active?.visitors ?? null;
    } catch (e) { debugLog('data', e); }

    try {
      const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      const daily = await umamiGet(token, `/pageviews?startAt=${twoWeeksAgo.getTime()}&endAt=${now.getTime()}&unit=day&timezone=America/New_York`);
      analytics.dailyPageviews = daily?.pageviews || [];
      analytics.dailySessions = daily?.sessions || [];
    } catch (e) { debugLog('data', e); }

    try {
      const monthly = await umamiGet(token, `/pageviews?startAt=${sixMonthsAgo.getTime()}&endAt=${now.getTime()}&unit=month&timezone=America/New_York`);
      analytics.monthlyPageviews = monthly?.pageviews || [];
      analytics.monthlySessions = monthly?.sessions || [];
    } catch (e) { debugLog('data', e); }

    try {
      analytics.sessions24h = await fetchAllSessions(token, oneDayAgo.getTime(), now.getTime());
    } catch (e) { console.warn('  sessions24h failed:', e.message); }

    try {
      analytics.allSessions30d = await fetchAllSessions(token, oneMonthAgo.getTime(), now.getTime());
    } catch (e) { console.warn('  sessions30d failed:', e.message); }

    try {
      const events = await umamiGet(token, `/metrics?startAt=${oneWeekAgo.getTime()}&endAt=${now.getTime()}&type=event`);
      analytics.topEvents = Array.isArray(events) ? events.sort((a, b) => (b.y || 0) - (a.y || 0)).slice(0, 15) : [];
    } catch (e) { debugLog('data', e); }

    try {
      const pages = await umamiGet(token, `/metrics?startAt=${oneWeekAgo.getTime()}&endAt=${now.getTime()}&type=path`);
      analytics.topPages = Array.isArray(pages) ? pages.sort((a, b) => (b.y || 0) - (a.y || 0)).slice(0, 10) : [];
    } catch (e) { debugLog('data', e); }

    try {
      const devices = await umamiGet(token, `/metrics?startAt=${oneWeekAgo.getTime()}&endAt=${now.getTime()}&type=device`);
      analytics.devices = Array.isArray(devices) ? devices : [];
    } catch (e) { debugLog('data', e); }

    try {
      const url = `/event-data/fields?startAt=${oneWeekAgo.getTime()}&endAt=${now.getTime()}`;
      const allFields = await umamiGet(token, url);
      if (Array.isArray(allFields)) {
        const grouped = {};
        for (const item of allFields) {
          const prop = item.propertyName || item.fieldName;
          if (!prop) continue;
          if (!grouped[prop]) grouped[prop] = [];
          grouped[prop].push({ value: item.value, total: item.total || 0 });
        }
        for (const [prop, values] of Object.entries(grouped)) {
          values.sort((a, b) => b.total - a.total);
          analytics.eventDataFields[prop] = values.slice(0, 15);
        }
      }
    } catch (e) { debugLog('data', e); }

    console.log(`  Analytics fetched (${analytics.sessions24h.length} sessions 24h, ${analytics.allSessions30d.length} sessions 30d)`);
  }

  const pipeline = getPipelineData();
  console.log(`  Pipeline data: ${pipeline.totalSpots} spots, model: ${pipeline.llmModel}, actions: ${pipeline.actions.length}`);

  const html = buildHtml({ analytics, pipeline });

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const today = dateStr(new Date());
  const htmlPath = path.join(REPORT_DIR, `report-${today}.html`);
  fs.writeFileSync(htmlPath, html);
  console.log(`  HTML saved: ${htmlPath}`);

  // PDF (render all tabs expanded for print)
  let pdfPath = null;
  try {
    const { chromium } = require('playwright');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const pdfHtml = html
      .replace(/class="tab-content"/g, 'class="tab-content active"')
      .replace(/class="tabs"/g, 'class="tabs" style="display:none;"');
    await page.setContent(pdfHtml, { waitUntil: 'networkidle' });
    pdfPath = path.join(REPORT_DIR, `report-${today}.pdf`);
    await page.pdf({ path: pdfPath, format: 'A4', printBackground: true, margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' } });
    await browser.close();
    console.log(`  PDF saved: ${pdfPath}`);
  } catch (err) {
    console.warn(`  PDF skipped: ${err.message}`);
  }

  // Telegram summary
  if (sendTelegram && TELEGRAM_TOKEN && TELEGRAM_CHAT) {
    try {
      const reportUrl = SERVER_URL ? `${SERVER_URL}/reports/report-${today}.html` : `(local) ${htmlPath}`;
      const statVal = (obj, key) => (obj && typeof obj[key] === 'number' ? obj[key] : (obj?.[key]?.value ?? '\u2013'));
      const visitors24h = statVal(analytics.stats24h, 'visitors');
      const visitors7d = statVal(analytics.stats7d, 'visitors');
      const visitors30d = statVal(analytics.stats30d, 'visitors');

      const sessions = (analytics.sessions24h || []).length;
      const engaged = (analytics.sessions24h || []).filter(s => (s.views || 0) >= 2 || (s.totaltime && s.totaltime > 10)).length;

      const pOk = pipeline.configStatus === 'completed_successfully' && !pipeline.limitHit;
      const pStatus = pipeline.configStatus?.startsWith('failed') ? 'FAILED' : pOk ? 'OK' : 'WARNING';

      const roCount = pipeline.recentlyOpenedSpots?.length || 0;
      const csCount = pipeline.comingSoonSpots?.length || 0;

      const actionsSummary = pipeline.actions.length > 0
        ? pipeline.actions.slice(0, 3).map(a => {
            const icon = a.severity === 'high' ? '\u26D4' : a.severity === 'medium' ? '\u26A0\uFE0F' : '\u2139\uFE0F';
            return `${icon} ${a.title}`;
          }).join('\n')
        : '\u2705 No actions needed';

      // Build stats block for both fallback and LLM context
      const statsBlock = [
        `\uD83D\uDC64 Users: ${visitors24h} today \u00B7 ${visitors7d} (7d) \u00B7 ${visitors30d} (30d)`,
        `\uD83D\uDCA1 Sessions: ${sessions} total, ${engaged} engaged`,
        `\u2699\uFE0F Pipeline: ${pStatus}${pipeline.pipelineDuration ? ' \u00B7 ' + fmtDuration(pipeline.pipelineDuration) : ''}`,
        `\uD83D\uDCCD Content: ${pipeline.totalSpots} spots \u00B7 ${roCount} opened \u00B7 ${csCount} coming`,
        pipeline.llmProcessed != null ? `\uD83E\uDD16 LLM: ${pipeline.llmProcessed} processed, ${pipeline.llmErrors ?? 0} errors` : null,
      ].filter(Boolean);

      // Try LLM-generated summary
      let llmSummary = null;
      if (getApiKey()) {
        const summaryData = {
          date: today, pipelineStatus: pStatus, totalSpots: pipeline.totalSpots,
          visitors: { today: visitors24h, week: visitors7d, month: visitors30d },
          sessions: { total: sessions, engaged },
          actions: pipeline.actions.slice(0, 5).map(a => ({ severity: a.severity, title: a.title })),
          confidenceReview: { flagged: pipeline.confidenceFlagged?.length || 0, rejected: pipeline.confidenceRejected?.length || 0, llmAutoApplied: pipeline.llmAutoApplied || 0 },
          recentlyOpened: roCount, comingSoon: csCount,
        };
        const result = await chat({
          messages: [
            { role: 'system', content: 'You are the daily report summarizer for Charleston Finds & Deals, a Charleston SC restaurant/bar deals app. Write a concise 2-3 sentence summary of today\'s report. Be direct, highlight anything unusual or noteworthy. Use plain text, no markdown. Keep it under 280 characters.' },
            { role: 'user', content: JSON.stringify(summaryData) },
          ],
          temperature: 0.3,
          timeoutMs: 30000,
        });
        if (result?.content) llmSummary = result.content.trim();
      }

      const lines = [
        `\uD83D\uDCCA CHS Finds \u2014 ${today}`,
        '',
        llmSummary ? `\uD83D\uDCA1 ${llmSummary}` : null,
        llmSummary ? '' : null,
        `\uD83C\uDFAF ACTIONS (${pipeline.actions.length}):`,
        actionsSummary,
        '',
        ...statsBlock,
        '',
        `\uD83D\uDCCE ${reportUrl}`,
      ].filter(l => l != null);

      const sendRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT, text: lines.join('\n'), disable_web_page_preview: true }),
      });
      const sendData = await sendRes.json();
      if (!sendData.ok) {
        console.warn('  Telegram response:', JSON.stringify(sendData));
      }

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

      console.log('  Telegram notification sent');
    } catch (err) {
      console.error('  Telegram failed:', err.message);
    }
  } else if (sendTelegram) {
    console.warn('  Telegram skipped: missing TELEGRAM_BOT_TOKEN or TELEGRAM_ADMIN_CHAT_ID');
  }

  log('═══ generate-report.js COMPLETE ═══');
  if (_logStream) _logStream.end();
}

main().catch(err => {
  logError(`Report generation failed: ${err.message}`);
  if (_logStream) _logStream.end();
  process.exit(1);
});
