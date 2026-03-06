import { redirect, notFound } from 'next/navigation';
import { venues } from '@/lib/db';
import { venueSlug } from '@/utils/seo-helpers';

export default async function VenueRedirectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const venue = venues.getById(id);
  if (!venue) notFound();
  redirect(`/venue/${venueSlug(venue.name, venue.area)}`);
}
