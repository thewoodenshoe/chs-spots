import { NextResponse } from 'next/server';
import { sendEditApproval, sendDeleteApproval } from '@/lib/telegram';
import { isAdminRequest } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { updateSpotSchema, parseOrError } from '@/lib/validations';
import { spots, venues } from '@/lib/db';
import { invalidate } from '@/lib/cache';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const clientIp = getClientIp(request);
  if (!checkRateLimit(`delete:${clientIp}`, 5, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    const { id } = await params;
    const spotId = parseInt(id, 10);
    if (isNaN(spotId)) {
      return NextResponse.json({ error: 'Invalid spot ID' }, { status: 400 });
    }

    const spot = spots.getById(spotId);
    if (!spot) {
      return NextResponse.json({ error: 'Spot not found' }, { status: 404 });
    }

    if (isAdminRequest(request)) {
      spots.delete(spotId);
      invalidate('api:spots');
      return NextResponse.json({ success: true }, { status: 200 });
    }

    spots.update(spotId, { pendingDelete: 1 });

    try {
      await sendDeleteApproval({
        id: spotId,
        title: spot.title,
        type: spot.type,
        source: spot.source,
        venueId: spot.venue_id || undefined,
      });
    } catch (e) {
      console.warn('Telegram notification failed:', e);
    }

    return NextResponse.json({ pending: true, message: 'Delete request submitted for approval' }, { status: 200 });
  } catch (error) {
    console.error('Error deleting spot:', error);
    return NextResponse.json({ error: 'Failed to delete spot' }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const clientIp = getClientIp(request);
  if (!checkRateLimit(`put:${clientIp}`, 5, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    const { id } = await params;
    const spotId = parseInt(id, 10);
    if (isNaN(spotId)) {
      return NextResponse.json({ error: 'Invalid spot ID' }, { status: 400 });
    }

    const raw = await request.json();
    const parsed = parseOrError(updateSpotSchema, raw);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const spotData = parsed.data;

    const existing = spots.getById(spotId);
    if (!existing) {
      return NextResponse.json({ error: 'Spot not found' }, { status: 404 });
    }

    if (isAdminRequest(request)) {
      const adminUpdate: Record<string, unknown> = {
        title: spotData.title,
        description: spotData.description || '',
        type: spotData.type || spotData.activity || existing.type || 'Happy Hour',
        photoUrl: spotData.photoUrl !== undefined ? spotData.photoUrl : existing.photo_url,
        editedAt: new Date().toISOString(),
        ...(existing.source === 'automated' ? { manualOverride: 1 } : {}),
      };
      if (spotData.promotionTime !== undefined) adminUpdate.promotion_time = spotData.promotionTime;
      if (spotData.promotionList !== undefined) adminUpdate.promotion_list = JSON.stringify(spotData.promotionList);
      if (spotData.timeStart !== undefined) adminUpdate.time_start = spotData.timeStart || null;
      if (spotData.timeEnd !== undefined) adminUpdate.time_end = spotData.timeEnd || null;
      if (spotData.days !== undefined) adminUpdate.days = Array.isArray(spotData.days) ? spotData.days.join(',') : (spotData.days || null);
      if (spotData.specificDate !== undefined) adminUpdate.specific_date = spotData.specificDate || null;
      if (spotData.sourceUrl !== undefined) adminUpdate.source_url = spotData.sourceUrl;

      // Geo changes go to venue, not spot
      if (existing.venue_id && (spotData.lat != null || spotData.lng != null || spotData.area != null)) {
        const venueGeo: Record<string, unknown> = {};
        if (spotData.lat != null) venueGeo.lat = spotData.lat;
        if (spotData.lng != null) venueGeo.lng = spotData.lng;
        if (spotData.area != null) venueGeo.area = spotData.area;
        venues.update(existing.venue_id, venueGeo);
      }

      spots.update(spotId, adminUpdate);
      invalidate('api:spots');
      const updated = spots.getById(spotId);
      return NextResponse.json(updated, { status: 200 });
    }

    const pendingEdit: Record<string, unknown> = {
      title: spotData.title,
      description: spotData.description || '',
      lat: spotData.lat,
      lng: spotData.lng,
      type: spotData.type || spotData.activity || existing.type || 'Happy Hour',
      photoUrl: spotData.photoUrl !== undefined ? spotData.photoUrl : existing.photo_url,
      area: spotData.area !== undefined ? spotData.area : null,
      submittedAt: new Date().toISOString(),
    };
    if (spotData.promotionTime !== undefined) pendingEdit.promotionTime = spotData.promotionTime;
    if (spotData.promotionList !== undefined) pendingEdit.promotionList = spotData.promotionList;
    if (spotData.sourceUrl !== undefined) pendingEdit.sourceUrl = spotData.sourceUrl;

    spots.update(spotId, { pendingEdit });

    const changes: string[] = [];
    if (pendingEdit.title !== existing.title) changes.push(`Title: ${existing.title} → ${pendingEdit.title}`);
    if (pendingEdit.type !== existing.type) changes.push(`Type: ${existing.type} → ${pendingEdit.type}`);
    if (pendingEdit.description !== (existing.description || '')) changes.push('Description changed');
    if (pendingEdit.promotionTime && pendingEdit.promotionTime !== existing.promotion_time) changes.push(`When: ${pendingEdit.promotionTime}`);
    if (pendingEdit.promotionList) changes.push('Deals list updated');
    if (pendingEdit.sourceUrl && pendingEdit.sourceUrl !== existing.source_url) changes.push('Source link updated');
    const existingVenue = existing.venue_id ? venues.getById(existing.venue_id) : null;
    const oldLat = existingVenue?.lat ?? existing.lat ?? 0;
    const oldLng = existingVenue?.lng ?? existing.lng ?? 0;
    if (pendingEdit.lat !== oldLat || pendingEdit.lng !== oldLng) {
      changes.push(`Location moved`);
    }
    if (changes.length === 0) changes.push('(minor changes)');

    try {
      await sendEditApproval({
        id: spotId,
        title: existing.title,
        type: pendingEdit.type as string,
        changes,
        lat: pendingEdit.lat as number,
        lng: pendingEdit.lng as number,
      });
    } catch (e) {
      console.warn('Telegram notification failed:', e);
    }

    return NextResponse.json({ pending: true, message: 'Edit submitted for approval' }, { status: 200 });
  } catch (error) {
    console.error('Error updating spot:', error);
    return NextResponse.json({ error: 'Failed to update spot' }, { status: 500 });
  }
}
