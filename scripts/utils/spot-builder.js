/**
 * Pure helper functions for building spot objects from gold data.
 * Extracted from create-spots.js for testability and reuse.
 */

const fs = require('fs');
const path = require('path');
const { validateGoldEntries } = require('./confidence');

/**
 * Normalize LLM placeholder strings to null.
 */
function normalizeField(val) {
  if (!val || typeof val !== 'string') return null;
  const lower = val.trim().toLowerCase();
  if (lower === 'not specified' || lower === 'unknown' || lower === 'n/a' || lower === '') return null;
  return val.trim();
}

/**
 * Format a single entry's description for display.
 * Returns null if the data is too incomplete to be useful.
 */
function formatDescription(entry) {
  const lines = [];

  if (entry.times || entry.days) {
    const parts = [];
    if (entry.times && entry.times.trim()) parts.push(entry.times.trim());
    if (entry.days && entry.days.trim()) parts.push(entry.days.trim());
    if (parts.length > 0) lines.push(parts.join(' • '));
  }

  if (entry.specials && entry.specials.length > 0) {
    for (const s of entry.specials) {
      if (s && s.trim()) lines.push(s.trim());
    }
  }

  if (lines.length === 1 && entry.times && !entry.days &&
      (!entry.specials || entry.specials.length === 0)) {
    return null;
  }

  if (lines.length === 0 && entry.source) lines.push('Happy Hour details available');
  return lines.length > 0 ? lines.join('\n') : 'Happy Hour available';
}

/**
 * Build time/specials/source fields from a group of entries.
 */
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
        if (!timeParts.includes(timeStr)) timeParts.push(timeStr);
      }
      if (entry.specials && Array.isArray(entry.specials)) {
        const prefix = entries.length > 1 && entry.label ? `[${entry.label}] ` : '';
        allSpecials.push(...entry.specials.map(s => `${prefix}${s}`));
      }
      if (entry.source && !sources.includes(entry.source)) sources.push(entry.source);
    }

    promotionTime = timeParts.length > 0 ? timeParts.join(', ') : null;
    promotionList = allSpecials;
    sourceUrl = sources.length > 0 ? sources[0] : null;
  }

  return { promotionTime, promotionList, sourceUrl };
}

/**
 * Resolve the photo URL for a spot, verifying the file exists on disk.
 */
function resolvePhotoUrl(venueData) {
  if (!venueData.photoUrl) return undefined;
  if (venueData.photoUrl.startsWith('/')) {
    const photoPath = path.join(__dirname, '..', '..', 'public', venueData.photoUrl);
    return fs.existsSync(photoPath) ? venueData.photoUrl : undefined;
  }
  return venueData.photoUrl;
}

/**
 * Create spots from gold data and venue data.
 * Returns { spots, flagged, rejected }.
 */
function createSpotsFromGold(goldData, venueData, startId) {
  const happyHour = goldData.promotions || goldData.happyHour || {};
  const EMPTY = { spots: [], flagged: [], rejected: [] };

  if (!happyHour.found) return EMPTY;

  let entries = [];
  if (happyHour.entries && Array.isArray(happyHour.entries) && happyHour.entries.length > 0) {
    entries = happyHour.entries;
  } else if (happyHour.times || happyHour.days || happyHour.specials) {
    entries = [{ activityType: 'Happy Hour', times: happyHour.times, days: happyHour.days, specials: happyHour.specials || [], source: happyHour.source }];
  } else {
    return EMPTY;
  }

  entries = entries.filter(entry => {
    const times = entry.times && entry.times !== 'Not specified' ? entry.times : null;
    const days = entry.days && entry.days !== 'Not specified' ? entry.days : null;
    const specials = entry.specials && Array.isArray(entry.specials) && entry.specials.length > 0 ? entry.specials : null;
    return times || days || specials;
  });

  const validation = validateGoldEntries(entries);
  entries = validation.kept;
  if (entries.length === 0) return { spots: [], flagged: validation.flagged, rejected: validation.rejected };

  const grouped = {};
  for (const entry of entries) {
    const type = entry.activityType || 'Happy Hour';
    if (!grouped[type]) grouped[type] = [];
    grouped[type].push(entry);
  }

  const spots = [];
  let idOffset = 0;

  for (const [activityType, groupEntries] of Object.entries(grouped)) {
    const { promotionTime, promotionList, sourceUrl } = buildSpotFields(groupEntries);
    if (!promotionTime && (!promotionList || promotionList.length === 0)) continue;

    let description = null;
    if (groupEntries.length === 1) {
      description = formatDescription(groupEntries[0]);
    } else {
      const descs = groupEntries.map(e => formatDescription(e)).filter(Boolean);
      if (descs.length > 0) description = descs.join('\n\n---\n\n');
    }

    spots.push({
      id: startId + idOffset,
      lat: venueData.lat || venueData.geometry?.location?.lat,
      lng: venueData.lng || venueData.geometry?.location?.lng,
      title: goldData.venueName || venueData.name || 'Unknown Venue',
      description,
      promotionTime, promotionList,
      happyHourTime: promotionTime, happyHourList: promotionList,
      sourceUrl: sourceUrl || venueData.website || null,
      lastUpdateDate: goldData.processedAt || null,
      type: activityType,
      area: venueData.area || 'Unknown',
      source: 'automated',
      venueId: goldData.venueId || undefined,
      photoUrl: resolvePhotoUrl(venueData),
    });
    idOffset++;
  }

  return { spots, flagged: validation.flagged, rejected: validation.rejected };
}

/**
 * Build a spot from a single entry resurrected via review approval.
 */
function buildSpotFromEntry(entry, goldData, venueData) {
  const { promotionTime, promotionList, sourceUrl } = buildSpotFields([entry]);
  return {
    id: 0,
    lat: venueData.lat || venueData.geometry?.location?.lat,
    lng: venueData.lng || venueData.geometry?.location?.lng,
    title: goldData.venueName || venueData.name || 'Unknown Venue',
    description: formatDescription(entry),
    promotionTime, promotionList,
    happyHourTime: promotionTime, happyHourList: promotionList,
    sourceUrl: sourceUrl || venueData.website || null,
    lastUpdateDate: goldData.processedAt || null,
    type: entry.activityType || 'Happy Hour',
    area: venueData.area || 'Unknown',
    source: 'automated',
    venueId: goldData.venueId,
  };
}

module.exports = {
  normalizeField,
  formatDescription,
  buildSpotFields,
  createSpotsFromGold,
  buildSpotFromEntry,
  resolvePhotoUrl,
};
