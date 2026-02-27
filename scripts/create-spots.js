/**
 * Create Spots from Gold Extracted Data
 * 
 * Reads gold extractions and venues from the SQLite database to create spots.
 * Only creates spots for venues with promotions.found === true.
 * 
 * Input:
 * - gold_extractions table (extracted happy hour data)
 * - venues table (venue coordinates and metadata)
 * 
 * Output:
 * - spots table (spots for frontend)
 * - data/reporting/spots.json (dual-write for backward compat)
 * 
 * Run with: node scripts/create-spots.js
 */

const fs = require('fs');
const path = require('path');
const db = require('./utils/db');
const { loadConfig } = require('./utils/config');
const { dataPath, reportingPath, configPath, getDataRoot } = require('./utils/data-dir');
const { validateGoldEntries } = require('./utils/confidence');
const { reviewAll } = require('./utils/llm-review');
const { enrichAreas } = require('./utils/llm-enrich');

// Logging setup
const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logPath = path.join(logDir, 'create-spots.log');

fs.writeFileSync(logPath, '', 'utf8');

function log(message) {
  const ts = new Date().toISOString();
  console.log(message);
  fs.appendFileSync(logPath, `[${ts}] ${message}\n`);
}

// Paths — dual-write destinations, kept for backward compat during transition
const REPORTING_VENUES_PATH = reportingPath('venues.json');
const LEGACY_VENUES_PATH = dataPath('venues.json');
const VENUES_PATH = fs.existsSync(REPORTING_VENUES_PATH) ? REPORTING_VENUES_PATH : LEGACY_VENUES_PATH;
const AREAS_PATH = configPath('areas.json');
const REPORTING_DIR = path.join(getDataRoot(), 'reporting');
const SPOTS_PATH = reportingPath('spots.json');
const REPORTING_AREAS_PATH = reportingPath('areas.json');

const RAW_PREVIOUS_DIR = dataPath('raw', 'previous');
const RAW_TODAY_DIR = dataPath('raw', 'today');
const SILVER_MERGED_PREVIOUS_DIR = dataPath('silver_merged', 'previous');
const SILVER_MERGED_TODAY_DIR = dataPath('silver_merged', 'today');
const SILVER_TRIMMED_PREVIOUS_DIR = dataPath('silver_trimmed', 'previous');
const SILVER_TRIMMED_TODAY_DIR = dataPath('silver_trimmed', 'today');
const SILVER_TRIMMED_INCREMENTAL_DIR = dataPath('silver_trimmed', 'incremental');

/**
 * Format happy hour description from gold data
 * Creates a structured description with proper formatting for display
 */
function formatHappyHourDescription(happyHour) {
  const lines = [];
  
  // Time and days together on first line
  if (happyHour.times || happyHour.days) {
    const timeDayParts = [];
    if (happyHour.times && happyHour.times.trim()) {
      timeDayParts.push(happyHour.times.trim());
    }
    if (happyHour.days && happyHour.days.trim()) {
      timeDayParts.push(happyHour.days.trim());
    }
    if (timeDayParts.length > 0) {
      lines.push(timeDayParts.join(' • '));
    }
  }
  
  // Specials as separate lines (one per special)
  if (happyHour.specials && happyHour.specials.length > 0) {
    for (const special of happyHour.specials) {
      if (special && special.trim()) {
        lines.push(special.trim());
      }
    }
  }
  
  // If we only have a time with no days or specials, it's incomplete data
  // Don't create a meaningless description like "2pm"
  if (lines.length === 1 && happyHour.times && !happyHour.days && 
      (!happyHour.specials || happyHour.specials.length === 0)) {
    // This is incomplete - return null to indicate we shouldn't create a spot
    return null;
  }
  
  // If no content but has source, add placeholder
  if (lines.length === 0 && happyHour.source) {
    lines.push('Happy Hour details available');
  }
  
  // Join with newlines (will be preserved in display)
  return lines.length > 0 ? lines.join('\n') : 'Happy Hour available';
}

/**
 * Build time/specials/source from a group of entries for one activity type.
 */
/**
 * Normalize LLM placeholder strings to null.
 */
function normalizeField(val) {
  if (!val || typeof val !== 'string') return null;
  const lower = val.trim().toLowerCase();
  if (lower === 'not specified' || lower === 'unknown' || lower === 'n/a' || lower === '') return null;
  return val.trim();
}

function buildSpotFields(entries) {
  let promotionTime = null;
  let promotionList = [];
  let sourceUrl = null;

  if (entries.length === 1) {
    const entry = entries[0];
    const times = normalizeField(entry.times);
    const days = normalizeField(entry.days);
    if (times) {
      promotionTime = days ? `${times} • ${days}` : times;
    } else if (days) {
      promotionTime = days;
    }
    promotionList = entry.specials || [];
    sourceUrl = entry.source || null;
  } else if (entries.length > 1) {
    const timeParts = [];
    const allSpecials = [];
    const sources = [];

    for (const entry of entries) {
      const times = normalizeField(entry.times);
      const days = normalizeField(entry.days);
      if (times || days) {
        const label = entry.label ? `${entry.label}: ` : '';
        const timeStr = days
          ? `${label}${times || ''} • ${days}`.replace(/^\s*•\s*/, '')
          : `${label}${times}`;
        if (!timeParts.includes(timeStr)) {
          timeParts.push(timeStr);
        }
      }
      if (entry.specials && Array.isArray(entry.specials)) {
        const prefix = entries.length > 1 && entry.label ? `[${entry.label}] ` : '';
        allSpecials.push(...entry.specials.map(s => `${prefix}${s}`));
      }
      if (entry.source && !sources.includes(entry.source)) {
        sources.push(entry.source);
      }
    }

    promotionTime = timeParts.length > 0 ? timeParts.join(', ') : null;
    promotionList = allSpecials;
    sourceUrl = sources.length > 0 ? sources[0] : null;
  }

  return { promotionTime, promotionList, sourceUrl };
}

/**
 * Create spots from gold data and venue data.
 * Returns an ARRAY of spots — one per activity type found.
 * A single venue can produce both a "Happy Hour" spot and a "Brunch" spot.
 *
 * Handles:
 *  - New format with entries[] and activityType per entry
 *  - Old format without activityType (defaults to "Happy Hour")
 *  - Legacy format with direct properties (no entries array)
 */
function createSpots(goldData, venueData, startId) {
  const happyHour = goldData.promotions || goldData.happyHour || {};

  const EMPTY = { spots: [], flagged: [], rejected: [] };

  if (!happyHour.found) {
    return EMPTY;
  }

  // Normalize all formats into an entries array
  let entries = [];
  if (happyHour.entries && Array.isArray(happyHour.entries) && happyHour.entries.length > 0) {
    entries = happyHour.entries;
  } else if (happyHour.times || happyHour.days || happyHour.specials) {
    // Legacy format: direct properties
    entries = [{
      activityType: 'Happy Hour',
      times: happyHour.times,
      days: happyHour.days,
      specials: happyHour.specials || [],
      source: happyHour.source
    }];
  } else {
    return EMPTY;
  }

  // Filter entries with no usable data
  entries = entries.filter(entry => {
    const times = entry.times && entry.times !== 'Not specified' ? entry.times : null;
    const days = entry.days && entry.days !== 'Not specified' ? entry.days : null;
    const specials = entry.specials && Array.isArray(entry.specials) && entry.specials.length > 0 ? entry.specials : null;
    return times || days || specials;
  });

  // Apply heuristic confidence validation
  const validation = validateGoldEntries(entries);
  entries = validation.kept;

  if (entries.length === 0) {
    return { spots: [], flagged: validation.flagged, rejected: validation.rejected };
  }

  // Group entries by activityType (default to "Happy Hour" for backwards compat)
  const grouped = {};
  for (const entry of entries) {
    const activityType = entry.activityType || 'Happy Hour';
    if (!grouped[activityType]) {
      grouped[activityType] = [];
    }
    grouped[activityType].push(entry);
  }

  // Create one spot per activity type
  const spots = [];
  const _flagged = validation.flagged;
  const _rejected = validation.rejected;
  let idOffset = 0;

  for (const [activityType, groupEntries] of Object.entries(grouped)) {
    const { promotionTime, promotionList, sourceUrl } = buildSpotFields(groupEntries);

    // Need at least time or specials to create a spot
    if (!promotionTime && (!promotionList || promotionList.length === 0)) {
      continue;
    }

    // Build backwards-compatible description
    let description = null;
    if (groupEntries.length === 1) {
      description = formatHappyHourDescription(groupEntries[0]);
    } else if (groupEntries.length > 1) {
      const entryDescriptions = groupEntries
        .map(entry => formatHappyHourDescription(entry))
        .filter(desc => desc !== null);
      if (entryDescriptions.length > 0) {
        description = entryDescriptions.join('\n\n---\n\n');
      }
    }

    const spot = {
      id: startId + idOffset,
      lat: venueData.lat || venueData.geometry?.location?.lat,
      lng: venueData.lng || venueData.geometry?.location?.lng,
      title: goldData.venueName || venueData.name || 'Unknown Venue',
      description: description,
      // Generic fields
      promotionTime: promotionTime,
      promotionList: promotionList,
      // Legacy fields (backwards compat)
      happyHourTime: promotionTime,
      happyHourList: promotionList,
      sourceUrl: sourceUrl || venueData.website || null,
      lastUpdateDate: goldData.processedAt || null,
      type: activityType,
      area: venueData.area || 'Unknown',
      source: 'automated',
      venueId: goldData.venueId || undefined,
    };

    // Only set photoUrl if the referenced file actually exists on disk
    if (venueData.photoUrl && venueData.photoUrl.startsWith('/')) {
      const photoPath = path.join(__dirname, '..', 'public', venueData.photoUrl);
      if (fs.existsSync(photoPath)) {
        spot.photoUrl = venueData.photoUrl;
      }
    } else if (venueData.photoUrl) {
      spot.photoUrl = venueData.photoUrl;
    }

    spots.push(spot);
    idOffset++;
  }

  return { spots, flagged: _flagged, rejected: _rejected };
}

/**
 * Build a spot object from a single entry that was resurrected via review approval.
 */
function buildSpotFromEntry(entry, goldData, venueData) {
  const { promotionTime, promotionList, sourceUrl } = buildSpotFields([entry]);
  return {
    id: 0,
    lat: venueData.lat || venueData.geometry?.location?.lat,
    lng: venueData.lng || venueData.geometry?.location?.lng,
    title: goldData.venueName || venueData.name || 'Unknown Venue',
    description: formatHappyHourDescription(entry),
    promotionTime,
    promotionList,
    happyHourTime: promotionTime,
    happyHourList: promotionList,
    sourceUrl: sourceUrl || venueData.website || null,
    lastUpdateDate: goldData.processedAt || null,
    type: entry.activityType || 'Happy Hour',
    area: venueData.area || 'Unknown',
    source: 'automated',
    venueId: goldData.venueId,
  };
}

/**
 * Main function
 */
async function main() {
  log('🔄 Creating Spots from Gold Data\n');

  db.ensureSchema();

  // Ensure reporting directory exists (for dual-write during transition)
  if (!fs.existsSync(REPORTING_DIR)) {
    fs.mkdirSync(REPORTING_DIR, { recursive: true });
    log(`📁 Created reporting directory: ${REPORTING_DIR}\n`);
  }

  // ── Load venues from DB ───────────────────────────────────────
  const venueRows = db.venues.getAll();
  if (venueRows.length === 0) {
    log('❌ No venues found in database');
    log('   Run seed-venues.js first');
    process.exit(1);
  }

  const venueMap = new Map();
  for (const row of venueRows) {
    venueMap.set(row.id, { ...row, photoUrl: row.photo_url });
  }
  log(`📁 Loaded ${venueRows.length} venue(s) from database\n`);

  // Helper: map a DB spot row to the camelCase shape the pipeline expects
  function mapSpotFromDb(row) {
    const venue = venueMap.get(row.venue_id);
    return {
      id: row.id,
      lat: venue?.lat,
      lng: venue?.lng,
      venueId: row.venue_id,
      title: row.title,
      type: row.type,
      source: row.source,
      status: row.status,
      area: venue?.area || 'Unknown',
      description: row.description,
      promotionTime: row.promotion_time,
      promotionList: row.promotion_list ? JSON.parse(row.promotion_list) : [],
      happyHourTime: row.promotion_time,
      happyHourList: row.promotion_list ? JSON.parse(row.promotion_list) : [],
      sourceUrl: row.source_url,
      manualOverride: !!row.manual_override,
      photoUrl: row.photo_url || venue?.photo_url,
      lastUpdateDate: row.last_update_date,
    };
  }

  // ── Load gold extractions from DB ─────────────────────────────
  const goldRows = db.gold.getAll();
  log(`📁 Found ${goldRows.length} gold extraction(s) in database\n`);

  if (goldRows.length === 0) {
    log('⚠️  No gold extractions found.');
    db.spots.deleteAutomated();
    const remaining = db.spots.getAll().map(mapSpotFromDb);
    fs.writeFileSync(SPOTS_PATH, JSON.stringify(remaining, null, 2), 'utf8');
    log('\n✨ Done! No automated spots created.');
    return;
  }

  // ── Load existing spots from DB for comparison / preservation ─
  const existingSpotRows = db.spots.getAll();
  const existingSpots = existingSpotRows.map(mapSpotFromDb);

  const manualSpots = existingSpots.filter(s => s.source === 'manual');
  const overriddenSpots = existingSpots.filter(s => s.source === 'automated' && s.manualOverride);
  const overriddenKeys = new Set(overriddenSpots.map(s => `${s.venueId}::${s.type}`));

  const pendingActionSpots = db.spots.getPendingActionSpots();
  const pendingKeys = new Set();
  for (const ps of pendingActionSpots) {
    if (ps.venue_id && ps.type) pendingKeys.add(`${ps.venue_id}::${ps.type}`);
  }
  if (pendingActionSpots.length > 0) {
    log(`⏳ Found ${pendingActionSpots.length} spot(s) with pending user actions — will be preserved`);
  }

  if (manualSpots.length > 0) {
    log(`📋 Found ${manualSpots.length} manual spot(s) — will be preserved`);
  }
  if (overriddenSpots.length > 0) {
    log(`✏️  Found ${overriddenSpots.length} user-edited automated spot(s) — will be preserved`);
  }

  // ── Load confidence review decisions ─────────────────────────
  const reviewMap = db.confidenceReviews.getDecisionMap();
  const goldSourceHashes = new Map();
  for (const row of goldRows) {
    goldSourceHashes.set(row.venue_id, row.source_hash || row.normalized_source_hash);
  }
  if (reviewMap.size > 0) {
    log(`📋 Loaded ${reviewMap.size} existing confidence review(s)\n`);
  }

  // ── Build new automated spots ─────────────────────────────────
  const newAutomatedSpots = [];
  let processed = 0;
  let skipped = 0;
  let missingVenue = 0;
  let noHappyHour = 0;
  let incompleteData = 0;
  const allFlagged = [];
  const allRejected = [];
  let reviewApprovedCount = 0;
  let reviewRejectedCount = 0;

  const excludedIds = db.watchlist.getExcludedIds();
  let excludedCount = 0;

  const seenKeys = new Set([...overriddenKeys, ...pendingKeys]);

  for (const row of goldRows) {
    try {
      const goldData = {
        venueId: row.venue_id,
        venueName: row.venue_name,
        promotions: typeof row.promotions === 'string' ? JSON.parse(row.promotions) : row.promotions,
        processedAt: row.processed_at,
      };

      const venueId = goldData.venueId;
      if (!venueId) {
        skipped++;
        log('  ⚠️  Skipping: Missing venueId in gold extraction');
        continue;
      }

      const venueData = venueMap.get(venueId);
      if (!venueData) {
        missingVenue++;
        log(`  ⚠️  Skipping: Venue not found in database: ${venueId}`);
        continue;
      }

      if (excludedIds.has(venueId)) {
        excludedCount++;
        continue;
      }

      const promoData = goldData.promotions || {};
      if (!promoData.found) {
        noHappyHour++;
        continue;
      }

      const result = createSpots(goldData, venueData, 0);
      const sourceHash = goldSourceHashes.get(venueId);

      // Check existing reviews for rejected entries — approved reviews resurrect them
      for (const r of result.rejected) {
        const reviewKey = `${venueId}::${r.activityType || 'Happy Hour'}`;
        const review = reviewMap.get(reviewKey);
        const hashMatch = review && review.reviewed_source_hash === sourceHash;

        if (review && hashMatch && review.decision === 'approved') {
          log(`  ✅ Review-approved (was rejected): ${goldData.venueName} [${r.activityType}]`);
          result.spots.push(buildSpotFromEntry(r, goldData, venueData));
          reviewApprovedCount++;
        } else if (review && hashMatch && review.decision === 'rejected') {
          reviewRejectedCount++;
        } else {
          log(`  🚫 Rejected: ${goldData.venueName} [${r.activityType}] — confidence ${r.effectiveConfidence} (${r.confidenceFlags.join(', ')})`);
          allRejected.push({ venue: goldData.venueName, venueId, sourceHash, ...r });
        }
      }

      // Check existing reviews for flagged entries
      for (const f of result.flagged) {
        const reviewKey = `${venueId}::${f.activityType || 'Happy Hour'}`;
        const review = reviewMap.get(reviewKey);
        const hashMatch = review && review.reviewed_source_hash === sourceHash;

        if (review && hashMatch) {
          if (review.decision === 'approved') {
            reviewApprovedCount++;
          } else {
            reviewRejectedCount++;
            // Remove from kept list — review says reject
            result.spots = result.spots.filter(s => s.type !== f.activityType);
          }
        } else {
          log(`  ⚠️  Flagged for review: ${goldData.venueName} [${f.activityType}] — confidence ${f.effectiveConfidence} (${f.confidenceFlags.join(', ')})`);
          allFlagged.push({ venue: goldData.venueName, venueId, sourceHash, ...f });
        }
      }

      if (result.spots.length > 0) {
        for (const spot of result.spots) {
          const key = `${venueId}::${spot.type}`;

          if (seenKeys.has(key)) {
            skipped++;
            if (overriddenKeys.has(key)) {
              log(`  ⏭️  Skipping ${spot.title} [${spot.type}] — user-edited override preserved`);
            }
            continue;
          }

          if (!spot.lat || !spot.lng) {
            log(`  ⚠️  Skipping: Missing coordinates for ${goldData.venueName} (${venueId})`);
            skipped++;
            continue;
          }

          seenKeys.add(key);
          newAutomatedSpots.push(spot);
          processed++;
          log(`  ✅ Created spot: ${spot.title} [${spot.type}]`);
        }
      } else {
        incompleteData++;
      }

    } catch (error) {
      log(`  ❌ Error processing gold extraction for ${row.venue_id}: ${error.message}`);
      skipped++;
    }
  }

  if (reviewApprovedCount > 0 || reviewRejectedCount > 0) {
    log(`\n📋 Review decisions applied: ${reviewApprovedCount} approved, ${reviewRejectedCount} rejected`);
  }

  // Staleness detection: check if upstream gold data changed or vanished for overridden spots
  const staleOverrides = [];
  const goldVenueIds = new Set(goldRows.map(r => r.venue_id));
  for (const spot of overriddenSpots) {
    if (!spot.venueId) continue;
    const goldRow = goldRows.find(r => r.venue_id === spot.venueId);
    if (!goldRow) {
      staleOverrides.push({ spot, reason: 'upstream gold extraction no longer exists' });
      continue;
    }
    const promoData = typeof goldRow.promotions === 'string' ? JSON.parse(goldRow.promotions) : goldRow.promotions;
    if (!promoData?.found) {
      staleOverrides.push({ spot, reason: 'upstream venue no longer reports promotions' });
      continue;
    }
    const entries = promoData.entries || [];
    const hasMatchingType = entries.some(e => (e.activityType || 'Happy Hour') === spot.type);
    if (!hasMatchingType && promoData.times === undefined) {
      staleOverrides.push({ spot, reason: `upstream no longer has ${spot.type} data` });
    }
  }
  if (staleOverrides.length > 0) {
    log(`\n⚠️  ${staleOverrides.length} overridden spot(s) may be stale:`);
    for (const { spot, reason } of staleOverrides) {
      log(`   📌 ${spot.title} [${spot.type}] — ${reason}`);
    }
  }

  // ── Detect content changes vs previous spots (streak tracking) ─
  const oldSpotMap = new Map();
  for (const s of existingSpots) {
    if (s.source === 'automated' && s.venueId) {
      oldSpotMap.set(`${s.venueId}::${s.type}`, s);
    }
  }

  const todayStr = new Date().toISOString().split('T')[0];
  const updatedSpotNames = [];

  for (const spot of newAutomatedSpots) {
    if (!spot.venueId) continue;
    const key = `${spot.venueId}::${spot.type}`;
    const old = oldSpotMap.get(key);
    const isContentChange = !old
      || spot.promotionTime !== old.promotionTime
      || JSON.stringify(spot.promotionList) !== JSON.stringify(old.promotionList);

    if (isContentChange) {
      const prev = db.streaks.get(spot.venueId, spot.type);
      let newStreak = 1;
      if (prev && prev.last_date) {
        const prevDate = new Date(prev.last_date);
        const today = new Date(todayStr);
        const diffDays = Math.round((today - prevDate) / 86400000);
        newStreak = diffDays <= 1 ? (prev.streak || 0) + 1 : 1;
      }
      db.streaks.upsert(spot.venueId, spot.type, `${spot.title} [${spot.type}]`, todayStr, newStreak);
      updatedSpotNames.push(`${spot.title} [${spot.type}]`);
      log(`  🔄 Updated spot: ${spot.title} [${spot.type}]`);
    }
  }

  log(`\n📈 Content changes this run: ${updatedSpotNames.length}`);

  // ── Write to DB: atomic delete + insert in a transaction ──
  // Only delete types this script manages (from gold extractions), not types from other scripts
  const managedTypes = [...new Set(newAutomatedSpots.map(s => s.type))];
  if (managedTypes.length === 0) managedTypes.push('Happy Hour', 'Brunch');
  log(`\n🔄 Managed types: ${managedTypes.join(', ')}`);
  const { deletedCount } = db.transaction(() => {
    const deletedCount = db.spots.deleteAutomated(managedTypes);
    for (const spot of newAutomatedSpots) {
      const newId = db.spots.insert(spot);
      spot.id = newId;
    }
    return { deletedCount };
  });
  log(`🗑️  Cleared ${deletedCount} old automated spot(s) of types [${managedTypes.join(', ')}] from database`);
  log(`💾 Inserted ${newAutomatedSpots.length} automated spot(s) into database`);

  // Safety net: backfill any spots that ended up without an area from their venue
  try {
    const d = db.getDb();
    const fixed = d.prepare(
      "UPDATE spots SET area = (SELECT v.area FROM venues v WHERE v.id = spots.venue_id) " +
      "WHERE (area IS NULL OR area = '' OR area = 'Unknown') AND venue_id IS NOT NULL " +
      "AND EXISTS (SELECT 1 FROM venues v WHERE v.id = spots.venue_id AND v.area IS NOT NULL AND v.area != '')",
    ).run();
    if (fixed.changes > 0) {
      log(`🔧 Area backfill: fixed ${fixed.changes} spot(s) with missing area from venue data`);
    }
  } catch (err) {
    log(`  ⚠️  Area backfill check failed: ${err.message}`);
  }

  // LLM-powered area enrichment for spots still missing an area
  try {
    const apiKey = process.env.GROK_API_KEY;
    if (apiKey) {
      const d = db.getDb();
      const missingArea = d.prepare(
        "SELECT s.id, s.title as name, s.lat, s.lng, v.address " +
        "FROM spots s LEFT JOIN venues v ON v.id = s.venue_id " +
        "WHERE (s.area IS NULL OR s.area = '' OR s.area = 'Unknown') LIMIT 50",
      ).all();
      if (missingArea.length > 0) {
        const validAreas = db.areas.getNames();
        log(`🤖 LLM area enrichment: ${missingArea.length} spot(s) missing area...`);
        const enriched = await enrichAreas(missingArea, validAreas, apiKey, log);
        if (enriched.length > 0) {
          const updateStmt = d.prepare('UPDATE spots SET area = ? WHERE id = ?');
          for (const e of enriched) {
            updateStmt.run(e.area, e.id);
          }
          log(`  ✅ LLM assigned areas to ${enriched.length} spot(s)`);
        }
      }
    }
  } catch (err) {
    log(`  ⚠️  LLM area enrichment failed: ${err.message}`);
  }

  // Complete in-memory spots array: re-read from DB to include all preserved spots
  const allDbSpots = db.spots.getAll().map(mapSpotFromDb);
  const spots = allDbSpots;

  // ── Dual-write: spots.json (backward compat during transition) ─
  fs.writeFileSync(SPOTS_PATH, JSON.stringify(spots, null, 2), 'utf8');
  log(`\n✅ Created ${SPOTS_PATH}`);

  // Dual-write: copy venues.json and areas.json to reporting folder
  if (fs.existsSync(VENUES_PATH)) {
    fs.copyFileSync(VENUES_PATH, REPORTING_VENUES_PATH);
    log(`✅ Copied venues.json to ${REPORTING_VENUES_PATH}`);
  }
  if (fs.existsSync(AREAS_PATH)) {
    fs.copyFileSync(AREAS_PATH, REPORTING_AREAS_PATH);
    log(`✅ Copied areas.json to ${REPORTING_AREAS_PATH}`);
  }

  // Summary
  const existingAutomatedCount = existingSpots.filter(s => s.source === 'automated').length;
  const totalAutomatedCount = spots.filter(s => s.source === 'automated').length;
  
  // Get pipeline state and file counts
  const config = loadConfig();
  const todayDate = config.run_date || 'N/A';
  const previousDate = config.last_raw_processed_date || 'N/A';
  
  // Helper function to count directories (for raw) or files (for silver layers)
  function countDirectories(dirPath) {
    if (!fs.existsSync(dirPath)) return 0;
    try {
      return fs.readdirSync(dirPath).filter(item => {
        const itemPath = path.join(dirPath, item);
        return fs.statSync(itemPath).isDirectory();
      }).length;
    } catch {
      return 0;
    }
  }
  
  function countFiles(dirPath) {
    if (!fs.existsSync(dirPath)) return 0;
    try {
      return fs.readdirSync(dirPath).filter(item => {
        const itemPath = path.join(dirPath, item);
        return fs.statSync(itemPath).isFile() && item.endsWith('.json');
      }).length;
    } catch {
      return 0;
    }
  }
  
  const rawPreviousCount = countDirectories(RAW_PREVIOUS_DIR);
  const rawTodayCount = countDirectories(RAW_TODAY_DIR);
  // Note: raw/incremental/ and silver_merged/incremental/ are no longer used
  const rawIncrementalCount = 0; // Obsolete - not used anymore
  const silverMergedPreviousCount = countFiles(SILVER_MERGED_PREVIOUS_DIR);
  const silverMergedTodayCount = countFiles(SILVER_MERGED_TODAY_DIR);
  const silverMergedIncrementalCount = 0; // Obsolete - not used anymore
  const silverTrimmedPreviousCount = countFiles(SILVER_TRIMMED_PREVIOUS_DIR);
  const silverTrimmedTodayCount = countFiles(SILVER_TRIMMED_TODAY_DIR);
  const silverTrimmedIncrementalCount = countFiles(SILVER_TRIMMED_INCREMENTAL_DIR);
  
  log(`\n📅 Pipeline State:`);
  log(`   📆 Today's date: ${todayDate}`);
  log(`   📆 Previous date: ${previousDate}`);
  log(`   📁 Raw previous count: ${rawPreviousCount}`);
  log(`   📁 Raw today count: ${rawTodayCount}`);
  log(`   📁 Raw incremental count: ${rawIncrementalCount}`);
  log(`   📦 Silver merged previous count: ${silverMergedPreviousCount}`);
  log(`   📦 Silver merged today count: ${silverMergedTodayCount}`);
  log(`   📦 Silver merged incremental count: ${silverMergedIncrementalCount}`);
  log(`   ✂️  Silver trimmed previous count: ${silverTrimmedPreviousCount}`);
  log(`   ✂️  Silver trimmed today count: ${silverTrimmedTodayCount}`);
  log(`   ✂️  Silver trimmed incremental count: ${silverTrimmedIncrementalCount}`);
  
  // ── LLM review for unreviewed flagged/rejected entries ───────
  const unreviewedEntries = [...allFlagged, ...allRejected];
  let llmAutoApplied = 0;
  let llmNeedsHuman = 0;
  const remainingFlagged = [];
  const remainingRejected = [];

  if (unreviewedEntries.length > 0) {
    const apiKey = process.env.GROK_API_KEY;
    if (apiKey) {
      log(`\n🤖 Running LLM review on ${unreviewedEntries.length} unreviewed entries...`);
      const llmResult = await reviewAll(unreviewedEntries, apiKey, log);

      for (const item of llmResult.autoApplied) {
        const venueId = item.venueId;
        const actType = item.activityType || 'Happy Hour';
        db.confidenceReviews.upsert({
          venue_id: venueId,
          activity_type: actType,
          decision: item.llmDecision === 'approve' ? 'approved' : 'rejected',
          reason: item.llmReasoning,
          reviewed_source_hash: item.sourceHash || goldSourceHashes.get(venueId),
          effective_confidence: item.effectiveConfidence,
          flags: item.confidenceFlags,
          source: 'llm',
          llm_confidence: item.llmReviewConfidence,
        });
        log(`  🤖 LLM auto-${item.llmDecision}: ${item.venue} [${actType}] (confidence: ${item.llmReviewConfidence})`);
        llmAutoApplied++;
      }

      for (const item of llmResult.needsHumanReview) {
        const wasFlagged = allFlagged.some(f => f.venueId === item.venueId && f.activityType === item.activityType);
        if (wasFlagged) {
          remainingFlagged.push(item);
        } else {
          remainingRejected.push(item);
        }
      }
      llmNeedsHuman = llmResult.needsHumanReview.length;

      log(`  📊 LLM review: ${llmAutoApplied} auto-applied, ${llmNeedsHuman} need human review, ${llmResult.errors} errors`);
    } else {
      log('\n⚠️  GROK_API_KEY not set — skipping LLM review, all flags go to report');
      remainingFlagged.push(...allFlagged);
      remainingRejected.push(...allRejected);
    }
  }

  // ── Write confidence review data (only unreviewed items) ────
  const reviewPath = reportingPath('confidence-review.json');
  const mapEntry = (e) => ({
    venue: e.venue, venueId: e.venueId, type: e.activityType,
    label: e.label, times: e.times, days: e.days,
    llmConfidence: e.confidence, effectiveConfidence: e.effectiveConfidence,
    flags: e.confidenceFlags,
    llmDecision: e.llmDecision || null,
    llmReviewConfidence: e.llmReviewConfidence || null,
    llmReasoning: e.llmReasoning || null,
  });
  const reviewFileData = {
    generatedAt: new Date().toISOString(),
    flagged: remainingFlagged.map(mapEntry),
    rejected: remainingRejected.map(mapEntry),
    staleOverrides: staleOverrides.map(({ spot, reason }) => ({
      venue: spot.title, venueId: spot.venueId, type: spot.type, reason,
    })),
    llmAutoApplied,
    reviewsInDb: reviewMap.size + llmAutoApplied,
  };
  fs.writeFileSync(reviewPath, JSON.stringify(reviewFileData, null, 2), 'utf8');
  log(`\n📋 Confidence review: ${remainingFlagged.length} flagged, ${remainingRejected.length} rejected → ${reviewPath}`);
  if (llmAutoApplied > 0) log(`   🤖 ${llmAutoApplied} resolved by LLM (not in report)`);
  if (reviewApprovedCount + reviewRejectedCount > 0) {
    log(`   📋 ${reviewApprovedCount + reviewRejectedCount} resolved by prior reviews (not in report)`);
  }

  log(`\n📊 Summary:`);
  log(`   ✅ New automated spots created: ${processed}`);
  log(`   📋 Existing automated spots preserved: ${existingAutomatedCount}`);
  log(`   👤 Manual spots preserved: ${manualSpots.length}`);
  log(`   ⚠️  Skipped (already exists): ${skipped}`);
  if (excludedCount > 0) log(`   🚫 Excluded (watchlist): ${excludedCount}`);
  log(`   ❌ Missing venue data: ${missingVenue}`);
  log(`   ℹ️  No happy hour: ${noHappyHour}`);
  log(`   📋 Incomplete data: ${incompleteData} (time only, no days/specials)`);
  if (allRejected.length > 0) log(`   🚫 Rejected (heuristic): ${allRejected.length}`);
  if (allFlagged.length > 0) log(`   ⚠️  Flagged (heuristic): ${allFlagged.length}`);
  if (llmAutoApplied > 0) log(`   🤖 LLM auto-resolved: ${llmAutoApplied}`);
  if (llmNeedsHuman > 0) log(`   👤 Needs human review: ${llmNeedsHuman}`);
  log(`   📄 Total spots in spots.json: ${spots.length} (${manualSpots.length} manual + ${totalAutomatedCount} automated)`);
  log(`\n✨ Done!`);
  log(`   Total spots: ${spots.length} (${manualSpots.length} manual + ${totalAutomatedCount} automated)`);
}

main().catch(error => {
  log(`❌ Fatal error: ${error.message || error}`);
  console.error(error);
  process.exit(1);
});
