import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(request: Request) {
  const venuesPath = path.join(process.cwd(), 'data', 'venues.json');
  const { searchParams } = new URL(request.url);
  const areaFilter = searchParams.get('area');
  
  // Handle missing venues.json file gracefully - return empty array
  let venues: any[] = [];
  try {
    if (fs.existsSync(venuesPath)) {
      const venuesContents = fs.readFileSync(venuesPath, 'utf8');
      venues = JSON.parse(venuesContents);
      
      // Ensure venues is an array
      if (!Array.isArray(venues)) {
        console.warn('venues.json does not contain an array, defaulting to empty array');
        venues = [];
      }
    } else {
      // File doesn't exist - this is fine, just return empty array
      return NextResponse.json([]);
    }
  } catch (error) {
    // If there's an error reading/parsing the file, log it but return empty array
    console.error('Error reading venues.json:', error);
    return NextResponse.json([]);
  }
  
  // Filter by area if area query param is provided
  if (areaFilter) {
    const filterLower = areaFilter.toLowerCase();
    venues = venues.filter((venue: any) => {
      const venueArea = (venue.area || '').toLowerCase();
      return venueArea.includes(filterLower);
    });
  }
  
  // Transform to include only necessary fields for map display
  const transformedVenues = venues.map((venue: any) => ({
    id: venue.id || venue.place_id,
    name: venue.name,
    lat: venue.lat,
    lng: venue.lng,
    area: venue.area || null,
    address: venue.address || null,
    website: venue.website || null,
  }));
  
  return NextResponse.json(transformedVenues);
}
