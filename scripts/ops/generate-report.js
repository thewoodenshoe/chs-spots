#!/usr/bin/env node

/**
 * generate-report.js
 *
 * Queries the Umami analytics API and local pipeline data, generates an
 * HTML report, converts it to PDF via Playwright, stores it in the
 * reports directory, and optionally sends a Telegram notification.
 *
 * Usage:
 *   node scripts/ops/generate-report.js [--send-telegram] [--report-dir /var/www/reports]
 *
 * Environment variables:
 *   UMAMI_API_URL     – Umami base URL  (default: http://127.0.0.1:3001)
 *   UMAMI_USERNAME    – Umami admin user (default: admin)
 *   UMAMI_PASSWORD    – Umami admin pass (default: umami)
 *   UMAMI_WEBSITE_ID  – Website ID to query
 *   TELEGRAM_BOT_TOKEN
 *   TELEGRAM_ADMIN_CHAT_ID
 *   SERVER_PUBLIC_URL  – e.g. http://123.45.67.89:8080
 */

const fs = require('fs');
const path = require('path');

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
  const res = await fetch(`${UMAMI_API}/api/websites/${WEBSITE_ID}${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    console.warn(`Umami GET ${endpoint} → ${res.status}`);
    return null;
  }
  return res.json();
}

function dateStr(d) {
  return d.toISOString().split('T')[0];
}

function estNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

// ── Check available LLM models ──────────────────────────────────
async function checkLlmModels() {
  const result = { current: 'unknown', available: [], lastChecked: new Date().toISOString() };

  // Read current model from extract-promotions.js
  const appDir = path.resolve(__dirname, '../..');
  try {
    const src = fs.readFileSync(path.join(appDir, 'scripts/extract-promotions.js'), 'utf8');
    const m = src.match(/GROK_MODEL\s*=\s*['"]([^'"]+)['"]/);
    if (m) result.current = m[1];
  } catch { /* ignore */ }

  // Query xAI models API (if API key available)
  const apiKey = process.env.GROK_API_KEY || '';
  if (apiKey) {
    try {
      const res = await fetch('https://api.x.ai/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.ok) {
        const data = await res.json();
        const models = (data.data || [])
          .filter(m => m.id && /grok/i.test(m.id))
          .map(m => ({ id: m.id, created: m.created ? new Date(m.created * 1000).toISOString().split('T')[0] : 'unknown' }))
          .sort((a, b) => b.created.localeCompare(a.created));
        result.available = models;
      }
    } catch (err) {
      console.warn('  ⚠ LLM model check failed:', err.message);
    }
  }

  return result;
}

// ── Collect local pipeline data ─────────────────────────────────
function getPipelineData() {
  const appDir = path.resolve(__dirname, '../..');
  const result = { llmModel: 'unknown', llmModelSince: 'unknown', totalSpots: 0, spotsByArea: {}, spotsByActivity: {}, lastPipelineRun: 'unknown' };

  // Read LLM model info from extract-promotions.js
  try {
    const extractScript = fs.readFileSync(path.join(appDir, 'scripts/extract-promotions.js'), 'utf8');
    const modelMatch = extractScript.match(/GROK_MODEL\s*=\s*['"]([^'"]+)['"]/);
    if (modelMatch) result.llmModel = modelMatch[1];
  } catch { /* ignore */ }

  // Read spots data
  try {
    const spotsPath = path.join(appDir, 'data/reporting/spots.json');
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
      }
    }
  } catch { /* ignore */ }

  return result;
}

// ── Build HTML report ───────────────────────────────────────────
function buildHtml(analytics, pipelineData) {
  const now = estNow();
  const reportDate = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const reportTime = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });

  // Build analytics sections
  const statsHtml = analytics.stats
    ? `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${analytics.stats.pageviews?.value ?? '–'}</div>
          <div class="stat-label">Pageviews (24h)</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${analytics.stats.visitors?.value ?? '–'}</div>
          <div class="stat-label">Visitors (24h)</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${analytics.stats.visits?.value ?? '–'}</div>
          <div class="stat-label">Sessions (24h)</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${analytics.stats.bounces?.value ?? '–'}</div>
          <div class="stat-label">Bounces (24h)</div>
        </div>
      </div>`
    : '<p class="muted">No analytics data available yet.</p>';

  // Weekly active users
  const weeklyStatsHtml = analytics.weeklyStats
    ? `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${analytics.weeklyStats.visitors?.value ?? '–'}</div>
          <div class="stat-label">Visitors (7d)</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${analytics.weeklyStats.pageviews?.value ?? '–'}</div>
          <div class="stat-label">Pageviews (7d)</div>
        </div>
      </div>`
    : '';

  // Monthly active users
  const monthlyStatsHtml = analytics.monthlyStats
    ? `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${analytics.monthlyStats.visitors?.value ?? '–'}</div>
          <div class="stat-label">Visitors (30d)</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${analytics.monthlyStats.pageviews?.value ?? '–'}</div>
          <div class="stat-label">Pageviews (30d)</div>
        </div>
      </div>`
    : '';

  // Top pages / events
  const eventsHtml = (analytics.events || []).length > 0
    ? `<table>
        <tr><th>Event</th><th>Count</th></tr>
        ${analytics.events.map(e => `<tr><td>${e.eventName || e.x}</td><td>${e.y ?? e.count ?? '–'}</td></tr>`).join('')}
       </table>`
    : '<p class="muted">No custom events recorded yet.</p>';

  // Spots breakdown
  const areaRows = Object.entries(pipelineData.spotsByArea)
    .sort(([, a], [, b]) => b - a)
    .map(([area, count]) => `<tr><td>${area}</td><td>${count}</td></tr>`)
    .join('');

  const activityRows = Object.entries(pipelineData.spotsByActivity)
    .sort(([, a], [, b]) => b - a)
    .map(([activity, count]) => `<tr><td>${activity}</td><td>${count}</td></tr>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CHS Spots – Daily Report</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; color: #1e293b; padding: 16px; max-width: 600px; margin: 0 auto; }
  h1 { font-size: 1.4rem; color: #0d9488; margin-bottom: 4px; }
  h2 { font-size: 1.1rem; color: #334155; margin: 20px 0 8px; border-bottom: 2px solid #e2e8f0; padding-bottom: 4px; }
  .subtitle { font-size: 0.85rem; color: #64748b; margin-bottom: 16px; }
  .stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin: 10px 0; }
  .stat-card { background: #fff; border-radius: 10px; padding: 14px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .stat-value { font-size: 1.6rem; font-weight: 700; color: #0d9488; }
  .stat-label { font-size: 0.75rem; color: #64748b; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 0.85rem; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #e2e8f0; }
  th { background: #f1f5f9; font-weight: 600; }
  .muted { color: #94a3b8; font-style: italic; font-size: 0.85rem; }
  .badge { display: inline-block; background: #dbeafe; color: #1e40af; font-size: 0.75rem; padding: 2px 8px; border-radius: 9999px; font-weight: 600; }
  .model-info { background: #fff; border-radius: 10px; padding: 12px; margin: 8px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .model-info span { font-weight: 600; }
  footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 0.75rem; color: #94a3b8; text-align: center; }
</style>
</head>
<body>
<h1>📊 CHS Spots Daily Report</h1>
<p class="subtitle">${reportDate} at ${reportTime} EST</p>

<h2>📈 Traffic (Last 24 Hours)</h2>
${statsHtml}

<h2>📅 Weekly & Monthly Overview</h2>
${weeklyStatsHtml}
${monthlyStatsHtml}

<h2>🎯 Custom Events</h2>
${eventsHtml}

<h2>🗺️ Spots by Area</h2>
<p class="muted">Total spots: <strong>${pipelineData.totalSpots}</strong></p>
${areaRows ? `<table><tr><th>Area</th><th>Spots</th></tr>${areaRows}</table>` : ''}

<h2>🎉 Spots by Activity</h2>
${activityRows ? `<table><tr><th>Activity</th><th>Spots</th></tr>${activityRows}</table>` : ''}

<h2>🤖 LLM Model Info</h2>
<div class="model-info">
  <p>Current model: <span>${pipelineData.llmModel}</span></p>
  <p>Last pipeline run: <span>${pipelineData.lastPipelineRun}</span></p>
  <p>Model check: <span>${pipelineData.llmModelLastChecked || 'not checked'}</span></p>
</div>
${(pipelineData.llmModelsAvailable || []).length > 0 ? `
<p style="font-size:0.8rem;margin-top:8px;color:#64748b;">Available Grok models (newest first):</p>
<table>
  <tr><th>Model</th><th>Created</th><th>Status</th></tr>
  ${pipelineData.llmModelsAvailable.map(m => `<tr><td>${m.id}</td><td>${m.created}</td><td>${m.id === pipelineData.llmModel ? '<span class="badge">IN USE</span>' : ''}</td></tr>`).join('')}
</table>` : ''}

<footer>Auto-generated by CHS Spots analytics • ${now.toISOString()}</footer>
</body>
</html>`;
}

// ── Main ────────────────────────────────────────────────────────
async function main() {
  console.log('📊 Generating CHS Spots report...');

  // 1. Login to Umami
  let token = null;
  const analytics = { stats: null, weeklyStats: null, monthlyStats: null, events: [] };

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
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    try {
      analytics.stats = await umamiGet(token, `/stats?startAt=${oneDayAgo.getTime()}&endAt=${now.getTime()}`);
    } catch (e) { console.warn('  stats fetch failed:', e.message); }

    try {
      analytics.weeklyStats = await umamiGet(token, `/stats?startAt=${oneWeekAgo.getTime()}&endAt=${now.getTime()}`);
    } catch (e) { console.warn('  weekly stats failed:', e.message); }

    try {
      analytics.monthlyStats = await umamiGet(token, `/stats?startAt=${oneMonthAgo.getTime()}&endAt=${now.getTime()}`);
    } catch (e) { console.warn('  monthly stats failed:', e.message); }

    try {
      const eventsData = await umamiGet(token, `/events?startAt=${oneWeekAgo.getTime()}&endAt=${now.getTime()}&unit=day`);
      analytics.events = Array.isArray(eventsData) ? eventsData : [];
    } catch (e) { console.warn('  events fetch failed:', e.message); }

    console.log('  ✓ Analytics data fetched');
  }

  // 3. Collect pipeline data + LLM model info
  const pipelineData = getPipelineData();
  const llmModels = await checkLlmModels();
  pipelineData.llmModel = llmModels.current;
  pipelineData.llmModelsAvailable = llmModels.available;
  pipelineData.llmModelLastChecked = llmModels.lastChecked;
  console.log(`  ✓ Pipeline data: ${pipelineData.totalSpots} spots, model: ${llmModels.current}, ${llmModels.available.length} models available`);

  // 4. Generate HTML
  const html = buildHtml(analytics, pipelineData);

  // 5. Ensure report directory exists
  fs.mkdirSync(REPORT_DIR, { recursive: true });

  // Save HTML
  const today = dateStr(new Date());
  const htmlPath = path.join(REPORT_DIR, `report-${today}.html`);
  fs.writeFileSync(htmlPath, html);
  console.log(`  ✓ HTML saved: ${htmlPath}`);

  // 6. Try PDF generation (optional – requires playwright)
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
    console.warn(`  ⚠ PDF generation skipped (playwright not available): ${err.message}`);
    console.log('  → Install with: npx playwright install chromium');
  }

  // 7. Send Telegram notification if requested
  if (sendTelegram && TELEGRAM_TOKEN && TELEGRAM_CHAT) {
    try {
      const reportUrl = SERVER_URL ? `${SERVER_URL}/reports/report-${today}.html` : `(local) ${htmlPath}`;
      const lines = [
        `CHS Spots Daily Report - ${today}`,
        '',
        `Visitors (24h): ${analytics.stats?.visitors?.value ?? '-'}`,
        `Pageviews (24h): ${analytics.stats?.pageviews?.value ?? '-'}`,
        `Visitors (7d): ${analytics.weeklyStats?.visitors?.value ?? '-'}`,
        `Total spots: ${pipelineData.totalSpots}`,
        `Model: ${pipelineData.llmModel}`,
        '',
        `Full report: ${reportUrl}`,
      ];

      // Send text message (no Markdown to avoid parse issues)
      const sendRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT,
          text: lines.join('\n'),
          disable_web_page_preview: true,
        }),
      });
      const sendData = await sendRes.json();
      if (!sendData.ok) {
        console.warn('  ⚠ Telegram message response:', JSON.stringify(sendData));
      }

      // If PDF exists, also send as a document using multipart form
      if (pdfPath && fs.existsSync(pdfPath)) {
        const pdfBuffer = fs.readFileSync(pdfPath);
        const boundary = '----FormBoundary' + Date.now().toString(16);
        const fileName = `report-${today}.pdf`;
        const parts = [];
        parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${TELEGRAM_CHAT}`);
        parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\nCHS Spots Report - ${today}`);
        parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${fileName}"\r\nContent-Type: application/pdf\r\n\r\n`);
        const head = Buffer.from(parts.join('\r\n') + '\r\n', 'utf8');
        const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
        const body = Buffer.concat([head, pdfBuffer, tail]);

        const docRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendDocument`, {
          method: 'POST',
          headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
          body,
        });
        const docData = await docRes.json();
        if (!docData.ok) {
          console.warn('  ⚠ Telegram PDF send:', JSON.stringify(docData));
        }
      }

      console.log('  ✓ Telegram notification sent');
    } catch (err) {
      console.error('  ✗ Telegram send failed:', err.message);
    }
  }

  console.log('✅ Report generation complete');
}

main().catch(err => {
  console.error('Report generation failed:', err);
  process.exit(1);
});
