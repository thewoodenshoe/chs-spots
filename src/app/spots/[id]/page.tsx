import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { spots, venues, type VenueRow } from '@/lib/db';
import { formatFullWeekHours } from '@/utils/format-hours';
import { slugify, parseHours, parsePromoList } from '@/utils/seo-helpers';

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params;
  const spot = spots.getById(Number(id));
  if (!spot || spot.status !== 'approved') return { title: 'Not Found' };

  const venue = spot.venue_id ? venues.getById(spot.venue_id) : undefined;
  const area = venue?.area || spot.area || 'Charleston';
  const title = `${spot.title} — ${spot.type} in ${area}`;
  const desc = spot.description
    ? `${spot.description.slice(0, 150)}${spot.description.length > 150 ? '...' : ''}`
    : `${spot.type} at ${spot.title} in ${area}, Charleston SC. Verified from venue sites.`;

  return {
    title,
    description: desc,
    openGraph: {
      title,
      description: desc,
      type: 'article',
      ...(spot.photo_url && !spot.photo_url.startsWith('data:')
        ? { images: [{ url: spot.photo_url }] }
        : {}),
    },
  };
}

export default async function SpotPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const spot = spots.getById(Number(id));
  if (!spot || spot.status !== 'approved') notFound();

  const venue: VenueRow | undefined = spot.venue_id
    ? venues.getById(spot.venue_id)
    : undefined;

  const area = venue?.area || spot.area || 'Charleston';
  const lat = venue?.lat ?? spot.lat ?? 0;
  const lng = venue?.lng ?? spot.lng ?? 0;
  const promoList = parsePromoList(spot.promotion_list);
  const hours = parseHours(venue?.operating_hours ?? null);
  const formattedHours = hours ? formatFullWeekHours(hours) : null;
  const mapUrl = lat && lng
    ? `https://www.google.com/maps?q=${lat},${lng}`
    : null;
  const photo = spot.photo_url || venue?.photo_url || null;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: spot.title,
    description: spot.description || `${spot.type} in ${area}, Charleston SC`,
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Charleston',
      addressRegion: 'SC',
      ...(venue?.address ? { streetAddress: venue.address } : {}),
    },
    ...(lat && lng ? { geo: { '@type': 'GeoCoordinates', latitude: lat, longitude: lng } } : {}),
    ...(venue?.phone ? { telephone: venue.phone } : {}),
    ...(venue?.website ? { url: venue.website } : {}),
    ...(photo && !photo.startsWith('data:') ? { image: photo } : {}),
    ...(spot.promotion_time ? {
      offers: {
        '@type': 'Offer',
        name: `${spot.type} — ${spot.promotion_time}`,
        description: promoList.length > 0
          ? promoList.map(p => p.replace(/^\[[^\]]*\]\s*/, '')).join(', ')
          : spot.description || '',
        availability: 'https://schema.org/InStock',
      },
    } : {}),
  };

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Charleston Finds', item: 'https://chsfinds.com' },
      { '@type': 'ListItem', position: 2, name: `${spot.type} in ${area}`,
        item: `https://chsfinds.com/explore/${slugify(spot.type)}-in-${slugify(area)}` },
      { '@type': 'ListItem', position: 3, name: spot.title,
        item: `https://chsfinds.com/spots/${spot.id}` },
    ],
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-12 text-gray-800">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />

      <nav className="mb-6 flex items-center gap-2 text-sm">
        <Link href="/" className="text-teal-600 font-medium hover:underline">Home</Link>
        <span className="text-gray-300">/</span>
        <Link
          href={`/explore/${slugify(spot.type)}-in-${slugify(area)}`}
          className="text-teal-600 font-medium hover:underline"
        >
          {spot.type} in {area}
        </Link>
      </nav>

      {photo && !photo.startsWith('data:') && (
        <div className="relative h-48 w-full overflow-hidden rounded-xl mb-6 bg-gray-100">
          <Image src={photo} alt={spot.title} fill className="object-cover" />
        </div>
      )}

      <h1 className="text-2xl font-bold mb-1">{spot.title}</h1>
      <p className="text-sm text-teal-600 font-medium mb-4">{spot.type} in {area}</p>

      {spot.promotion_time && (
        <div className="rounded-xl bg-teal-50 border border-teal-100 px-4 py-3 mb-4">
          <p className="text-sm font-semibold text-teal-800">{spot.promotion_time}</p>
        </div>
      )}

      {promoList.length > 0 && (
        <div className="mb-4">
          <h2 className="text-sm font-bold text-gray-700 mb-2">Deals</h2>
          <ul className="space-y-1">
            {promoList.map((item, i) => {
              const m = item.match(/^\[([^\]]+)\]\s*(.*)/);
              return (
                <li key={i} className="text-sm text-gray-600">
                  {m ? <><span className="font-medium text-gray-500">{m[1]}:</span> {m[2]}</> : item}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {spot.description && (
        <div className="mb-6">
          <h2 className="text-sm font-bold text-gray-700 mb-1">About</h2>
          <p className="text-sm text-gray-600 leading-relaxed">{spot.description}</p>
        </div>
      )}

      {venue && (
        <div className="rounded-xl border border-gray-200 p-4 mb-6">
          <h2 className="text-sm font-bold text-gray-700 mb-3">Venue Details</h2>
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
      )}

      {formattedHours && formattedHours.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-bold text-gray-700 mb-2">Hours</h2>
          <ul className="space-y-1 text-sm">
            {formattedHours.map(dh => (
              <li key={dh.day} className="flex justify-between">
                <span className="text-gray-500">{dh.day}</span>
                <span className="text-gray-700">{dh.hours}</span>
              </li>
            ))}
          </ul>
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
          href={`/?spot=${spot.id}`}
          className="flex-1 rounded-lg border-2 border-teal-600 px-4 py-3 text-center text-sm font-semibold text-teal-600 hover:bg-teal-50"
        >
          Open in App
        </Link>
      </div>

      {spot.source_url && (
        <p className="text-xs text-gray-400 mb-4">
          Source:{' '}
          <a href={spot.source_url} target="_blank" rel="noopener noreferrer" className="hover:underline">
            {new URL(spot.source_url).hostname}
          </a>
        </p>
      )}

      {spot.last_update_date && (
        <p className="text-xs text-gray-400">
          Last verified: {new Date(spot.last_update_date).toLocaleDateString('en-US', {
            month: 'long', day: 'numeric', year: 'numeric',
          })}
        </p>
      )}
    </div>
  );
}
