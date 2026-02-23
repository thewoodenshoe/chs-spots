import { NextResponse } from 'next/server';
import fs from 'fs';
import { configPath } from '@/lib/data-dir';

export async function GET() {
  const activitiesPath = configPath('activities.json');
  
  try {
    if (fs.existsSync(activitiesPath)) {
      const content = fs.readFileSync(activitiesPath, 'utf8');
      const activities = JSON.parse(content);
      return NextResponse.json(activities);
    }
  } catch (error) {
    console.error('Error reading activities.json:', error);
  }

  // Fallback to default activities
  return NextResponse.json([
    { name: 'Happy Hour', icon: 'Martini', emoji: '🍹', color: '#0d9488' },
    { name: 'Fishing Spots', icon: 'Fish', emoji: '🎣', color: '#0284c7' },
    { name: 'Sunset Spots', icon: 'Sunset', emoji: '🌅', color: '#f59e0b' },
    { name: 'Christmas Spots', icon: 'Gift', emoji: '🎄', color: '#f97316' },
    { name: 'Pickleball Games', icon: 'Activity', emoji: '🏓', color: '#10b981' },
    { name: 'Bike Routes', icon: 'Bike', emoji: '🚴', color: '#6366f1' },
    { name: 'Golf Cart Hacks', icon: 'Car', emoji: '🛺', color: '#8b5cf6' },
  ]);
}
