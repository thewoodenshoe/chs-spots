import type { MetadataRoute } from 'next';
import { areasDb, activitiesDb } from '@/lib/db';

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

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

    for (const area of areas) {
      for (const activity of activities) {
        entries.push({
          url: `https://chsfinds.com/explore/${slugify(activity)}-in-${slugify(area)}`,
          lastModified: new Date(),
          changeFrequency: 'weekly',
          priority: 0.7,
        });
      }
    }
  } catch {
    // DB not available during build — return base entries only
  }

  return entries;
}
