import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { spots, venues, areasDb, activitiesDb, type SpotRow, type VenueRow } from '@/lib/db';
import { slugify } from '@/utils/seo-helpers';

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

const AREA_DESCRIPTIONS: Record<string, string> = {
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

const ACTIVITY_TIPS: Record<string, string> = {
  'Happy Hour': 'Most happy hours in Charleston run weekdays between 4-7pm. Many spots extend hours on Thursdays. Always check for seasonal changes.',
  'Brunch': 'Weekend brunch is a Charleston tradition. Peak hours are 10am-1pm — arrive early or expect a wait at popular spots. Some venues offer weekday brunch too.',
  'Live Music': 'Charleston has a thriving live music scene every night of the week. Check venue schedules for showtimes, which are typically updated each Monday.',
  'Coffee Shops': 'Charleston coffee culture blends specialty roasters with cozy neighborhood cafes. Most open by 7am and are perfect for remote work.',
  'Rooftop Bars': 'Rooftop bars are busiest at sunset. Some require reservations, especially on weekends. Dress codes may apply at upscale locations.',
  'Dog-Friendly': 'Charleston is very dog-friendly. Many patios and outdoor areas welcome well-behaved dogs. Always confirm current pet policy before visiting.',
  'Recently Opened': 'New restaurants open regularly in Charleston. We track openings as they happen and verify details within 48 hours of discovery.',
  'Coming Soon': 'These spots have been announced but haven\'t opened yet. We monitor progress and update listings as opening dates are confirmed.',
  'Landmarks & Attractions': 'Charleston\'s historic landmarks span over 350 years of history. Most are walkable from the downtown area.',
};

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

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Charleston Finds', item: 'https://chsfinds.com' },
      { '@type': 'ListItem', position: 2, name: `${activity} in ${area}`, item: `https://chsfinds.com/explore/${slug}` },
    ],
  };

  const areaDesc = AREA_DESCRIPTIONS[area] || `A popular Charleston neighborhood with great ${activity.toLowerCase()} options.`;
  const activityTip = ACTIVITY_TIPS[activity] || '';

  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: `How many ${activity.toLowerCase()} spots are in ${area}?`,
        acceptedAnswer: { '@type': 'Answer', text: `There are currently ${areaSpots.length} verified ${activity.toLowerCase()} spots in ${area}, Charleston SC. This list is updated nightly.` },
      },
      {
        '@type': 'Question',
        name: `Are these ${activity.toLowerCase()} listings up to date?`,
        acceptedAnswer: { '@type': 'Answer', text: 'Yes. Our data is sourced directly from venue websites and verified nightly using automated checks. We recommend confirming details with the venue before visiting.' },
      },
      ...(activityTip ? [{
        '@type': 'Question',
        name: `What should I know about ${activity.toLowerCase()} in Charleston?`,
        acceptedAnswer: { '@type': 'Answer', text: activityTip },
      }] : []),
    ],
  };

  const itemListLd = areaSpots.length > 0 ? {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `Best ${activity} in ${area}, Charleston SC`,
    numberOfItems: areaSpots.length,
    itemListElement: areaSpots.slice(0, 20).map((s, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: s.title,
      url: `https://chsfinds.com/spots/${s.id}`,
    })),
  } : null;

  return (
    <div className="mx-auto max-w-2xl px-6 py-12 text-gray-800">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />
      {itemListLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListLd) }} />}
      <nav className="mb-6">
        <Link href="/" className="text-teal-600 text-sm font-medium hover:underline">&larr; Back to Charleston Finds</Link>
      </nav>

      <h1 className="text-2xl font-bold mb-2">Best {activity} in {area}</h1>
      <p className="text-sm text-gray-600 mb-4 leading-relaxed">
        {areaDesc} {areaSpots.length > 0
          ? `We found ${areaSpots.length} ${activity.toLowerCase()} spot${areaSpots.length !== 1 ? 's' : ''} here, verified from venue sites and updated nightly.`
          : `We don\u2019t have any ${activity.toLowerCase()} spots here yet, but we\u2019re always adding more.`}
      </p>
      {activityTip && (
        <p className="text-xs text-gray-400 mb-6 italic">{activityTip}</p>
      )}

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
                href={`/spots/${spot.id}`}
                className="flex gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow"
              >
                {spot.photoUrl && !spot.photoUrl.startsWith('data:') && (
                  <Image
                    src={spot.photoUrl}
                    alt={spot.title}
                    width={80}
                    height={80}
                    className="h-20 w-20 rounded-lg object-cover flex-shrink-0"
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

      <section className="mt-10 pt-6 border-t border-gray-200">
        <h2 className="text-lg font-bold text-gray-800 mb-4">Frequently Asked Questions</h2>
        <div className="space-y-4 text-sm">
          <div>
            <h3 className="font-semibold text-gray-700">How many {activity.toLowerCase()} spots are in {area}?</h3>
            <p className="text-gray-500 mt-1">There are currently {areaSpots.length} verified {activity.toLowerCase()} spots in {area}. This list is updated nightly.</p>
          </div>
          <div>
            <h3 className="font-semibold text-gray-700">Are these listings up to date?</h3>
            <p className="text-gray-500 mt-1">Yes. Our data is sourced directly from venue websites and verified nightly using automated checks. We recommend confirming details with the venue before visiting.</p>
          </div>
          {activityTip && (
            <div>
              <h3 className="font-semibold text-gray-700">What should I know about {activity.toLowerCase()} in Charleston?</h3>
              <p className="text-gray-500 mt-1">{activityTip}</p>
            </div>
          )}
        </div>
      </section>

      <div className="mt-8 pt-6 border-t border-gray-200 text-center">
        <p className="text-sm text-gray-500 mb-3">Want to see these on the map?</p>
        <Link href="/" className="inline-block rounded-lg bg-teal-600 px-6 py-3 text-sm font-semibold text-white hover:bg-teal-700">
          Open Charleston Finds
        </Link>
      </div>
    </div>
  );
}
