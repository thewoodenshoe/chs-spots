'use strict';

/**
 * Shared upsert module — writes approved spots to DB with safety checks.
 * NEVER clears stale data if the acquisition step returned an LLM error.
 */
function upsertSpots({ approved, staleIds, acquireError, todayDate, type }, { db, log }) {
  let updated = 0;
  let created = 0;
  let staleCleared = 0;

  for (const item of approved) {
    const existing = db.getDb().prepare(
      'SELECT id FROM spots WHERE venue_id = ? AND type = ? AND status = ?',
    ).get(item.venue_id, type, 'approved');

    if (existing) {
      db.spots.update(existing.id, {
        title: item.title,
        description: item.description || null,
        promotion_time: item.promotion_time || null,
        time_start: item.time_start,
        time_end: item.time_end,
        days: item.days || null,
        specific_date: item.specific_date || null,
        last_update_date: todayDate,
      });
      updated++;
      log(`[upsert] UPDATED: ${item.title}`);
    } else {
      db.spots.insert({
        venue_id: item.venue_id, title: item.title, type,
        source: 'automated', status: 'approved',
        description: item.description || null,
        promotion_time: item.promotion_time || null,
        time_start: item.time_start, time_end: item.time_end,
        days: item.days || null, specific_date: item.specific_date || null,
        last_update_date: todayDate,
      });
      created++;
      log(`[upsert] CREATED: ${item.title}`);
    }
  }

  if (acquireError) {
    log('[upsert] SAFETY: LLM error in acquisition — skipping stale clearing');
  } else if (staleIds && staleIds.length > 0) {
    for (const id of staleIds) {
      db.spots.update(id, {
        promotion_time: null, time_start: null, time_end: null,
        days: null, specific_date: null, description: null,
      });
      staleCleared++;
    }
    log(`[upsert] Cleared ${staleCleared} stale spot(s)`);
  }

  log(`[upsert] Done: ${updated} updated, ${created} created, ${staleCleared} cleared`);
  return { updated, created, staleCleared };
}

module.exports = { upsertSpots };
