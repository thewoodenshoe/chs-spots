/**
 * Shared constants and helpers for explore pages and SSR spot display.
 */

export const AREA_DESCRIPTIONS: Record<string, string> = {
  'Downtown Charleston': 'The heart of the Holy City, where historic charm meets modern dining along King Street and the surrounding blocks.',
  'Mount Pleasant': 'A family-friendly area across the Ravenel Bridge with waterfront dining, Shem Creek eateries, and local favorites.',
  'West Ashley': 'A diverse neighborhood with a mix of casual spots, hidden gems, and locally owned restaurants along Savannah Highway.',
  'James Island': 'A laid-back island community with beach bars, neighborhood restaurants, and outdoor-friendly venues near Folly Beach.',
  'North Charleston': 'An up-and-coming food scene with breweries, diverse cuisines, and great value spots along Park Circle and Rivers Avenue.',
  'Daniel Island': 'An upscale planned community with polished restaurants, waterfront dining, and a vibrant town center.',
  'Sullivan\'s Island': 'A charming beach town with iconic casual eateries and sunset views just minutes from downtown.',
  'Isle of Palms': 'A resort island with oceanfront dining, seafood spots, and a relaxed vacation vibe.',
  'Folly Beach': 'Charleston\'s bohemian beach town, known for surf culture, live music, and casual waterfront bars.',
  'Johns Island': 'A rural gem with farm-to-table restaurants, roadside stands, and rustic Southern dining.',
};

export const ACTIVITY_TIPS: Record<string, string> = {
  'Happy Hour': 'Most happy hours in Charleston run weekdays between 4-7pm. Many spots extend hours on Thursdays. Always check for seasonal changes.',
  'Brunch': 'Weekend brunch is a Charleston tradition. Peak hours are 10am-1pm — arrive early or expect a wait at popular spots. Some venues offer weekday brunch too.',
  'Live Music': 'Charleston has a thriving live music scene every night of the week. Check venue schedules for showtimes, which are typically updated each Monday.',
  'Coffee Shops': 'Charleston coffee culture blends specialty roasters with cozy neighborhood cafes. Most open by 7am and are perfect for remote work.',
  'Rooftop Bars': 'Rooftop bars are busiest at sunset. Some require reservations, especially on weekends. Dress codes may apply at upscale locations.',
  'Dog-Friendly': 'Charleston is very dog-friendly. Many patios and outdoor areas welcome well-behaved dogs. Always confirm current pet policy before visiting.',
  'Recently Opened': 'New restaurants open regularly in Charleston. We track openings as they happen and verify details within 48 hours of discovery.',
  'Coming Soon': 'These spots have been announced but haven\'t opened yet. We monitor progress and update listings as opening dates are confirmed.',
  'Landmarks & Attractions': 'Charleston\'s historic landmarks span over 350 years of history. Most are walkable from the downtown area.',
  'Must-See Spots': 'A curated collection of Charleston\'s essential experiences — from historic sites to iconic eateries and hidden gems worth the trip.',
};

export const STATUS_TYPE_MAP: Record<string, string> = {
  'Coming Soon': 'coming_soon',
  'Recently Opened': 'recently_opened',
};

function formatAmPm(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  const hour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m ? `${hour}:${String(m).padStart(2, '0')}${suffix}` : `${hour}${suffix}`;
}

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function formatSchedule(spot: {
  time_start?: string | null;
  time_end?: string | null;
  days?: string | null;
  promotion_time?: string | null;
}): string | null {
  const parts: string[] = [];
  if (spot.time_start) {
    const start = formatAmPm(spot.time_start);
    const end = spot.time_end ? formatAmPm(spot.time_end) : null;
    parts.push(end ? `${start}–${end}` : start);
  }
  if (spot.days) {
    const nums = spot.days.split(',').map(Number).sort();
    if (nums.length === 7) parts.push('Daily');
    else if (nums.length === 5 && nums.every((d, i) => d === i + 1)) parts.push('Mon–Fri');
    else if (nums.length === 2 && nums[0] === 0 && nums[1] === 6) parts.push('Sat & Sun');
    else parts.push(nums.map(d => DAY_ABBR[d]).join(', '));
  }
  if (parts.length > 0) return parts.join(' · ');
  return spot.promotion_time || null;
}
