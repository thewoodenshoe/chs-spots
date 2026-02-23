import { NextResponse } from 'next/server';
import fs from 'fs';
import { configPath } from '@/lib/data-dir';

export async function GET() {
  try {
    const areasPath = configPath('areas.json');
    const areasContents = fs.readFileSync(areasPath, 'utf8');
    const areas = JSON.parse(areasContents);
    
    // Return full area configuration objects
    return NextResponse.json(areas);
  } catch (error) {
    console.error('Error reading areas.json:', error);
    return NextResponse.json({ error: 'Failed to load areas configuration' }, { status: 500 });
  }
}
