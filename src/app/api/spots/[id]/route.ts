import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const dataDir = path.join(process.cwd(), 'data');
    const spotsPath = path.join(dataDir, 'spots.json');
    
    // Ensure data directory exists
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
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
    const dataDir = path.join(process.cwd(), 'data');
    const spotsPath = path.join(dataDir, 'spots.json');
    
    // Ensure data directory exists
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
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
    
    // Update the spot
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
    
    return NextResponse.json(updatedSpot, { status: 200 });
  } catch (error) {
    console.error('Error updating spot:', error);
    return NextResponse.json(
      { error: 'Failed to update spot' },
      { status: 500 }
    );
  }
}
