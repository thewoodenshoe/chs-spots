import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { spots, venues, type SpotRow } from '@/lib/db';
import { formatFullWeekHours } from '@/utils/format-hours';
import { parseHours, parsePromoList } from '@/utils/seo-helpers';

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params;
  const venue = venues.getById(id);
  if (!venue) return { title: 'Not Found' };

  const area = venue.area || 'Charleston';
  const title = `${venue.name} — ${area}, Charleston SC`;
  const desc = `Find deals, happy hours, brunch, live music and more at ${venue.name} in ${area}. Verified from venue sites, updated nightly.`;

  const canonical = `https://chsfinds.com/venues/${encodeURIComponent(id)}`;

  const venueSpots = spots.getAll({ visibleOnly: true })
    .filter(s => s.venue_id === id);
  const spotTypes = [...new Set(venueSpots.map(s => s.type))];

  return {
    title,
    description: desc,
    keywords: [venue.name, area, 'Charleston SC', ...spotTypes],
    alternates: { canonical },
    openGraph: {
      title,
      description: desc,
      url: canonical,
      type: 'website',
      ...(venue.photo_url && !venue.photo_url.startsWith('data:')
        ? { images: [{ url: venue.photo_url }] }
        : {}),
    },
  };
}

export default async function VenuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const venue = venues.getById(id);
  if (!venue) notFound();

  const venueSpots = spots.getAll({ visibleOnly: true })
    .filter((s: SpotRow) => s.venue_id === venue.id);

  const area = venue.area || 'Charleston';
  const hours = parseHours(venue.operating_hours);
  const formattedHours = hours ? formatFullWeekHours(hours) : null;
  const photo = venue.photo_url || null;
  const mapUrl = venue.lat && venue.lng
    ? `https://www.google.com/maps?q=${venue.lat},${venue.lng}`
    : null;

  const spotTypes = [...new Set(venueSpots.map(s => s.type))];
  const descParts = spotTypes.length > 0
    ? `Known for: ${spotTypes.join(', ')}. `
    : '';

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: venue.name,
    description: `${descParts}${venue.name} in ${area}, Charleston SC.`,
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
    ...(venueSpots.length > 0 ? {
      hasOfferCatalog: {
        '@type': 'OfferCatalog',
        name: `Deals at ${venue.name}`,
        itemListElement: venueSpots.slice(0, 10).map(s => ({
          '@type': 'Offer',
          name: s.title,
          description: s.promotion_time || s.type,
        })),
      },
    } : {}),
  };

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Charleston Finds', item: 'https://chsfinds.com' },
      { '@type': 'ListItem', position: 2, name: venue.name,
        item: `https://chsfinds.com/venues/${encodeURIComponent(venue.id)}` },
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
          <Image src={photo} alt={venue.name} fill className="object-cover" />
        </div>
      )}

      <h1 className="text-2xl font-bold mb-1">{venue.name}</h1>
      <p className="text-sm text-gray-500 mb-4">{area}, Charleston SC</p>

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
                <a href={`tel:${venue.phone}`} className="text-teal-600 hover:underline">
                  {venue.phone}
                </a>
              </dd>
            </div>
          )}
          {venue.website && (
            <div>
              <dt className="text-gray-400 text-xs uppercase tracking-wide">Website</dt>
              <dd>
                <a
                  href={venue.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-teal-600 hover:underline truncate block"
                >
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

      {venueSpots.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-bold text-gray-800 mb-3">
            {venueSpots.length} Deal{venueSpots.length !== 1 ? 's' : ''} at {venue.name}
          </h2>
          <div className="space-y-3">
            {venueSpots.map(s => {
              const deals = parsePromoList(s.promotion_list);
              return (
                <Link
                  key={s.id}
                  href={`/spots/${s.id}`}
                  className="block rounded-xl border border-gray-200 p-4 hover:border-teal-300 hover:shadow-sm transition-all"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-bold text-gray-800">{s.title}</h3>
                      <p className="text-xs text-teal-600 font-medium mt-0.5">{s.type}</p>
                      {s.promotion_time && (
                        <p className="text-xs text-gray-500 mt-1">{s.promotion_time}</p>
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
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex gap-3 mb-8">
        {mapUrl && (
          <a
            href={mapUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 rounded-lg bg-teal-600 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-teal-700"
          >
            View on Map
          </a>
        )}
        <Link
          href="/"
          className="flex-1 rounded-lg border-2 border-teal-600 px-4 py-3 text-center text-sm font-semibold text-teal-600 hover:bg-teal-50"
        >
          Explore All Deals
        </Link>
      </div>
    </div>
  );
}
