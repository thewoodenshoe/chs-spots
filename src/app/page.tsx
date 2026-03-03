import { spots, venues, activitiesDb, areasDb, type SpotRow, type VenueRow } from '@/lib/db';
import Link from 'next/link';
import HomeClient from './HomeClient';
import { slugify } from '@/utils/seo-helpers';

function transformSpot(spot: SpotRow, venueMap: Map<string, VenueRow>) {
  const venue = spot.venue_id ? venueMap.get(spot.venue_id) : undefined;
  return {
    id: spot.id,
    title: spot.title,
    type: spot.type,
    area: venue?.area || spot.area || 'Charleston',
    promotionTime: spot.promotion_time || null,
    description: spot.description || '',
  };
}

export default function HomePage() {
  const allSpots = spots.getAll({ visibleOnly: true });
  const allVenues = venues.getAll();
  const activities = activitiesDb.getAll().filter(a => !a.hidden);
  const areas = areasDb.getNames();

  const venueMap = new Map<string, VenueRow>();
  for (const v of allVenues) venueMap.set(v.id, v);

  const spotsByType: Record<string, number> = {};
  for (const s of allSpots) {
    spotsByType[s.type] = (spotsByType[s.type] || 0) + 1;
  }

  const featured = allSpots
    .slice(0, 30)
    .map(s => transformSpot(s, venueMap));

  const exploreLinks = activities.flatMap(a =>
    areas.slice(0, 3).map(area => ({
      label: `${a.name} in ${area}`,
      href: `/explore/${slugify(a.name)}-in-${slugify(area)}`,
    })),
  );

  return (
    <>
      <HomeClient />

      {/* Server-rendered content for search engine crawlers */}
      <article className="mx-auto max-w-3xl px-6 py-12 text-gray-800">
        <h1 className="text-3xl font-bold mb-4">
          Charleston Finds &mdash; Happy Hours, Brunches, Live Music &amp; Deals
        </h1>
        <p className="text-lg text-gray-600 mb-6 leading-relaxed">
          Discover {allSpots.length} verified deals from {allVenues.length} venues
          in Charleston, SC. Happy hours, brunches, live music, newly opened
          restaurants, coffee shops, rooftop bars, and more &mdash; sourced from
          venue websites and updated nightly.
        </p>

        <h2 className="text-xl font-bold mb-3">Browse by Activity</h2>
        <ul className="grid grid-cols-2 gap-3 mb-8">
          {activities.map(a => (
            <li key={a.name}>
              <span className="font-semibold">{a.emoji} {a.name}</span>
              <span className="text-gray-500 ml-1">
                ({spotsByType[a.name] || 0} spots)
              </span>
            </li>
          ))}
        </ul>

        <h2 className="text-xl font-bold mb-3">Featured Deals</h2>
        <ul className="space-y-3 mb-8">
          {featured.map(s => (
            <li key={s.id} className="border-b border-gray-100 pb-2">
              <Link href={`/spots/${s.id}`} className="hover:text-teal-600">
                <h3 className="font-semibold text-sm">{s.title}</h3>
              </Link>
              <p className="text-xs text-gray-500">
                {s.type} in {s.area}
                {s.promotionTime ? ` · ${s.promotionTime}` : ''}
              </p>
              {s.description && (
                <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">
                  {s.description}
                </p>
              )}
            </li>
          ))}
        </ul>

        <h2 className="text-xl font-bold mb-3">Explore Charleston</h2>
        <ul className="grid grid-cols-2 gap-2 mb-8 text-sm">
          {exploreLinks.map(l => (
            <li key={l.href}>
              <Link href={l.href} className="text-teal-600 hover:underline">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>

        <p className="text-sm text-gray-400">
          Charleston Finds is updated nightly with the latest deals and openings
          across the Charleston, SC metro area. Data is sourced from venue
          websites and verified by locals.
        </p>
      </article>
    </>
  );
}
