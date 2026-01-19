import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  // Read from reporting folder (contains only found:true spots)
  const spotsPath = path.join(process.cwd(), 'data', 'reporting', 'spots.json');
  const venuesPath = path.join(process.cwd(), 'data', 'reporting', 'venues.json');
  
  // Handle missing spots.json file gracefully - return empty array (no spots is valid, not an error)
  let spots: any[] = [];
  try {
    if (fs.existsSync(spotsPath)) {
      const spotsContents = fs.readFileSync(spotsPath, 'utf8');
      spots = JSON.parse(spotsContents);
      
      // Ensure spots is an array
      if (!Array.isArray(spots)) {
        console.warn('spots.json does not contain an array, defaulting to empty array');
        spots = [];
      }
    } else {
      // File doesn't exist - this is fine, just return empty array
      // No need to log as error since "no spots" is a valid state
      return NextResponse.json([]);
    }
  } catch (error) {
    // If there's an error reading/parsing the file, log it but return empty array
    // This prevents frontend errors when the file is corrupted or unreadable
    console.error('Error reading spots.json:', error);
    return NextResponse.json([]);
  }
  
  // Try to enrich spots with area information from venues
  let venues: any[] = [];
  try {
    if (fs.existsSync(venuesPath)) {
      const venuesContents = fs.readFileSync(venuesPath, 'utf8');
      venues = JSON.parse(venuesContents);
      if (!Array.isArray(venues)) {
        venues = [];
      }
    }
  } catch (e) {
    // Venues file may not exist or be readable - that's ok, continue without enrichment
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
      description: spot.description || '', // Keep for backwards compatibility
      type: spot.type || spot.activity || 'Happy Hour', // Use type if available, fallback to activity
      photoUrl: spot.photoUrl,
      source: spot.source || 'automated', // Default to 'automated' for backward compatibility
      // Include labeled fields if available
      happyHourTime: spot.happyHourTime || undefined,
      happyHourList: spot.happyHourList || undefined,
      sourceUrl: spot.sourceUrl || undefined,
      lastUpdateDate: spot.lastUpdateDate || undefined,
      venueId: spot.venueId || undefined,
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
}

export async function POST(request: Request) {
  try {
    const dataDir = path.join(process.cwd(), 'data');
    const reportingDir = path.join(dataDir, 'reporting');
    const spotsPath = path.join(reportingDir, 'spots.json');
    
    // Ensure reporting directory exists
    if (!fs.existsSync(reportingDir)) {
      fs.mkdirSync(reportingDir, { recursive: true });
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
    
    // Generate ID for new spot (max existing ID + 1, or 1 if empty)
    const maxId = spots.length > 0 
      ? Math.max(...spots.map((spot: any) => spot.id || 0))
      : 0;
    const newId = maxId + 1;
    
    // Create new spot object (convert to old format for compatibility)
    const newSpot = {
      id: newId,
      title: spotData.title,
      description: spotData.description || '',
      lat: spotData.lat,
      lng: spotData.lng,
      activity: spotData.type || spotData.activity || 'Happy Hour',
      type: spotData.type || spotData.activity || 'Happy Hour',
      photoUrl: spotData.photoUrl,
      area: spotData.area,
      source: 'manual', // Mark as manually added - should never be removed by scripts
    };
    
    // Add new spot
    spots.push(newSpot);
    
    // Write back to file
    try {
      fs.writeFileSync(spotsPath, JSON.stringify(spots, null, 2), 'utf8');
    } catch (error) {
      console.error('Error writing spots.json:', error);
      return NextResponse.json(
        { error: 'Failed to save spot' },
        { status: 500 }
      );
    }
    
    // Return the new spot
    return NextResponse.json(newSpot, { status: 201 });
  } catch (error) {
    console.error('Error adding spot:', error);
    return NextResponse.json(
      { error: 'Failed to add spot' },
      { status: 500 }
    );
  }
}
