import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { spots, venues, areasDb, activitiesDb, type SpotRow, type VenueRow } from '@/lib/db';
import { buildVenueMap } from '@/lib/transform-spot';
import { slugify } from '@/utils/seo-helpers';
import {
  AREA_DESCRIPTIONS, ACTIVITY_TIPS, STATUS_TYPE_MAP, formatSchedule,
} from '@/utils/explore-helpers';

export const revalidate = 86400;

function parseSlug(slug: string): { area: string; activity: string } | null {
  const areas = areasDb.getNames();
  const acts = activitiesDb.getAll().filter(a => !a.hidden).map(a => a.name);
  for (const area of areas) {
    for (const activity of acts) {
      if (slug === `${slugify(activity)}-in-${slugify(area)}`) return { area, activity };
    }
  }
  return null;
}

interface ExploreSpot {
  id: number | string; title: string; description: string;
  lat: number; lng: number; photoUrl: string | null;
  schedule: string | null; area: string | null; lastUpdate: string | null;
}

function spotToExplore(spot: SpotRow, venueMap: Map<string, VenueRow>): ExploreSpot {
  const venue = spot.venue_id ? venueMap.get(spot.venue_id) : undefined;
  return {
    id: spot.id, title: spot.title, description: spot.description || '',
    lat: venue?.lat ?? 0, lng: venue?.lng ?? 0,
    photoUrl: spot.photo_url || venue?.photo_url || null,
    schedule: formatSchedule(spot),
    area: venue?.area || null,
    lastUpdate: spot.last_update_date || spot.updated_at,
  };
}

function venueToExplore(v: VenueRow): ExploreSpot {
  return {
    id: v.id, title: v.name, description: '',
    lat: v.lat, lng: v.lng, photoUrl: v.photo_url || null,
    schedule: v.expected_open_date ? `Expected: ${v.expected_open_date}` : null,
    area: v.area || null, lastUpdate: v.updated_at,
  };
}

function loadAreaSpots(activity: string, area: string) {
  const allVenues = venues.getAll();
  const venueMap = buildVenueMap(allVenues);
  const venueStatus = STATUS_TYPE_MAP[activity];

  if (venueStatus) {
    return {
      areaSpots: allVenues
        .filter(v => v.venue_status === venueStatus && v.area === area)
        .map(v => venueToExplore(v))
        .filter(s => s.lat !== 0 || s.lng !== 0),
      allSpots: [], allVenues, venueMap,
    };
  }

  const allSpots = spots.getAll({ visibleOnly: true });
  const areaSpots = allSpots
    .filter(s => {
      if (s.type !== activity) return false;
      const v = s.venue_id ? venueMap.get(s.venue_id) : undefined;
      return v?.area === area;
    })
    .map(s => spotToExplore(s, venueMap))
    .filter(s => s.lat !== 0 || s.lng !== 0);

  return { areaSpots, allSpots, allVenues, venueMap };
}

export async function generateStaticParams() {
  const areas = areasDb.getNames();
  const acts = activitiesDb.getAll().filter(a => !a.hidden).map(a => a.name);
  return areas.flatMap(area =>
    acts.map(activity => ({ slug: `${slugify(activity)}-in-${slugify(area)}` })),
  );
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const parsed = parseSlug(slug);
  if (!parsed) return { title: 'Not Found' };

  const { areaSpots } = loadAreaSpots(parsed.activity, parsed.area);
  const count = areaSpots.length;
  const canonical = `https://chsfinds.com/explore/${slug}`;
  const robots = count === 0 ? { index: false, follow: true } : undefined;
  const actLower = parsed.activity.toLowerCase();
  const titleCount = count > 0 ? `${count} ` : '';

  const today = new Date().toISOString().split('T')[0];
  const venueCount = new Set(areaSpots.map(s => s.id)).size;

  const activityHints: Record<string, string> = {
    'Happy Hour': `with drink specials, food deals & daily schedules. See which are active right now`,
    'Brunch': `with menus, weekend schedules & pricing. Find Saturday and Sunday brunch`,
    'Live Music': `with tonight's shows, venues & schedules. Real-time live music happening now`,
    'Rooftop Bars': `with views, cocktails & atmosphere. Best rooftop spots`,
    'Coffee Shops': `with hours, specialties & locations. Find your morning coffee`,
    'Dog-Friendly': `that welcome dogs — patios, parks & pet-friendly spots`,
    'Landmarks & Attractions': `worth visiting — historic sites, gardens & must-see spots`,
  };
  const hint = activityHints[parsed.activity] || `with verified details and real-time status`;

  return {
    title: `${titleCount}${parsed.activity} in ${parsed.area} SC – Real-Time Active Now Map | CHS Finds`,
    description: count > 0
      ? `${count} verified ${actLower} spots across ${venueCount} venues in ${parsed.area}, Charleston SC ${hint}. Map, photos & directions included. Last updated: ${today}.`
      : `${parsed.activity} in ${parsed.area}, Charleston SC — explore nearby areas on CHS Finds.`,
    keywords: [
      parsed.activity, parsed.area, 'Charleston SC',
      `best ${actLower} ${parsed.area}`, `${actLower} deals Charleston`,
      `${actLower} near me`, `${parsed.area} ${actLower}`,
      `Charleston ${actLower} map`, `${actLower} today`,
    ],
    alternates: { canonical },
    robots,
    openGraph: {
      title: `${titleCount}${parsed.activity} in ${parsed.area} SC – Real-Time Map`,
      description: `${count > 0 ? count : 'No'} ${actLower} spots in ${parsed.area}, Charleston SC. Updated daily with times, menus & directions.`,
      url: canonical,
      siteName: 'CHS Finds',
    },
    other: {
      'last-modified': today,
      'revisit-after': '1 day',
    },
  };
}

export default async function ExplorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const parsed = parseSlug(slug);
  if (!parsed) notFound();
  const { area, activity } = parsed;

  const { areaSpots, allSpots, allVenues, venueMap } = loadAreaSpots(activity, area);
  const venueStatus = STATUS_TYPE_MAP[activity];

  const latestUpdate = areaSpots.reduce((max, s) =>
    s.lastUpdate && s.lastUpdate > max ? s.lastUpdate : max, '');
  const lastUpdatedLabel = latestUpdate
    ? new Date(latestUpdate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })
    : null;

  const otherAreas = areasDb.getNames().filter(a => a !== area).map(a => {
    const count = venueStatus
      ? allVenues.filter(v => v.venue_status === venueStatus && v.area === a).length
      : allSpots.filter(s => {
        if (s.type !== activity) return false;
        const v = s.venue_id ? venueMap.get(s.venue_id) : undefined;
        return (v?.area) === a;
      }).length;
    return { area: a, count };
  }).filter(a => a.count > 0).sort((a, b) => b.count - a.count).slice(0, 5);

  const REFRESH_TIMES: Record<string, string> = { 'Live Music': '1pm' };
  const refreshTime = REFRESH_TIMES[activity] || '3am';

  const areaDesc = AREA_DESCRIPTIONS[area] || `A popular Charleston neighborhood with great ${activity.toLowerCase()} options.`;
  const activityTip = ACTIVITY_TIPS[activity] || '';
  const breadcrumbLd = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Charleston Finds', item: 'https://chsfinds.com' },
    { '@type': 'ListItem', position: 2, name: `${activity} in ${area}`, item: `https://chsfinds.com/explore/${slug}` },
  ]};

  return (
    <div className="mx-auto max-w-2xl px-6 py-12 text-gray-800">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
      <nav className="mb-6">
        <Link href="/" className="text-teal-600 text-sm font-medium hover:underline">&larr; Back to Charleston Finds</Link>
      </nav>

      <h1 className="text-2xl font-bold mb-2">Best {activity} in {area}</h1>
      <p className="text-sm text-gray-600 mb-2 leading-relaxed">
        {areaDesc} {areaSpots.length > 0
          ? `We found ${areaSpots.length} ${activity.toLowerCase()} spot${areaSpots.length !== 1 ? 's' : ''} here, verified from venue sites and updated daily.`
          : `We don\u2019t have any ${activity.toLowerCase()} spots in ${area} yet \u2014 check nearby areas below.`}
      </p>
      {lastUpdatedLabel && areaSpots.length > 0 && (
        <p className="text-xs text-gray-400 mb-1">Last updated: {lastUpdatedLabel} &middot; Refreshes daily at {refreshTime} ET</p>
      )}
      {activityTip && <p className="text-xs text-gray-400 mb-6 italic">{activityTip}</p>}

      {areaSpots.length === 0 ? (
        <div className="rounded-xl bg-gray-50 p-8 text-center mb-8">
          <p className="text-gray-500 text-sm mb-4">No {activity.toLowerCase()} spots in {area} yet.</p>
          <Link href="/" className="inline-block rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700">Explore on the map</Link>
        </div>
      ) : (
        <ul className="space-y-4">
          {areaSpots.map(spot => (
            <li key={spot.id}>
              <Link href={`/spots/${spot.id}`} className="flex gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow">
                {spot.photoUrl && !spot.photoUrl.startsWith('data:') && (
                  <Image src={spot.photoUrl} alt={spot.title} width={80} height={80}
                    className="h-20 w-20 rounded-lg object-cover flex-shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold text-gray-900 text-sm truncate">{spot.title}</h2>
                  {spot.schedule && <p className="text-xs text-teal-600 mt-0.5 font-medium">{spot.schedule}</p>}
                  {spot.description && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{spot.description}</p>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {otherAreas.length > 0 && (
        <section className="mt-8 pt-6 border-t border-gray-200">
          <h2 className="text-sm font-bold text-gray-700 mb-3">{activity} in other areas</h2>
          <div className="flex flex-wrap gap-2">
            {otherAreas.map(({ area: a, count }) => (
              <Link key={a} href={`/explore/${slugify(activity)}-in-${slugify(a)}`}
                className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-teal-50 hover:border-teal-200 hover:text-teal-700 transition-colors">
                {a} ({count})
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="mt-8 pt-6 border-t border-gray-200 text-center">
        <p className="text-sm text-gray-500 mb-3">Want to see these on the map?</p>
        <Link href="/" className="inline-block rounded-lg bg-teal-600 px-6 py-3 text-sm font-semibold text-white hover:bg-teal-700">Open Charleston Finds</Link>
      </div>
    </div>
  );
}
