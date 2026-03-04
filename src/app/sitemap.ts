import type { MetadataRoute } from 'next';
import { areasDb, activitiesDb, spots, venues } from '@/lib/db';
import { slugify } from '@/utils/seo-helpers';

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [
    {
      url: 'https://chsfinds.com',
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: 'https://chsfinds.com/privacy',
      lastModified: new Date('2026-02-01'),
      changeFrequency: 'yearly',
      priority: 0.3,
    },
  ];

  try {
    const areas = areasDb.getNames();
    const activities = activitiesDb.getAll().filter(a => !a.hidden).map(a => a.name);
    const allSpots = spots.getAll({ visibleOnly: true });
    const allVenues = venues.getAll();

    const venueMap = new Map<string, (typeof allVenues)[0]>();
    for (const v of allVenues) venueMap.set(v.id, v);

    for (const area of areas) {
      for (const activity of activities) {
        const matching = allSpots.filter(s => {
          if (s.type !== activity) return false;
          const v = s.venue_id ? venueMap.get(s.venue_id) : undefined;
          return (v?.area || s.area) === area;
        });

        if (matching.length === 0) continue;

        const latest = matching.reduce((max, s) => {
          const d = s.last_update_date || s.updated_at;
          return d > max ? d : max;
        }, '');

        entries.push({
          url: `https://chsfinds.com/explore/${slugify(activity)}-in-${slugify(area)}`,
          lastModified: latest ? new Date(latest) : new Date(),
          changeFrequency: 'daily',
          priority: 0.7,
        });
      }
    }

    for (const spot of allSpots) {
      entries.push({
        url: `https://chsfinds.com/spots/${spot.id}`,
        lastModified: spot.last_update_date ? new Date(spot.last_update_date) : new Date(spot.updated_at),
        changeFrequency: 'weekly',
        priority: 0.6,
      });
    }

    const spotsByVenue = new Map<string, boolean>();
    for (const s of allSpots) {
      if (s.venue_id) spotsByVenue.set(s.venue_id, true);
    }
    for (const v of allVenues) {
      if (spotsByVenue.has(v.id)) {
        entries.push({
          url: `https://chsfinds.com/venues/${encodeURIComponent(v.id)}`,
          lastModified: new Date(v.updated_at),
          changeFrequency: 'weekly',
          priority: 0.5,
        });
      }
    }
  } catch {
    // DB not available during build — return base entries only
  }

  return entries;
}
