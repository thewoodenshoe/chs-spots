/**
 * Pure helper functions for building spot objects from gold data.
 * Extracted from create-spots.js for testability and reuse.
 */

const fs = require('fs');
const path = require('path');
const { validateGoldEntries } = require('./confidence');
const { normalizeField, buildSpotFields } = require('./spot-time-fields');

/**
 * Format a single entry's description for display.
 * Returns null if the data is too incomplete to be useful.
 */
function formatDescription(entry) {
  const lines = [];

  const timePart = entry.times
    || (entry.time_start && entry.time_end ? `${entry.time_start}-${entry.time_end}` : null);
  const dayPart = entry.days || null;

  if (timePart || dayPart) {
    const parts = [];
    if (timePart) parts.push(timePart.trim ? timePart.trim() : timePart);
    if (dayPart) parts.push(typeof dayPart === 'string' && dayPart.trim ? dayPart.trim() : String(dayPart));
    if (parts.length > 0) lines.push(parts.join(' • '));
  }

  if (entry.specials && entry.specials.length > 0) {
    for (const s of entry.specials) {
      if (s && s.trim()) lines.push(s.trim());
    }
  }

  if (lines.length === 1 && timePart && !dayPart &&
      (!entry.specials || entry.specials.length === 0)) {
    return null;
  }

  if (lines.length === 0 && entry.source) lines.push('Happy Hour details available');
  return lines.length > 0 ? lines.join('\n') : 'Happy Hour available';
}

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
    const hasStructuredTimes = entry.time_start || entry.time_end;
    const days = entry.days && entry.days !== 'Not specified' ? entry.days : null;
    const specials = entry.specials && Array.isArray(entry.specials) && entry.specials.length > 0 ? entry.specials : null;
    return times || hasStructuredTimes || days || specials;
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
    const { promotionTime, promotionList, sourceUrl, timeStart, timeEnd, days } = buildSpotFields(groupEntries);
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
      timeStart, timeEnd, days,
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

function buildSpotFromEntry(entry, goldData, venueData) {
  const { promotionTime, promotionList, sourceUrl, timeStart, timeEnd, days } = buildSpotFields([entry]);
  return {
    id: 0,
    lat: venueData.lat || venueData.geometry?.location?.lat,
    lng: venueData.lng || venueData.geometry?.location?.lng,
    title: goldData.venueName || venueData.name || 'Unknown Venue',
    description: formatDescription(entry),
    promotionTime, promotionList,
    timeStart, timeEnd, days,
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
