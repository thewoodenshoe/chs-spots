import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { Spot } from '@/contexts/SpotsContext';

const dataFilePath = path.join(process.cwd(), 'data', 'spots.json');

async function readSpots(): Promise<Spot[]> {
  try {
    const fileContents = await fs.readFile(dataFilePath, 'utf8');
    const spots = JSON.parse(fileContents);
    if (!Array.isArray(spots)) {
      return [];
    }
    return spots;
  } catch (error) {
    console.error('Error reading spots file:', error);
    return [];
  }
}

async function writeSpots(spots: Spot[]): Promise<void> {
  try {
    const dataDir = path.dirname(dataFilePath);
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(dataFilePath, JSON.stringify(spots, null, 2), 'utf8');
  } catch (error) {
    console.error('Error writing spots file:', error);
    throw error;
  }
}

// PUT /api/spots/[id] - Update an existing spot
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const spotId = parseInt(id, 10);
    
    if (isNaN(spotId)) {
      return NextResponse.json(
        { error: 'Invalid spot ID' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { lat, lng, title, description, type, photoUrl } = body;

    // Validate required fields
    if (!lat || !lng || !title || !type) {
      return NextResponse.json(
        { error: 'Missing required fields: lat, lng, title, type' },
        { status: 400 }
      );
    }

    // Read existing spots
    const spots = await readSpots();

    // Find spot by ID
    const spotIndex = spots.findIndex((spot) => spot.id === spotId);
    if (spotIndex === -1) {
      return NextResponse.json(
        { error: 'Spot not found' },
        { status: 404 }
      );
    }

    // Update spot
    const updatedSpot: Spot = {
      ...spots[spotIndex],
      lat,
      lng,
      title,
      description: description || '',
      type,
      photoUrl: photoUrl !== undefined ? photoUrl : spots[spotIndex].photoUrl,
    };

    spots[spotIndex] = updatedSpot;

    // Write back to file
    await writeSpots(spots);

    console.log('Spot updated:', updatedSpot);

    return NextResponse.json(updatedSpot);
  } catch (error) {
    console.error('Error updating spot:', error);
    return NextResponse.json(
      { error: 'Failed to update spot' },
      { status: 500 }
    );
  }
}

// DELETE /api/spots/[id] - Delete an existing spot
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const spotId = parseInt(id, 10);
    
    if (isNaN(spotId)) {
      return NextResponse.json(
        { error: 'Invalid spot ID' },
        { status: 400 }
      );
    }

    // Read existing spots
    const spots = await readSpots();

    // Find spot by ID
    const spotIndex = spots.findIndex((spot) => spot.id === spotId);
    if (spotIndex === -1) {
      return NextResponse.json(
        { error: 'Spot not found' },
        { status: 404 }
      );
    }

    // Remove spot from array
    const deletedSpot = spots[spotIndex];
    spots.splice(spotIndex, 1);

    // Write back to file
    await writeSpots(spots);

    console.log('Spot deleted:', deletedSpot);

    return NextResponse.json({ message: 'Spot deleted successfully', id: spotId });
  } catch (error) {
    console.error('Error deleting spot:', error);
    return NextResponse.json(
      { error: 'Failed to delete spot' },
      { status: 500 }
    );
  }
}

