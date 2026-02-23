/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import fs from 'fs';
import { sendEditApproval, sendDeleteApproval } from '@/lib/telegram';
import { atomicWriteFileSync } from '@/lib/atomic-write';
import { isAdminRequest } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { updateSpotSchema, parseOrError } from '@/lib/validations';
import { reportingPath } from '@/lib/data-dir';

function loadSpots(): { spots: any[]; spotsPath: string } {
  const spotsPath = reportingPath('spots.json');
  const reportingDir = reportingPath();
  if (!fs.existsSync(reportingDir)) fs.mkdirSync(reportingDir, { recursive: true });

  let spots: any[] = [];
  if (fs.existsSync(spotsPath)) {
    try {
      spots = JSON.parse(fs.readFileSync(spotsPath, 'utf8'));
      if (!Array.isArray(spots)) spots = [];
    } catch { spots = []; }
  }
  return { spots, spotsPath };
}

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

    const { spots, spotsPath } = loadSpots();
    const spotIndex = spots.findIndex((s: any) => (s.id || 0) === spotId);
    if (spotIndex === -1) {
      return NextResponse.json({ error: 'Spot not found' }, { status: 404 });
    }

    // Admin: delete immediately
    if (isAdminRequest(request)) {
      spots.splice(spotIndex, 1);
      atomicWriteFileSync(spotsPath, JSON.stringify(spots, null, 2));
      return NextResponse.json({ success: true }, { status: 200 });
    }

    // Regular user: mark pending and send Telegram approval
    const spot = spots[spotIndex];
    spots[spotIndex] = { ...spot, pendingDelete: true };
    atomicWriteFileSync(spotsPath, JSON.stringify(spots, null, 2));

    try {
      await sendDeleteApproval({
        id: spotId,
        title: spot.title,
        type: spot.type,
        source: spot.source,
        venueId: spot.venueId,
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

    const { spots, spotsPath } = loadSpots();
    const spotIndex = spots.findIndex((s: any) => (s.id || 0) === spotId);
    if (spotIndex === -1) {
      return NextResponse.json({ error: 'Spot not found' }, { status: 404 });
    }

    const existing = spots[spotIndex];

    // Admin: apply immediately
    if (isAdminRequest(request)) {
      const updatedSpot = {
        ...existing,
        id: spotId,
        title: spotData.title,
        description: spotData.description || '',
        lat: spotData.lat,
        lng: spotData.lng,
        activity: spotData.type || spotData.activity || existing.activity || 'Happy Hour',
        type: spotData.type || spotData.activity || existing.type || 'Happy Hour',
        photoUrl: spotData.photoUrl !== undefined ? spotData.photoUrl : existing.photoUrl,
        area: spotData.area !== undefined ? spotData.area : existing.area,
        editedAt: new Date().toISOString(),
        ...(existing.source === 'automated' ? { manualOverride: true } : {}),
      };
      spots[spotIndex] = updatedSpot;
      atomicWriteFileSync(spotsPath, JSON.stringify(spots, null, 2));
      return NextResponse.json(updatedSpot, { status: 200 });
    }

    // Regular user: store proposed changes, send for approval
    const pendingEdit = {
      title: spotData.title,
      description: spotData.description || '',
      lat: spotData.lat,
      lng: spotData.lng,
      type: spotData.type || spotData.activity || existing.type || 'Happy Hour',
      photoUrl: spotData.photoUrl !== undefined ? spotData.photoUrl : existing.photoUrl,
      area: spotData.area !== undefined ? spotData.area : existing.area,
      submittedAt: new Date().toISOString(),
    };

    spots[spotIndex] = { ...existing, pendingEdit };
    atomicWriteFileSync(spotsPath, JSON.stringify(spots, null, 2));

    // Build a diff summary for the Telegram message
    const changes: string[] = [];
    if (pendingEdit.title !== existing.title) changes.push(`Title: ${existing.title} → ${pendingEdit.title}`);
    if (pendingEdit.type !== existing.type) changes.push(`Type: ${existing.type} → ${pendingEdit.type}`);
    if (pendingEdit.description !== (existing.description || '')) changes.push('Description changed');
    if (pendingEdit.lat !== existing.lat || pendingEdit.lng !== existing.lng) changes.push('Location moved');
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
