import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import { venues, spots, activitiesDb, areasDb } from '@/lib/db';
import { venueSlug, slugify } from '@/utils/seo-helpers';

export async function POST(request: Request) {
  const secret = request.headers.get('x-revalidate-secret');
  if (secret !== process.env.REVALIDATE_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const started = Date.now();
  const results: Record<string, number> = {};

  revalidatePath('/', 'page');
  results.homepage = 1;

  const allVenues = venues.getAll();
  const allSpots = spots.getAll({ visibleOnly: true });
  const venuesWithSpots = new Set(allSpots.map(s => s.venue_id).filter(Boolean));

  let venueCount = 0;
  for (const v of allVenues) {
    if (!venuesWithSpots.has(v.id)) continue;
    const slug = venueSlug(v.name, v.area);
    revalidatePath(`/venue/${slug}`, 'page');
    venueCount++;
  }
  results.venues = venueCount;

  const areas = areasDb.getNames();
  const activities = activitiesDb.getAll().filter(a => !a.hidden).map(a => a.name);
  let exploreCount = 0;
  for (const area of areas) {
    for (const activity of activities) {
      revalidatePath(`/explore/${slugify(activity)}-in-${slugify(area)}`, 'page');
      exploreCount++;
    }
  }
  results.explore = exploreCount;

  revalidatePath('/sitemap.xml', 'page');
  results.sitemap = 1;

  const elapsed = Date.now() - started;
  return NextResponse.json({
    ok: true,
    revalidated: results,
    totalPages: Object.values(results).reduce((a, b) => a + b, 0),
    elapsedMs: elapsed,
  });
}
