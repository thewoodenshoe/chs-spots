import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    const spotsPath = path.join(process.cwd(), 'data', 'spots.json');
    const venuesPath = path.join(process.cwd(), 'data', 'venues.json');
    
    const spotsContents = fs.readFileSync(spotsPath, 'utf8');
    const spots = JSON.parse(spotsContents);
    
    // Try to enrich spots with area information from venues
    let venues: any[] = [];
    try {
      const venuesContents = fs.readFileSync(venuesPath, 'utf8');
      venues = JSON.parse(venuesContents);
    } catch (e) {
      // Venues file may not exist or be readable
    }
    
    // Transform spots to match SpotsContext format
    // Handle both old format (activity, no id) and new format (type, id)
    const transformedSpots = spots.map((spot: any, index: number) => {
      // Convert old format to new format
      const transformed: any = {
        id: spot.id || index + 1, // Generate ID if missing
        lat: spot.lat,
        lng: spot.lng,
        title: spot.title,
        description: spot.description || '',
        type: spot.type || spot.activity || 'Happy Hour', // Use type if available, fallback to activity
        photoUrl: spot.photoUrl,
      };
      
      // Try to enrich with area information from venues
      const matchingVenue = venues.find(
        (venue: any) => venue.name === spot.title || venue.name.toLowerCase() === spot.title.toLowerCase()
      );
      if (matchingVenue && matchingVenue.area) {
        transformed.area = matchingVenue.area;
      } else if (spot.area) {
        transformed.area = spot.area;
      }
      
      return transformed;
    });
    
    return NextResponse.json(transformedSpots);
  } catch (error) {
    console.error('Error reading spots.json:', error);
    return NextResponse.json({ error: 'Failed to load spots' }, { status: 500 });
  }
}
