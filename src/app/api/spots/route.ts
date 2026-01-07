import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { Spot } from '@/contexts/SpotsContext';

const dataFilePath = path.join(process.cwd(), 'data', 'spots.json');

// Initial sample spots to seed if file is empty
const initialSampleSpots: Spot[] = [
  {
    id: 1,
    lat: 32.850,
    lng: -79.910,
    title: 'Holiday Lights on Oak Island',
    description: 'Beautiful Christmas light display',
    type: 'Christmas Spots',
  },
  {
    id: 2,
    lat: 32.840,
    lng: -79.905,
    title: 'The Kingstide Happy Hour',
    description: 'Great happy hour specials',
    type: 'Happy Hour',
  },
  {
    id: 3,
    lat: 32.845,
    lng: -79.915,
    title: 'Daniel Island Fishing Dock',
    description: 'Perfect spot for fishing',
    type: 'Fishing Spots',
  },
  {
    id: 4,
    lat: 32.835,
    lng: -79.900,
    title: 'Sunset Point Park',
    description: 'Stunning sunset views',
    type: 'Sunset Spots',
  },
  {
    id: 5,
    lat: 32.848,
    lng: -79.902,
    title: 'Daniel Island Pickleball Courts',
    description: 'Public pickleball courts',
    type: 'Pickleball Games',
  },
];

async function readSpots(): Promise<Spot[]> {
  try {
    const fileContents = await fs.readFile(dataFilePath, 'utf8');
    const spots = JSON.parse(fileContents);
    // If file is empty or invalid, return initial sample spots
    if (!Array.isArray(spots) || spots.length === 0) {
      return initialSampleSpots;
    }
    return spots;
  } catch (error) {
    // If file doesn't exist or is invalid, return initial sample spots
    console.error('Error reading spots file:', error);
    return initialSampleSpots;
  }
}

async function writeSpots(spots: Spot[]): Promise<void> {
  try {
    // Ensure data directory exists
    const dataDir = path.dirname(dataFilePath);
    await fs.mkdir(dataDir, { recursive: true });
    // Write spots to file
    await fs.writeFile(dataFilePath, JSON.stringify(spots, null, 2), 'utf8');
  } catch (error) {
    console.error('Error writing spots file:', error);
    throw error;
  }
}

// GET /api/spots - Read all spots
export async function GET() {
  try {
    const spots = await readSpots();
    return NextResponse.json(spots);
  } catch (error) {
    console.error('Error reading spots:', error);
    return NextResponse.json(
      { error: 'Failed to read spots' },
      { status: 500 }
    );
  }
}

// POST /api/spots - Add a new spot
export async function POST(request: NextRequest) {
  try {
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

    // Generate new ID using Date.now()
    const newSpot: Spot = {
      id: Date.now(),
      lat,
      lng,
      title,
      description: description || '',
      type,
      photoUrl, // Optional
    };

    // Add new spot to array
    spots.push(newSpot);

    // Write back to file
    await writeSpots(spots);

    console.log('New spot added:', newSpot);

    return NextResponse.json(newSpot, { status: 201 });
  } catch (error) {
    console.error('Error adding spot:', error);
    return NextResponse.json(
      { error: 'Failed to add spot' },
      { status: 500 }
    );
  }
}

// PUT /api/spots/[id] - Update an existing spot
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, lat, lng, title, description, type, photoUrl } = body;

    // Validate required fields
    if (!id || !lat || !lng || !title || !type) {
      return NextResponse.json(
        { error: 'Missing required fields: id, lat, lng, title, type' },
        { status: 400 }
      );
    }

    // Read existing spots
    const spots = await readSpots();

    // Find spot by ID
    const spotIndex = spots.findIndex((spot) => spot.id === id);
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
      photoUrl: photoUrl !== undefined ? photoUrl : spots[spotIndex].photoUrl, // Preserve existing if not provided
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

