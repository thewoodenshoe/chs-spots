export const CLUSTER_ICONS = {
  teal: {
    sm: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCI+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMTgiIGZpbGw9IiMwZDk0ODgiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS13aWR0aD0iMiIvPjwvc3ZnPg==',
    md: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCI+PGNpcmNsZSBjeD0iMjQiIGN5PSIyNCIgcj0iMjIiIGZpbGw9IiMwZDk0ODgiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS13aWR0aD0iMiIvPjwvc3ZnPg==',
    lg: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1NiIgaGVpZ2h0PSI1NiI+PGNpcmNsZSBjeD0iMjgiIGN5PSIyOCIgcj0iMjYiIGZpbGw9IiMwZDk0ODgiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS13aWR0aD0iMiIvPjwvc3ZnPg==',
  },
  gray: {
    sm: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCI+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMTgiIGZpbGw9IiM2NDc0OGIiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS13aWR0aD0iMiIvPjwvc3ZnPg==',
    md: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCI+PGNpcmNsZSBjeD0iMjQiIGN5PSIyNCIgcj0iMjIiIGZpbGw9IiM2NDc0OGIiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS13aWR0aD0iMiIvPjwvc3ZnPg==',
    lg: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1NiIgaGVpZ2h0PSI1NiI+PGNpcmNsZSBjeD0iMjgiIGN5PSIyOCIgcj0iMjYiIGZpbGw9IiM2NDc0OGIiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS13aWR0aD0iMiIvPjwvc3ZnPg==',
  },
};

export function createMarkerIcon(
  spot: { type: string },
  activities: Array<{ name: string; emoji: string; color: string }>,
): google.maps.Icon {
  const activityConfig = activities.find(a => a.name === spot.type);
  const emoji = activityConfig?.emoji || '📍';
  const color = activityConfig?.color || '#0d9488';

  const svg = `
    <svg width="40" height="40" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="18" fill="${color}" stroke="white" stroke-width="3"/>
      <text x="20" y="28" font-size="20" text-anchor="middle" fill="white">${emoji}</text>
    </svg>
  `;

  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(40, 40),
    anchor: new google.maps.Point(20, 40),
  };
}

export function createVenueMarkerIcon(): google.maps.Icon {
  const svg = `
    <svg width="32" height="32" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="14" fill="#ef4444" stroke="white" stroke-width="2"/>
      <circle cx="16" cy="16" r="6" fill="white"/>
    </svg>
  `;

  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(32, 32),
    anchor: new google.maps.Point(16, 32),
  };
}
