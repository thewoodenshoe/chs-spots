/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import fs from 'fs';
import { sendApprovalRequest } from '@/lib/telegram';
import { atomicWriteFileSync } from '@/lib/atomic-write';
import { isAdminRequest, unauthorizedResponse } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { updateSpotSchema, parseOrError } from '@/lib/validations';
import { reportingPath } from '@/lib/data-dir';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdminRequest(request)) return unauthorizedResponse();

  const clientIp = getClientIp(request);
  if (!checkRateLimit(`delete:${clientIp}`, 5, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    const reportingDir = reportingPath();
    const spotsPath = reportingPath('spots.json');
    
    if (!fs.existsSync(reportingDir)) {
      fs.mkdirSync(reportingDir, { recursive: true });
    }
    
    const { id } = await params;
    const spotId = parseInt(id, 10);
    
    if (isNaN(spotId)) {
      return NextResponse.json(
        { error: 'Invalid spot ID' },
        { status: 400 }
      );
    }
    
    let spots: any[] = [];
    if (fs.existsSync(spotsPath)) {
      try {
        const spotsContents = fs.readFileSync(spotsPath, 'utf8');
        spots = JSON.parse(spotsContents);
        if (!Array.isArray(spots)) {
          spots = [];
        }
      } catch (error) {
        console.error('Error reading spots.json:', error);
        spots = [];
      }
    }
    
    const initialLength = spots.length;
    spots = spots.filter((spot: any) => (spot.id || 0) !== spotId);
    
    // Check if spot was found
    if (spots.length === initialLength) {
      return NextResponse.json(
        { error: 'Spot not found' },
        { status: 404 }
      );
    }
    
    // Write back to file (atomic)
    try {
      atomicWriteFileSync(spotsPath, JSON.stringify(spots, null, 2));
    } catch (error) {
      console.error('Error writing spots.json:', error);
      return NextResponse.json(
        { error: 'Failed to delete spot' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Error deleting spot:', error);
    return NextResponse.json(
      { error: 'Failed to delete spot' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdminRequest(request)) return unauthorizedResponse();

  const clientIp = getClientIp(request);
  if (!checkRateLimit(`put:${clientIp}`, 5, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    const reportingDir = reportingPath();
    const spotsPath = reportingPath('spots.json');
    
    if (!fs.existsSync(reportingDir)) {
      fs.mkdirSync(reportingDir, { recursive: true });
    }
    
    const { id } = await params;
    const spotId = parseInt(id, 10);
    
    if (isNaN(spotId)) {
      return NextResponse.json(
        { error: 'Invalid spot ID' },
        { status: 400 }
      );
    }
    
    // Parse and validate request body
    const raw = await request.json();
    const parsed = parseOrError(updateSpotSchema, raw);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const spotData = parsed.data;
    
    // Load existing spots
    let spots: any[] = [];
    if (fs.existsSync(spotsPath)) {
      try {
        const spotsContents = fs.readFileSync(spotsPath, 'utf8');
        spots = JSON.parse(spotsContents);
        if (!Array.isArray(spots)) {
          spots = [];
        }
      } catch (error) {
        console.error('Error reading spots.json:', error);
        spots = [];
      }
    }
    
    // Find the spot to update
    const spotIndex = spots.findIndex((spot: any) => (spot.id || 0) === spotId);
    
    if (spotIndex === -1) {
      return NextResponse.json(
        { error: 'Spot not found' },
        { status: 404 }
      );
    }
    
    // Apply the edit immediately — spot stays visible, no re-approval needed
    const updatedSpot = {
      ...spots[spotIndex],
      id: spotId, // Ensure ID is preserved
      title: spotData.title,
      description: spotData.description || '',
      lat: spotData.lat,
      lng: spotData.lng,
      activity: spotData.type || spotData.activity || spots[spotIndex].activity || 'Happy Hour',
      type: spotData.type || spotData.activity || spots[spotIndex].type || 'Happy Hour',
      photoUrl: spotData.photoUrl !== undefined ? spotData.photoUrl : spots[spotIndex].photoUrl,
      area: spotData.area !== undefined ? spotData.area : spots[spotIndex].area,
      editedAt: new Date().toISOString(),
    };
    
    spots[spotIndex] = updatedSpot;
    
    // Write back to file (atomic)
    try {
      atomicWriteFileSync(spotsPath, JSON.stringify(spots, null, 2));
    } catch (error) {
      console.error('Error writing spots.json:', error);
      return NextResponse.json(
        { error: 'Failed to update spot' },
        { status: 500 }
      );
    }
    
    // Notify admin on Telegram about the edit (non-blocking, informational only)
    try {
      await sendApprovalRequest({
        id: spotId,
        title: `✏️ EDIT: ${updatedSpot.title}`,
        type: updatedSpot.type,
        lat: updatedSpot.lat,
        lng: updatedSpot.lng,
        description: updatedSpot.description,
      });
    } catch (telegramError) {
      console.warn('Telegram notification for edit failed (spot still saved):', telegramError);
    }
    
    return NextResponse.json(updatedSpot, { status: 200 });
  } catch (error) {
    console.error('Error updating spot:', error);
    return NextResponse.json(
      { error: 'Failed to update spot' },
      { status: 500 }
    );
  }
}
