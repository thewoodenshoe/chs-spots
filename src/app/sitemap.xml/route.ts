import { areasDb, activitiesDb, spots, venues } from '@/lib/db';
import { slugify, venueSlug } from '@/utils/seo-helpers';

interface SitemapEntry {
  url: string;
  lastmod: string;
  changefreq: string;
  priority: number;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildEntries(): SitemapEntry[] {
  const today = new Date().toISOString().split('T')[0];
  const entries: SitemapEntry[] = [
    { url: 'https://chsfinds.com', lastmod: today, changefreq: 'daily', priority: 1 },
    { url: 'https://chsfinds.com/privacy', lastmod: '2026-02-01', changefreq: 'yearly', priority: 0.3 },
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
          return v?.area === area;
        });
        if (matching.length === 0) continue;
        const latest = matching.reduce((max, s) => {
          const d = s.last_update_date || s.updated_at;
          return d > max ? d : max;
        }, '');
        entries.push({
          url: `https://chsfinds.com/explore/${slugify(activity)}-in-${slugify(area)}`,
          lastmod: latest ? latest.split('T')[0] : today,
          changefreq: 'daily',
          priority: 0.7,
        });
      }
    }

    for (const spot of allSpots) {
      const lm = spot.last_update_date || spot.updated_at;
      entries.push({
        url: `https://chsfinds.com/spots/${spot.id}`,
        lastmod: lm ? lm.split('T')[0] : today,
        changefreq: 'weekly',
        priority: 0.6,
      });
    }

    const spotsByVenue = new Set(allSpots.filter(s => s.venue_id).map(s => s.venue_id!));
    for (const v of allVenues) {
      if (!spotsByVenue.has(v.id)) continue;
      const slug = venueSlug(v.name, v.area);
      entries.push({
        url: `https://chsfinds.com/venue/${slug}`,
        lastmod: today,
        changefreq: 'daily',
        priority: 0.8,
      });
    }
  } catch {
    // DB not available during build
  }
  return entries;
}

export async function GET() {
  const today = new Date().toISOString().split('T')[0];
  const entries = buildEntries();
  const lines = entries.map(e =>
    `  <url>\n    <loc>${escapeXml(e.url)}</loc>\n    <lastmod>${e.lastmod}</lastmod>\n    <changefreq>${e.changefreq}</changefreq>\n    <priority>${e.priority}</priority>\n  </url>`
  );

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- CHS Finds Sitemap — Hyper-local Charleston discovery map. Updated daily with real-time happy hours, brunches, rooftops, live music & more. Over 1,000 venues tracked, freshness via nightly AI scraping. Last full regeneration: ${today} -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${lines.join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
