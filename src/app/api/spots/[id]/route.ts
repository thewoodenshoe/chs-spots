/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { sendApprovalRequest } from '@/lib/telegram';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const reportingDir = path.join(process.cwd(), 'data', 'reporting');
    const spotsPath = path.join(reportingDir, 'spots.json');
    
    // Ensure reporting directory exists
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
    
    // Find and remove the spot
    const initialLength = spots.length;
    spots = spots.filter((spot: any) => (spot.id || 0) !== spotId);
    
    // Check if spot was found
    if (spots.length === initialLength) {
      return NextResponse.json(
        { error: 'Spot not found' },
        { status: 404 }
      );
    }
    
    // Write back to file
    try {
      fs.writeFileSync(spotsPath, JSON.stringify(spots, null, 2), 'utf8');
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
  try {
    const reportingDir = path.join(process.cwd(), 'data', 'reporting');
    const spotsPath = path.join(reportingDir, 'spots.json');
    
    // Ensure reporting directory exists
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
    
    // Parse request body
    const spotData = await request.json();
    
    // Validate required fields
    if (!spotData.title || !spotData.lat || !spotData.lng) {
      return NextResponse.json(
        { error: 'Missing required fields: title, lat, lng' },
        { status: 400 }
      );
    }
    
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
    
    // Update the spot — mark as pending so it goes through approval
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
      status: 'pending', // Require re-approval after edit
      editedAt: new Date().toISOString(),
    };
    
    spots[spotIndex] = updatedSpot;
    
    // Write back to file
    try {
      fs.writeFileSync(spotsPath, JSON.stringify(spots, null, 2), 'utf8');
    } catch (error) {
      console.error('Error writing spots.json:', error);
      return NextResponse.json(
        { error: 'Failed to update spot' },
        { status: 500 }
      );
    }
    
    // Send Telegram approval notification for the edit (non-blocking)
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
