import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { spots, venues, type SpotRow, type VenueRow } from '@/lib/db';
import { venueSlug } from '@/utils/seo-helpers';
import { formatFullWeekHours } from '@/utils/format-hours';
import { parseHours, parsePromoList } from '@/utils/seo-helpers';

export const revalidate = 86400;

function resolveVenue(slug: string): VenueRow | undefined {
  return venues.getBySlug(slug);
}

function getVenueSpots(venueId: string): SpotRow[] {
  return spots.getAll({ visibleOnly: true }).filter(s => s.venue_id === venueId);
}

function formatActivitySummary(venueSpots: SpotRow[]): string {
  const types = [...new Set(venueSpots.map(s => s.type))];
  if (types.length === 0) return '';
  if (types.length === 1) return types[0];
  return types.slice(0, -1).join(', ') + ' & ' + types[types.length - 1];
}

export async function generateStaticParams() {
  try {
    const allVenues = venues.getAll();
    const allSpots = spots.getAll({ visibleOnly: true });
    const venuesWithSpots = new Set(allSpots.map(s => s.venue_id).filter(Boolean));
    return allVenues
      .filter(v => venuesWithSpots.has(v.id))
      .map(v => ({ slug: venueSlug(v.name, v.area) }));
  } catch {
    return [];
  }
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const venue = resolveVenue(slug);
  if (!venue) return { title: 'Not Found' };

  const venueSpots = getVenueSpots(venue.id);
  const area = venue.area || 'Charleston';
  const activitySummary = formatActivitySummary(venueSpots);
  const today = new Date().toISOString().split('T')[0];

  const title = activitySummary
    ? `${venue.name} — ${activitySummary} in ${area}, Charleston SC | CHS Finds`
    : `${venue.name} — ${area}, Charleston SC | CHS Finds`;

  const spotCount = venueSpots.length;
  const desc = activitySummary
    ? `${spotCount} verified deal${spotCount !== 1 ? 's' : ''} at ${venue.name} in ${area}: ${activitySummary}. Times, menus & directions. Updated ${today}.`
    : `${venue.name} in ${area}, Charleston SC. Verified details, hours & directions. Updated ${today}.`;

  const canonical = `https://chsfinds.com/venue/${slug}`;
  const spotTypes = [...new Set(venueSpots.map(s => s.type))];

  return {
    title,
    description: desc,
    keywords: [
      venue.name, area, 'Charleston SC', 'Charleston deals',
      ...spotTypes.map(t => `${t} ${area}`),
      ...spotTypes.map(t => `${t} Charleston`),
    ],
    alternates: { canonical },
    openGraph: {
      title,
      description: desc,
      url: canonical,
      type: 'website',
      siteName: 'CHS Finds',
      ...(venue.photo_url && !venue.photo_url.startsWith('data:')
        ? { images: [{ url: venue.photo_url, alt: venue.name }] }
        : {}),
    },
    other: {
      'last-modified': today,
      'revisit-after': '1 day',
    },
  };
}

export default async function VenueSlugPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const venue = resolveVenue(slug);
  if (!venue) notFound();

  const venueSpots = getVenueSpots(venue.id);
  const area = venue.area || 'Charleston';
  const hours = parseHours(venue.operating_hours);
  const formattedHours = hours ? formatFullWeekHours(hours) : null;
  const photo = venue.photo_url || null;
  const today = new Date().toISOString().split('T')[0];
  const mapUrl = venue.lat && venue.lng
    ? `https://www.google.com/maps?q=${venue.lat},${venue.lng}`
    : null;

  const spotTypes = [...new Set(venueSpots.map(s => s.type))];
  const activitySummary = formatActivitySummary(venueSpots);

  const spotsByType: Record<string, SpotRow[]> = {};
  for (const s of venueSpots) {
    (spotsByType[s.type] ??= []).push(s);
  }

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: venue.name,
    description: activitySummary
      ? `${venue.name} in ${area} — ${activitySummary}. Updated daily with real-time deals.`
      : `${venue.name} in ${area}, Charleston SC.`,
    url: `https://chsfinds.com/venue/${slug}`,
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Charleston',
      addressRegion: 'SC',
      ...(venue.address ? { streetAddress: venue.address } : {}),
    },
    ...(venue.lat && venue.lng
      ? { geo: { '@type': 'GeoCoordinates', latitude: venue.lat, longitude: venue.lng } }
      : {}),
    ...(venue.phone ? { telephone: venue.phone } : {}),
    ...(venue.website ? { url: venue.website } : {}),
    ...(photo && !photo.startsWith('data:') ? { image: photo } : {}),
    dateModified: today,
    datePublished: venue.created_at?.split('T')[0] || '2026-03-01',
    keywords: [venue.name, area, 'Charleston', ...spotTypes].join(', '),
    ...(venueSpots.length > 0 ? {
      hasOfferCatalog: {
        '@type': 'OfferCatalog',
        name: `Deals at ${venue.name}`,
        itemListElement: venueSpots.slice(0, 20).map((s, i) => ({
          '@type': 'Offer',
          position: i + 1,
          name: s.title,
          description: s.promotion_time || s.type,
          ...(s.time_start ? { availabilityStarts: s.time_start } : {}),
          ...(s.time_end ? { availabilityEnds: s.time_end } : {}),
        })),
      },
    } : {}),
  };

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'CHS Finds', item: 'https://chsfinds.com' },
      { '@type': 'ListItem', position: 2, name: area, item: `https://chsfinds.com/explore/happy-hour-in-${area.toLowerCase().replace(/\s+/g, '-')}` },
      { '@type': 'ListItem', position: 3, name: venue.name, item: `https://chsfinds.com/venue/${slug}` },
    ],
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-12 text-gray-800">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />

      <nav className="mb-6 flex items-center gap-2 text-sm">
        <Link href="/" className="text-teal-600 font-medium hover:underline">Home</Link>
        <span className="text-gray-300">/</span>
        <span className="text-gray-500">{venue.name}</span>
      </nav>

      {photo && !photo.startsWith('data:') && (
        <div className="relative h-48 w-full overflow-hidden rounded-xl mb-6 bg-gray-100">
          <Image src={photo} alt={venue.name} fill className="object-cover" sizes="(max-width: 672px) 100vw, 672px" />
        </div>
      )}

      <h1 className="text-2xl font-bold mb-1">{venue.name}</h1>
      <p className="text-sm text-gray-500 mb-1">{area}, Charleston SC</p>
      {activitySummary && (
        <p className="text-sm text-teal-600 font-medium mb-4">{activitySummary}</p>
      )}

      <div className="rounded-xl border border-gray-200 p-4 mb-6">
        <dl className="space-y-2 text-sm">
          {venue.address && (
            <div>
              <dt className="text-gray-400 text-xs uppercase tracking-wide">Address</dt>
              <dd className="text-gray-700">{venue.address}</dd>
            </div>
          )}
          {venue.phone && (
            <div>
              <dt className="text-gray-400 text-xs uppercase tracking-wide">Phone</dt>
              <dd>
                <a href={`tel:${venue.phone}`} className="text-teal-600 hover:underline">{venue.phone}</a>
              </dd>
            </div>
          )}
          {venue.website && (
            <div>
              <dt className="text-gray-400 text-xs uppercase tracking-wide">Website</dt>
              <dd>
                <a href={venue.website} target="_blank" rel="noopener noreferrer"
                  className="text-teal-600 hover:underline truncate block">
                  {venue.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                </a>
              </dd>
            </div>
          )}
        </dl>
      </div>

      {formattedHours && formattedHours.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-bold text-gray-700 mb-2">Hours</h2>
          <ul className="space-y-1 text-sm">
            {formattedHours.map(dh => (
              <li key={dh.day} className={`flex justify-between ${dh.isToday ? 'font-semibold text-teal-700' : ''}`}>
                <span className="text-gray-500">{dh.day}</span>
                <span className="text-gray-700">{dh.hours}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {Object.entries(spotsByType).map(([type, typeSpots]) => (
        <div key={type} className="mb-6">
          <h2 className="text-lg font-bold text-gray-800 mb-3">
            {type} ({typeSpots.length})
          </h2>
          <div className="space-y-3">
            {typeSpots.map(s => {
              const deals = parsePromoList(s.promotion_list);
              return (
                <Link key={s.id} href={`/spots/${s.id}`}
                  className="block rounded-xl border border-gray-200 p-4 hover:border-teal-300 hover:shadow-sm transition-all">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-bold text-gray-800">{s.title}</h3>
                      {s.promotion_time && (
                        <p className="text-xs text-gray-500 mt-0.5">{s.promotion_time}</p>
                      )}
                      {s.days && (
                        <p className="text-xs text-teal-600 mt-0.5">{s.days}</p>
                      )}
                      {deals.length > 0 && (
                        <ul className="mt-2 space-y-0.5">
                          {deals.slice(0, 3).map((d, i) => (
                            <li key={i} className="text-xs text-gray-500">{d.replace(/^\[[^\]]*\]\s*/, '')}</li>
                          ))}
                          {deals.length > 3 && (
                            <li className="text-xs text-gray-400">+{deals.length - 3} more</li>
                          )}
                        </ul>
                      )}
                    </div>
                    {s.photo_url && !s.photo_url.startsWith('data:') && (
                      <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg bg-gray-100">
                        <Image src={s.photo_url} alt={s.title} fill className="object-cover" sizes="64px" />
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      ))}

      <div className="flex gap-3 mb-8">
        {mapUrl && (
          <a href={mapUrl} target="_blank" rel="noopener noreferrer"
            className="flex-1 rounded-lg bg-teal-600 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-teal-700">
            View on Map
          </a>
        )}
        <Link href="/"
          className="flex-1 rounded-lg border-2 border-teal-600 px-4 py-3 text-center text-sm font-semibold text-teal-600 hover:bg-teal-50">
          Explore All Deals
        </Link>
      </div>

      <p className="text-xs text-gray-400 text-center">
        Last verified: {today}. Data updated nightly from venue websites and verified sources.
      </p>
    </div>
  );
}
