# Restaurant POI Layer - Setup Instructions

## Overview
The restaurant layer now uses a static JSON file instead of live Overpass queries. This improves performance and reduces API calls.

## Setup Steps

### 1. Install Required Packages
```bash
npm install leaflet.markercluster react-leaflet-cluster
```

### 2. Import Restaurant Data
Run the import script to fetch all restaurants from OpenStreetMap:

```bash
node scripts/import-all-restaurants.js
```

This script will:
- Query Overpass API for restaurants in all target areas (Daniel Island, Mount Pleasant, James Island, Downtown Charleston, Sullivan's Island)
- Extract restaurant data (name, address, phone, website, coordinates)
- Deduplicate restaurants
- Save to `/data/all-restaurants.json`

### 3. Verify the Data File
After running the import, check that `/data/all-restaurants.json` exists and contains restaurant data.

## How It Works

### Restaurant Layer
- **Always visible**: Restaurants are always displayed on the map (no toggle needed)
- **Static data**: Loads from `/data/all-restaurants.json` via `/api/restaurants`
- **Marker clustering**: Uses `react-leaflet-cluster` to cluster nearby restaurants for better performance
- **Gray markers**: Subtle gray icons that don't compete with colorful curated spots
- **Curated spots on top**: Your colorful happy hour pins remain prominent above restaurants

### API Endpoint
- `GET /api/restaurants` - Returns all restaurants from the static JSON file

### Import Script
The `scripts/import-all-restaurants.js` script:
- Queries Overpass API for each area's bounding box
- Handles rate limiting (1 second between requests)
- Extracts and normalizes restaurant data
- Deduplicates by name + coordinates
- Writes to `/data/all-restaurants.json`

## Example Overpass Queries

You can test these queries at https://overpass-turbo.eu/:

### Daniel Island
```
[out:json][timeout:60];
(
  node["amenity"="restaurant"](32.83,-79.92,32.86,-79.89);
  way["amenity"="restaurant"](32.83,-79.92,32.86,-79.89);
  relation["amenity"="restaurant"](32.83,-79.92,32.86,-79.89);
);
out center;
```

### Mount Pleasant
```
[out:json][timeout:60];
(
  node["amenity"="restaurant"](32.78,-79.88,32.82,-79.82);
  way["amenity"="restaurant"](32.78,-79.88,32.82,-79.82);
  relation["amenity"="restaurant"](32.78,-79.88,32.82,-79.82);
);
out center;
```

### James Island
```
[out:json][timeout:60];
(
  node["amenity"="restaurant"](32.70,-79.96,32.75,-79.90);
  way["amenity"="restaurant"](32.70,-79.96,32.75,-79.90);
  relation["amenity"="restaurant"](32.70,-79.96,32.75,-79.90);
);
out center;
```

### Downtown Charleston
```
[out:json][timeout:60];
(
  node["amenity"="restaurant"](32.76,-79.95,32.80,-79.92);
  way["amenity"="restaurant"](32.76,-79.95,32.80,-79.92);
  relation["amenity"="restaurant"](32.76,-79.95,32.80,-79.92);
);
out center;
```

### Sullivan's Island
```
[out:json][timeout:60];
(
  node["amenity"="restaurant"](32.75,-79.85,32.78,-79.82);
  way["amenity"="restaurant"](32.75,-79.85,32.78,-79.82);
  relation["amenity"="restaurant"](32.75,-79.85,32.78,-79.82);
);
out center;
```

## Updating Restaurant Data

To refresh the restaurant data:
1. Run the import script again: `node scripts/import-all-restaurants.js`
2. The script will overwrite `/data/all-restaurants.json` with fresh data
3. Restart your Next.js dev server to see the updated data

## Notes

- The import script includes rate limiting to respect Overpass API limits
- Restaurants are deduplicated by name + coordinates
- Missing coordinates are handled gracefully (restaurants without valid coordinates are skipped)
- The script provides progress output and a summary by area

