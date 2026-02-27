const AREA_BOUNDS = [
  { south: 32.83, north: 32.86, west: -79.92, east: -79.89, name: 'Daniel Island' },
  { south: 32.78, north: 32.82, west: -79.88, east: -79.82, name: 'Mount Pleasant' },
  { south: 32.70, north: 32.75, west: -79.96, east: -79.90, name: 'James Island' },
  { south: 32.76, north: 32.80, west: -79.95, east: -79.92, name: 'Downtown Charleston' },
  { south: 32.75, north: 32.80, west: -79.87, east: -79.77, name: "Sullivan's & IOP" },
] as const;

const DEFAULT_AREA = 'Downtown Charleston';

export function getAreaFromCoordinates(lat: number, lng: number): string {
  for (const b of AREA_BOUNDS) {
    if (lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east) {
      return b.name;
    }
  }
  return DEFAULT_AREA;
}
