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
    
    // Match spots to venues by name to get area
    const enrichedSpots = spots.map((spot: any) => {
      const matchingVenue = venues.find(
        (venue: any) => venue.name === spot.title || venue.name.toLowerCase() === spot.title.toLowerCase()
      );
      if (matchingVenue && matchingVenue.area) {
        return { ...spot, area: matchingVenue.area };
      }
      return spot;
    });
    
    return NextResponse.json(enrichedSpots);
  } catch (error) {
    console.error('Error reading spots.json:', error);
    return NextResponse.json({ error: 'Failed to load spots' }, { status: 500 });
  }
}
