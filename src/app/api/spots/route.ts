/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import fs from 'fs';
import { sendApprovalRequest } from '@/lib/telegram';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { atomicWriteFileSync } from '@/lib/atomic-write';
import { isAdminRequest } from '@/lib/auth';
import { createSpotSchema, parseOrError } from '@/lib/validations';
import { reportingPath, dataPath } from '@/lib/data-dir';

export async function GET(request: Request) {
  // Rate-limit reads (60 req/min per IP)
  const ip = getClientIp(request);
  if (!checkRateLimit(`spots-get:${ip}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  // Check for admin mode via auth helper (supports header, query param, etc.)
  const isAdmin = isAdminRequest(request);
  
  // Read from reporting folder (contains only found:true spots)
  const spotsPath = reportingPath('spots.json');
  const venuesPath = reportingPath('venues.json');
  
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
  } catch {
    // Venues file may not exist or be readable - that's ok, continue without enrichment
  }
  
  // Filter spots by status: 
  // - Admin sees everything (including pending/denied)
  // - Regular users see only approved + automated (no status field = legacy approved)
  const visibleSpots = isAdmin 
    ? spots 
    : spots.filter((spot: any) => {
        // Automated spots from pipeline have no status field — always visible
        if (spot.source === 'automated' || !spot.source) return true;
        // Manual spots: only show if approved (or no status = legacy)
        return !spot.status || spot.status === 'approved';
      });

  // Transform spots to match SpotsContext format
  const transformedSpots = visibleSpots.map((spot: any, index: number) => {
    const transformed: any = {
      id: spot.id || index + 1,
      lat: spot.lat,
      lng: spot.lng,
      title: spot.title,
      description: spot.description || '',
      type: spot.type || spot.activity || 'Happy Hour',
      photoUrl: spot.photoUrl,
      source: spot.source || 'automated',
      status: spot.status || 'approved', // Default to approved for legacy spots
      happyHourTime: spot.happyHourTime || undefined,
      happyHourList: spot.happyHourList || undefined,
      sourceUrl: spot.sourceUrl || undefined,
      lastUpdateDate: spot.lastUpdateDate || undefined,
      venueId: spot.venueId || undefined,
    };
    
    // Enrich with area information from venues
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
  // Rate limit: 3 submissions per minute per IP
  const clientIp = getClientIp(request);
  if (!checkRateLimit(clientIp, 3, 60_000)) {
    return NextResponse.json(
      { error: 'Too many submissions. Please wait a moment and try again.' },
      { status: 429 },
    );
  }

  try {
    const reportingDir = reportingPath();
    const spotsPath = reportingPath('spots.json');
    
    // Ensure reporting directory exists
    if (!fs.existsSync(reportingDir)) {
      fs.mkdirSync(reportingDir, { recursive: true });
    }
    
    // Parse and validate request body
    const raw = await request.json();
    const parsed = parseOrError(createSpotSchema, raw);
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
    
    // Generate ID for new spot (max existing ID + 1, or 1 if empty)
    const maxId = spots.length > 0 
      ? Math.max(...spots.map((spot: any) => spot.id || 0))
      : 0;
    const newId = maxId + 1;
    
    // Create new spot with pending status (requires admin approval via Telegram)
    const newSpot = {
      id: newId,
      title: spotData.title,
      submitterName: spotData.submitterName,
      description: spotData.description || '',
      lat: spotData.lat,
      lng: spotData.lng,
      activity: spotData.type || spotData.activity || 'Happy Hour',
      type: spotData.type || spotData.activity || 'Happy Hour',
      photoUrl: spotData.photoUrl,
      area: spotData.area,
      source: 'manual',
      status: 'pending',
      submittedAt: new Date().toISOString(),
    };
    
    // Add new spot
    spots.push(newSpot);
    
    // Write back to file (atomic to prevent corruption)
    try {
      atomicWriteFileSync(spotsPath, JSON.stringify(spots, null, 2));
    } catch (error) {
      console.error('Error writing spots.json:', error);
      return NextResponse.json(
        { error: 'Failed to save spot' },
        { status: 500 }
      );
    }
    
    // Send Telegram approval notification (non-blocking — don't fail if Telegram is down)
    try {
      await sendApprovalRequest({
        id: newId,
        title: newSpot.title,
        type: newSpot.type,
        lat: newSpot.lat,
        lng: newSpot.lng,
        description: `By: ${newSpot.submitterName}\n${newSpot.description}`,
      });
    } catch (telegramError) {
      console.warn('Telegram notification failed (spot still saved):', telegramError);
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
