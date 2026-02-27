import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { spots, venues, areasDb, activitiesDb, type SpotRow, type VenueRow } from '@/lib/db';

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function parseSlug(slug: string): { area: string; activity: string } | null {
  const areas = areasDb.getNames();
  const activities = activitiesDb.getAll().filter(a => !a.hidden).map(a => a.name);

  for (const area of areas) {
    for (const activity of activities) {
      const expected = `${slugify(activity)}-in-${slugify(area)}`;
      if (slug === expected) return { area, activity };
    }
  }
  return null;
}

function transformSpot(spot: SpotRow, venueMap: Map<string, VenueRow>) {
  const venue = spot.venue_id ? venueMap.get(spot.venue_id) : undefined;
  return {
    id: spot.id,
    title: spot.title,
    description: spot.description || '',
    lat: venue?.lat ?? spot.lat ?? 0,
    lng: venue?.lng ?? spot.lng ?? 0,
    photoUrl: spot.photo_url || venue?.photo_url || null,
    happyHourTime: spot.promotion_time || null,
    area: venue?.area || spot.area || null,
  };
}

export async function generateStaticParams() {
  const areas = areasDb.getNames();
  const activities = activitiesDb.getAll().filter(a => !a.hidden).map(a => a.name);
  const params: { slug: string }[] = [];
  for (const area of areas) {
    for (const activity of activities) {
      params.push({ slug: `${slugify(activity)}-in-${slugify(area)}` });
    }
  }
  return params;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const parsed = parseSlug(slug);
  if (!parsed) return { title: 'Not Found' };
  return {
    title: `Best ${parsed.activity} in ${parsed.area} — Charleston Finds`,
    description: `Discover the best ${parsed.activity.toLowerCase()} spots in ${parsed.area}, Charleston SC. Verified from venue sites and curated by locals.`,
    openGraph: {
      title: `Best ${parsed.activity} in ${parsed.area}`,
      description: `Discover the best ${parsed.activity.toLowerCase()} spots in ${parsed.area}, Charleston SC.`,
    },
  };
}

export default async function ExplorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const parsed = parseSlug(slug);
  if (!parsed) notFound();

  const { area, activity } = parsed;

  const allSpots = spots.getAll({ visibleOnly: true });
  const allVenues = venues.getAll();
  const venueMap = new Map<string, VenueRow>();
  for (const v of allVenues) venueMap.set(v.id, v);

  const areaSpots = allSpots
    .filter(s => {
      if (s.type !== activity) return false;
      const venue = s.venue_id ? venueMap.get(s.venue_id) : undefined;
      const spotArea = venue?.area || s.area || null;
      return spotArea === area;
    })
    .map(s => transformSpot(s, venueMap))
    .filter(s => s.lat !== 0 || s.lng !== 0);

  return (
    <div className="mx-auto max-w-2xl px-6 py-12 text-gray-800">
      <nav className="mb-6">
        <Link href="/" className="text-teal-600 text-sm font-medium hover:underline">&larr; Back to Charleston Finds</Link>
      </nav>

      <h1 className="text-2xl font-bold mb-2">Best {activity} in {area}</h1>
      <p className="text-sm text-gray-500 mb-8">
        {areaSpots.length} spot{areaSpots.length !== 1 ? 's' : ''} verified from venue sites and curated by locals.
      </p>

      {areaSpots.length === 0 ? (
        <div className="rounded-xl bg-gray-50 p-8 text-center">
          <p className="text-gray-500 text-sm">No {activity.toLowerCase()} spots in {area} yet.</p>
          <Link href="/" className="mt-4 inline-block rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700">
            Explore on the map
          </Link>
        </div>
      ) : (
        <ul className="space-y-4">
          {areaSpots.map(spot => (
            <li key={spot.id}>
              <Link
                href={`/?spot=${spot.id}`}
                className="flex gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow"
              >
                {spot.photoUrl && (
                  <img
                    src={spot.photoUrl}
                    alt={spot.title}
                    className="h-20 w-20 rounded-lg object-cover flex-shrink-0"
                    loading="lazy"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold text-gray-900 text-sm truncate">{spot.title}</h2>
                  {spot.happyHourTime && (
                    <p className="text-xs text-teal-600 mt-0.5">{spot.happyHourTime}</p>
                  )}
                  {spot.description && (
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">{spot.description}</p>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-10 pt-6 border-t border-gray-200 text-center">
        <p className="text-sm text-gray-500 mb-3">Want to see these on the map?</p>
        <Link href="/" className="inline-block rounded-lg bg-teal-600 px-6 py-3 text-sm font-semibold text-white hover:bg-teal-700">
          Open Charleston Finds
        </Link>
      </div>
    </div>
  );
}
