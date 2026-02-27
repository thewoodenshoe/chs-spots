import { NextResponse } from 'next/server';
import { sendEditApproval, sendDeleteApproval } from '@/lib/telegram';
import { isAdminRequest } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { updateSpotSchema, parseOrError } from '@/lib/validations';
import { spots } from '@/lib/db';
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
      spots.update(spotId, {
        title: spotData.title,
        description: spotData.description || '',
        type: spotData.type || spotData.activity || existing.type || 'Happy Hour',
        photoUrl: spotData.photoUrl !== undefined ? spotData.photoUrl : existing.photo_url,
        editedAt: new Date().toISOString(),
        lat: spotData.lat,
        lng: spotData.lng,
        area: spotData.area ?? existing.area,
        ...(existing.source === 'automated' ? { manualOverride: 1 } : {}),
      });

      invalidate('api:spots');
      const updated = spots.getById(spotId);
      return NextResponse.json(updated, { status: 200 });
    }

    const pendingEdit = {
      title: spotData.title,
      description: spotData.description || '',
      lat: spotData.lat,
      lng: spotData.lng,
      type: spotData.type || spotData.activity || existing.type || 'Happy Hour',
      photoUrl: spotData.photoUrl !== undefined ? spotData.photoUrl : existing.photo_url,
      area: spotData.area !== undefined ? spotData.area : null,
      submittedAt: new Date().toISOString(),
    };

    spots.update(spotId, { pendingEdit });

    const changes: string[] = [];
    if (pendingEdit.title !== existing.title) changes.push(`Title: ${existing.title} → ${pendingEdit.title}`);
    if (pendingEdit.type !== existing.type) changes.push(`Type: ${existing.type} → ${pendingEdit.type}`);
    if (pendingEdit.description !== (existing.description || '')) changes.push('Description changed');
    const oldLat = existing.lat ?? 0;
    const oldLng = existing.lng ?? 0;
    if (pendingEdit.lat !== oldLat || pendingEdit.lng !== oldLng) {
      changes.push(`Location: ${oldLat.toFixed(4)},${oldLng.toFixed(4)} → ${pendingEdit.lat.toFixed(4)},${pendingEdit.lng.toFixed(4)}`);
    }
    if (changes.length === 0) changes.push('(minor changes)');

    try {
      await sendEditApproval({
        id: spotId,
        title: existing.title,
        type: pendingEdit.type,
        changes,
        lat: pendingEdit.lat,
        lng: pendingEdit.lng,
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
